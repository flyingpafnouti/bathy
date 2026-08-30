// Thin client for the backend tide proxy (the API key stays server-side).
export async function fetchTideHeight(lat, lon, isoDatetime) {
  const u = new URL('/api/tide', location.origin);
  u.searchParams.set('lat', lat);
  u.searchParams.set('lon', lon);
  u.searchParams.set('datetime', isoDatetime);
  const res = await fetch(u);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json(); // { height, provider, datum, at }
}

export async function fetchTideSeries(lat, lon, isoDate) {
  const u = new URL('/api/tide/series', location.origin);
  u.searchParams.set('lat', lat);
  u.searchParams.set('lon', lon);
  u.searchParams.set('date', isoDate);
  const res = await fetch(u);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json(); // { provider, datum, points:[{t,h}] }
}
