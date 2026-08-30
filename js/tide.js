// GitHub Pages client: api-maree.fr is called directly from the browser.
// This key is intentionally public so the static application works immediately.
const PUBLIC_API_KEY = '130867c3dfbac7ee9f2be263565675db';
const SITE = 'ploumanac-h';
const DATUM_OFFSET = -5.045;
const ATTRIBUTION =
  'Données de marée fournies par api-maree.fr sous licence CC BY, calculées à partir de composantes harmoniques Ifremer / PREVIMER, elles-mêmes sous licence CC BY.';
const dailySeriesCache = new Map();

function apiKey() {
  return PUBLIC_API_KEY;
}

function interpolate(points, atMs) {
  if (!points.length) return null;
  if (atMs <= points[0].t) return points[0].h;
  if (atMs >= points[points.length - 1].t) return points[points.length - 1].h;
  for (let i = 1; i < points.length; i++) {
    if (atMs <= points[i].t) {
      const a = points[i - 1], b = points[i];
      const ratio = (atMs - a.t) / (b.t - a.t);
      return a.h + ratio * (b.h - a.h);
    }
  }
  return points.at(-1).h;
}

async function loadTideSeries(start) {
  const end = new Date(start.getTime() + 86400000);
  const format = (value) => value.toISOString().slice(0, 16);
  const url = new URL('https://api-maree.fr/water-levels');
  url.search = new URLSearchParams({
    site: SITE,
    from: format(start),
    to: format(end),
    step: '5',
    tz: 'UTC',
    key: apiKey(),
  });
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(data.data)) {
    throw new Error(data.message || data.error || `api-maree.fr HTTP ${response.status}`);
  }
  return {
    provider: 'apimaree',
    datum: 'IGN69',
    sourceDatum: 'ZH',
    datumOffset: DATUM_OFFSET,
    attribution: data.attribution || ATTRIBUTION,
    statusNotice: data.status_notice,
    points: data.data.map((point) => ({
      t: new Date(point.time).getTime(),
      h: Number(point.height) + DATUM_OFFSET,
    })),
  };
}

export async function fetchTideSeries(_lat, _lon, isoDate) {
  const date = new Date(isoDate);
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const cacheKey = `${SITE}:${start.toISOString().slice(0, 10)}`;

  if (!dailySeriesCache.has(cacheKey)) {
    // Store the promise immediately so simultaneous height and chart requests
    // share the same network call.
    dailySeriesCache.set(cacheKey, loadTideSeries(start));
  }

  try {
    return await dailySeriesCache.get(cacheKey);
  } catch (error) {
    // Do not permanently cache a transient API or network failure.
    dailySeriesCache.delete(cacheKey);
    throw error;
  }
}

export async function fetchTideHeight(lat, lon, isoDatetime) {
  const series = await fetchTideSeries(lat, lon, isoDatetime);
  const at = new Date(isoDatetime);
  return {
    height: interpolate(series.points, at.getTime()),
    provider: series.provider,
    datum: series.datum,
    sourceDatum: series.sourceDatum,
    datumOffset: series.datumOffset,
    attribution: series.attribution,
    statusNotice: series.statusNotice,
    at: at.toISOString(),
  };
}
