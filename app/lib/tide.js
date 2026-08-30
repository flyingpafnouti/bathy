/**
 * Tide provider abstraction.
 *
 * Exposes two functions returning heights in metres relative to the configured
 * vertical datum (aligned with the bathymetry datum via TIDE_DATUM_OFFSET):
 *   - getTideHeight({ lat, lon, at })      -> { height, provider, datum, at }
 *   - getTideSeries({ lat, lon, date })    -> { provider, datum, points: [{t,h}] }
 *
 * Providers:
 *   - apimaree   : api-maree.fr (needs TIDE_API_KEY and a site id)
 *   - worldtides : real REST API (needs TIDE_API_KEY)
 *   - mock       : deterministic offline harmonic model (no network, no key)
 */

const OFFSET = Number(process.env.TIDE_DATUM_OFFSET ?? 0);
const DATUM = process.env.TIDE_DATUM ?? 'MSL';
const API_MAREE_ATTRIBUTION =
  'Données de marée fournies par api-maree.fr sous licence CC BY, calculées à partir de composantes harmoniques Ifremer / PREVIMER, elles-mêmes sous licence CC BY.';
const apiMareeCache = new Map();

function resolveProvider() {
  const p = (process.env.TIDE_PROVIDER ?? 'auto').toLowerCase();
  if (p === 'auto') return process.env.TIDE_API_KEY ? 'apimaree' : 'mock';
  return p;
}

/* ------------------------------------------------------------ apimaree ---- */
async function apiMareeSeries({ date }) {
  const key = process.env.TIDE_API_KEY;
  if (!key) throw new Error('TIDE_API_KEY missing for apimaree provider');

  const site = process.env.TIDE_SITE ?? 'ploumanac-h';
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const cacheKey = `${site}:${start.toISOString().slice(0, 10)}:${OFFSET}`;
  if (apiMareeCache.has(cacheKey)) return apiMareeCache.get(cacheKey);

  const request = (async () => {
  const format = (d) => d.toISOString().slice(0, 16);
  const url = new URL('https://api-maree.fr/water-levels');
  url.searchParams.set('site', site);
  url.searchParams.set('from', format(start));
  url.searchParams.set('to', format(end));
  url.searchParams.set('step', '5');
  url.searchParams.set('tz', 'UTC');
  url.searchParams.set('key', key);

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.message || data.error || `HTTP ${res.status}`;
    throw new Error(`api-maree.fr: ${detail}`);
  }
  if (!Array.isArray(data.data)) throw new Error('api-maree.fr: no water-level data');
    return {
    points: data.data.map((p) => ({ t: new Date(p.time).getTime(), h: Number(p.height) + OFFSET })),
    attribution: data.attribution || API_MAREE_ATTRIBUTION,
    statusNotice: data.status_notice,
    };
  })();

  apiMareeCache.set(cacheKey, request);
  try {
    return await request;
  } catch (error) {
    apiMareeCache.delete(cacheKey);
    throw error;
  }
}

/* ---------------------------------------------------------------- mock ----- */
// Simple superposition of the dominant semi-diurnal constituents, tuned to
// Ploumanac'h's large tidal range (~roughly +/- up to ~4-5 m about MSL at
// springs). Deterministic in UTC so the app is fully usable without a key.
function mockHeight(date) {
  const tHours = date.getTime() / 3600000; // hours since epoch (UTC)
  const deg = Math.PI / 180;
  // period (h), amplitude (m), phase (deg)
  const constituents = [
    { T: 12.4206, A: 3.6, g: 40 },   // M2
    { T: 12.0000, A: 1.2, g: 70 },   // S2 -> spring/neap beating with M2
    { T: 12.6583, A: 0.7, g: 20 },   // N2
    { T: 23.9345, A: 0.4, g: 120 },  // K1
    { T: 25.8193, A: 0.3, g: 300 },  // O1
  ];
  let h = 0;
  for (const c of constituents) h += c.A * Math.cos((360 / c.T) * tHours * deg - c.g * deg);
  return h;
}

/* ---------------------------------------------------------- worldtides ----- */
async function worldtidesSeries({ lat, lon, date }) {
  const key = process.env.TIDE_API_KEY;
  if (!key) throw new Error('TIDE_API_KEY missing for worldtides provider');
  const day = date.toISOString().slice(0, 10);
  const url = new URL('https://www.worldtides.info/api/v3');
  url.searchParams.set('heights', '');
  url.searchParams.set('date', day);
  url.searchParams.set('days', '1');
  url.searchParams.set('lat', lat.toFixed(5));
  url.searchParams.set('lon', lon.toFixed(5));
  url.searchParams.set('datum', DATUM);
  url.searchParams.set('step', '900'); // 15 min
  url.searchParams.set('key', key);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`worldtides HTTP ${res.status}`);
  const data = await res.json();
  if (!data.heights) throw new Error(`worldtides: ${data.error || 'no heights'}`);
  return data.heights.map((p) => ({ t: p.dt * 1000, h: p.height + OFFSET }));
}

/* ------------------------------------------------------------ interpolate -- */
function interpolate(points, atMs) {
  if (!points.length) return null;
  if (atMs <= points[0].t) return points[0].h;
  if (atMs >= points[points.length - 1].t) return points[points.length - 1].h;
  for (let i = 1; i < points.length; i++) {
    if (atMs <= points[i].t) {
      const a = points[i - 1], b = points[i];
      const f = (atMs - a.t) / (b.t - a.t);
      return a.h + f * (b.h - a.h);
    }
  }
  return points[points.length - 1].h;
}

/* --------------------------------------------------------------- public ---- */
export async function getTideSeries({ lat, lon, date }) {
  const provider = resolveProvider();
  if (provider === 'apimaree') {
    const result = await apiMareeSeries({ date });
    return {
      provider,
      datum: DATUM,
      sourceDatum: 'ZH',
      datumOffset: OFFSET,
      points: result.points,
      attribution: result.attribution,
      statusNotice: result.statusNotice,
    };
  }
  if (provider === 'worldtides') {
    return { provider, datum: DATUM, points: await worldtidesSeries({ lat, lon, date }) };
  }
  // mock: sample the day at 5-min steps in UTC
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const points = [];
  for (let m = 0; m <= 24 * 60; m += 5) {
    const d = new Date(start.getTime() + m * 60000);
    points.push({ t: d.getTime(), h: mockHeight(d) + OFFSET });
  }
  return { provider, datum: DATUM, points };
}

export async function getTideHeight({ lat, lon, at }) {
  const date = new Date(at);
  const series = await getTideSeries({ lat, lon, date });
  const height = interpolate(series.points, date.getTime());
  return {
    height,
    provider: series.provider,
    datum: series.datum,
    sourceDatum: series.sourceDatum,
    datumOffset: series.datumOffset,
    at: date.toISOString(),
    attribution: series.attribution,
    statusNotice: series.statusNotice,
  };
}
