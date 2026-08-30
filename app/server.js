// Zero-dependency HTTP server (Node built-ins only).
// Serves the static frontend + the generated bathymetry grid, and proxies the
// tide API so the API key stays server-side (loaded via `node --env-file`).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { getTideHeight, getTideSeries } from './lib/tide.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PUBLIC = join(__dirname, 'public');
const DATA = join(__dirname, 'data');
let googleTileSession;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function serveStatic(res, rootDir, relPath, cache) {
  // Prevent path traversal: resolve and confirm the result stays under rootDir.
  const full = normalize(join(rootDir, relPath));
  if (!full.startsWith(rootDir)) return sendJson(res, 403, { error: 'forbidden' });
  try {
    const info = await stat(full);
    const target = info.isDirectory() ? join(full, 'index.html') : full;
    const data = await readFile(target);
    const headers = { 'Content-Type': MIME[extname(target)] || 'application/octet-stream' };
    if (cache) headers['Cache-Control'] = cache;
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function requireLatLon(url, res) {
  const lat = num(url.searchParams.get('lat'));
  const lon = num(url.searchParams.get('lon'));
  if (lat === null || lon === null) {
    sendJson(res, 400, { error: 'lat and lon query params required' });
    return null;
  }
  return { lat, lon };
}

async function getGoogleTileSession() {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    const error = new Error('GOOGLE_MAPS_API_KEY manquante');
    error.status = 503;
    throw error;
  }
  if (googleTileSession && googleTileSession.expiry * 1000 > Date.now() + 60000) {
    return googleTileSession;
  }
  const url = new URL('https://tile.googleapis.com/v1/createSession');
  url.searchParams.set('key', key);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapType: 'satellite', language: 'fr-FR', region: 'FR' }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.session) {
    const error = new Error(`Google Maps: ${data.error?.message || `HTTP ${response.status}`}`);
    error.status = 502;
    throw error;
  }
  googleTileSession = data;
  return data;
}

async function proxyGoogleTile(res, z, x, y) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const { session } = await getGoogleTileSession();
  const url = new URL(`https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}`);
  url.searchParams.set('session', session);
  url.searchParams.set('key', key);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Google Maps tile HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(200, {
    'Content-Type': response.headers.get('content-type') || 'image/jpeg',
    'Cache-Control': response.headers.get('cache-control') || 'private, max-age=3600',
  });
  res.end(body);
}

async function googleAttribution(url) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const { session } = await getGoogleTileSession();
  const target = new URL('https://tile.googleapis.com/tile/v1/viewport');
  target.searchParams.set('session', session);
  target.searchParams.set('key', key);
  for (const name of ['zoom', 'north', 'south', 'east', 'west']) {
    target.searchParams.set(name, url.searchParams.get(name));
  }
  const response = await fetch(target);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google Maps attribution HTTP ${response.status}`);
  return data.copyright || 'Google Maps';
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    if (path === '/api/health') return sendJson(res, 200, { ok: true });

    if (path === '/api/maps/config') {
      return sendJson(res, 200, { googleAvailable: Boolean(process.env.GOOGLE_MAPS_API_KEY) });
    }

    const googleTile = path.match(/^\/api\/maps\/google\/tile\/(\d+)\/(\d+)\/(\d+)$/);
    if (googleTile) return await proxyGoogleTile(res, ...googleTile.slice(1));

    if (path === '/api/maps/google/attribution') {
      return sendJson(res, 200, { attribution: await googleAttribution(url) });
    }

    if (path === '/api/tide') {
      const ll = requireLatLon(url, res);
      if (!ll) return;
      const raw = url.searchParams.get('datetime');
      const at = raw ? new Date(raw) : new Date();
      if (Number.isNaN(at.getTime())) return sendJson(res, 400, { error: 'invalid datetime' });
      return sendJson(res, 200, await getTideHeight({ ...ll, at: at.toISOString() }));
    }

    if (path === '/api/tide/series') {
      const ll = requireLatLon(url, res);
      if (!ll) return;
      const raw = url.searchParams.get('date');
      const date = raw ? new Date(raw) : new Date();
      if (Number.isNaN(date.getTime())) return sendJson(res, 400, { error: 'invalid date' });
      return sendJson(res, 200, await getTideSeries({ ...ll, date }));
    }

    if (path.startsWith('/data/')) {
      return serveStatic(res, DATA, path.slice('/data/'.length), 'public, max-age=3600');
    }

    // Static frontend
    return serveStatic(res, PUBLIC, path === '/' ? 'index.html' : path);
  } catch (err) {
    sendJson(res, err.status || 502, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Ploumanac'h bathy/tide app on http://localhost:${PORT}`);
});
