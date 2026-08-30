import { CONFIG } from './config.js';
import { BathyGrid, waterHeight } from './bathy.js';
import { createBathyLayer, createWaterLayer } from './layers.js';
import { fetchTideHeight, fetchTideSeries } from './tide.js';

const L = window.L;

// Point Leaflet's default marker at the vendored images.
L.Icon.Default.prototype.options.imagePath = '/vendor/leaflet/images/';

// ---- app state -------------------------------------------------------------
const state = {
  tideLevel: null,      // metres, for the currently selected datetime (at centre)
  tideMeta: null,       // { provider, datum, at }
  threshold: CONFIG.waterThreshold,
  datetimeISO: null,
  clickMarker: null,
  tideRequestId: 0,
};

let timeSliderTimer;

// ---- DOM -------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function toLocalInputValue(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function syncTimeSlider(date) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const rounded = Math.min(1435, Math.round(minutes / 5) * 5);
  $('timeSlider').value = rounded;
  $('timeSliderVal').textContent = formatMinutes(rounded);
}

// ---- map -------------------------------------------------------------------
const map = L.map('map', { center: CONFIG.center, zoom: CONFIG.zoom, minZoom: CONFIG.minZoom, maxZoom: CONFIG.maxZoom });

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap · Bathymétrie: LITTO3D Shom/IGN',
}).addTo(map);

// Keep aerial imagery above the bathymetry canvases (overlayPane: z-index 400),
// while markers and popups remain above it.
map.createPane("aerialPane");
map.getPane("aerialPane").style.zIndex = 450;
map.getPane("aerialPane").style.pointerEvents = "none";

const aerialProviders = {
  esri: {
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, attribution: 'Vue aérienne &copy; Esri et ses fournisseurs' },
  },
  ign: {
    url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
    options: { maxZoom: 19, attribution: 'Orthophotographies &copy; IGN' },
  },
  google: {
    url: '/api/maps/google/tile/{z}/{x}/{y}',
    options: { maxZoom: 22, attribution: '<a href="https://maps.google.com/">Google Maps</a>' },
  },
};

function makeAerialLayer(provider) {
  const definition = aerialProviders[provider];
  return L.tileLayer(definition.url, {
    ...definition.options,
    opacity: Number($('aerialOpacity')?.value ?? 65) / 100,
    pane: 'aerialPane',
  });
}

let activeAerialProvider = 'esri';
let aerialLayer = makeAerialLayer(activeAerialProvider);
const aerialGroup = L.layerGroup([aerialLayer]).addTo(map);
let googleCopyright = '';

let grid, bathyLayer, waterLayer;

async function init() {
  grid = await BathyGrid.load();

  bathyLayer = createBathyLayer(grid).addTo(map);
  waterLayer = createWaterLayer(grid, () => ({
    tideLevel: state.tideLevel,
    threshold: state.threshold,
  }));
  waterLayer.setOpacity(CONFIG.layerOpacity);
  waterLayer.addTo(map);

  L.control.layers(null, {
    'Vue aérienne': aerialGroup,
    'Bathymétrie': bathyLayer,
    'Hauteur d’eau (seuil)': waterLayer,
  }, { collapsed: false }).addTo(map);

  fitToData();
  await configureAerialProviders();
  wireControls();

  // Initial datetime = now rounded to the hour.
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const initial = CONFIG.initialDatetime ? new Date(CONFIG.initialDatetime) : now;
  $('datetime').value = toLocalInputValue(initial);
  syncTimeSlider(initial);
  await onDatetimeChange();

  map.on('click', onMapClick);
}

function fitToData() {
  const b = grid.meta.bounds;
  map.fitBounds([[b.south, b.west], [b.north, b.east]]);
}

async function configureAerialProviders() {
  const googleOption = $('aerialProvider').querySelector('option[value="google"]');
  try {
    const response = await fetch('/api/maps/config');
    const config = await response.json();
    googleOption.disabled = !config.googleAvailable;
    if (!config.googleAvailable) googleOption.textContent = 'Google Satellite — clé requise';
  } catch {
    googleOption.disabled = true;
    googleOption.textContent = 'Google Satellite — indisponible';
  }
}

async function updateGoogleAttribution() {
  if (googleCopyright) {
    map.attributionControl.removeAttribution(googleCopyright);
    googleCopyright = '';
  }
  if (activeAerialProvider !== 'google' || !map.hasLayer(aerialGroup)) return;
  const bounds = map.getBounds();
  const query = new URLSearchParams({
    zoom: String(Math.round(map.getZoom())),
    north: String(bounds.getNorth()),
    south: String(bounds.getSouth()),
    east: String(bounds.getEast()),
    west: String(bounds.getWest()),
  });
  try {
    const response = await fetch(`/api/maps/google/attribution?${query}`);
    const data = await response.json();
    if (response.ok && data.attribution) {
      googleCopyright = data.attribution;
      map.attributionControl.addAttribution(googleCopyright);
    }
  } catch { /* The permanent Google Maps attribution remains visible. */ }
}

function setAerialProvider(provider) {
  aerialGroup.removeLayer(aerialLayer);
  activeAerialProvider = provider;
  aerialLayer = makeAerialLayer(provider);
  aerialGroup.addLayer(aerialLayer);
  updateGoogleAttribution();
}

// ---- controls --------------------------------------------------------------
function wireControls() {
  $('threshold').value = state.threshold;
  $('thresholdVal').textContent = state.threshold.toFixed(1);
  $('opacity').value = Math.round(CONFIG.layerOpacity * 100);
  $('opacityVal').textContent = `${Math.round(CONFIG.layerOpacity * 100)}%`;
  $('aerialOpacity').value = Math.round(aerialLayer.options.opacity * 100);
  $('aerialOpacityVal').textContent = `${Math.round(aerialLayer.options.opacity * 100)}%`;
  $('sign').value = String(CONFIG.BATHY_SIGN);
  $('datumOffset').value = CONFIG.BATHY_DATUM_OFFSET;

  $('datetime').addEventListener('change', onDatetimeChange);

  $('aerialProvider').addEventListener('change', (e) => setAerialProvider(e.target.value));

  $('timeSlider').addEventListener('input', (e) => {
    const minutes = Number(e.target.value);
    $('timeSliderVal').textContent = formatMinutes(minutes);
    const current = new Date($('datetime').value);
    if (Number.isNaN(current.getTime())) return;
    current.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    $('datetime').value = toLocalInputValue(current);
    clearTimeout(timeSliderTimer);
    timeSliderTimer = setTimeout(onDatetimeChange, 120);
  });

  $('threshold').addEventListener('input', (e) => {
    state.threshold = Number(e.target.value);
    $('thresholdVal').textContent = state.threshold.toFixed(1);
    waterLayer.refresh();
  });

  $('opacity').addEventListener('input', (e) => {
    const op = Number(e.target.value) / 100;
    $('opacityVal').textContent = `${e.target.value}%`;
    waterLayer.setOpacity(op);
  });

  $('aerialOpacity').addEventListener('input', (e) => {
    const opacity = Number(e.target.value) / 100;
    $('aerialOpacityVal').textContent = `${e.target.value}%`;
    aerialLayer.setOpacity(opacity);
  });

  map.on('moveend overlayadd overlayremove', updateGoogleAttribution);

  // Sign convention is configurable live.
  $('sign').addEventListener('change', (e) => {
    CONFIG.BATHY_SIGN = Number(e.target.value);
    bathyLayer.refresh();
    waterLayer.refresh();
  });
  $('datumOffset').addEventListener('change', (e) => {
    CONFIG.BATHY_DATUM_OFFSET = Number(e.target.value) || 0;
    bathyLayer.refresh();
    waterLayer.refresh();
  });
}

async function onDatetimeChange() {
  const val = $('datetime').value;
  if (!val) return;
  const dt = new Date(val);
  syncTimeSlider(dt);
  state.datetimeISO = dt.toISOString();
  const requestId = ++state.tideRequestId;
  const [lat, lon] = CONFIG.center;
  setStatus('Chargement de la marée…');
  try {
    const tide = await fetchTideHeight(lat, lon, state.datetimeISO);
    if (requestId !== state.tideRequestId) return;
    state.tideLevel = tide.height;
    state.tideMeta = tide;
    renderTideReadout();
    waterLayer.refresh();
    drawTideCurve(lat, lon, dt, requestId);
  } catch (err) {
    if (requestId !== state.tideRequestId) return;
    setStatus(`Erreur marée: ${err.message}`, true);
  }
}

function renderTideReadout() {
  const t = state.tideMeta;
  const badge = t.provider === 'mock' ? ' <span class="badge">simulée</span>' : '';
  $('tideReadout').innerHTML =
    `Niveau de marée: <strong>${state.tideLevel.toFixed(2)} m</strong> / ${t.datum}${badge}`;
  const when = new Date(state.datetimeISO).toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit',
  });
  const graphHeight = t.sourceDatum === 'ZH'
    ? state.tideLevel - (t.datumOffset ?? 0)
    : state.tideLevel;
  const graphDatum = t.sourceDatum ?? t.datum;
  $('tideChartValue').textContent =
    `Marégramme à ${when} : ${graphHeight.toFixed(2)} m au-dessus du ${graphDatum}`;
  const attribution = $('tideAttribution');
  attribution.textContent = [t.attribution, t.statusNotice].filter(Boolean).join(' ');
  attribution.hidden = !attribution.textContent;
  setStatus('');
}

function setStatus(msg, isError = false) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

// ---- tide curve (mini chart) ----------------------------------------------
async function drawTideCurve(lat, lon, date, requestId) {
  let series;
  try {
    series = await fetchTideSeries(lat, lon, date.toISOString());
  } catch { return; }
  if (requestId !== state.tideRequestId) return;
  const cv = $('tideCurve');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, pad = 7;
  ctx.clearRect(0, 0, W, H);
  const graphOffset = series.sourceDatum === 'ZH' ? (series.datumOffset ?? 0) : 0;
  const graphDatum = series.sourceDatum ?? series.datum;
  const pts = series.points.map((p) => ({ ...p, h: p.h - graphOffset }));
  if (!pts.length) return;
  const hs = pts.map((p) => p.h);
  const min = Math.min(...hs), max = Math.max(...hs);
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = (t) => pad + (W - 2 * pad) * (t - t0) / (t1 - t0);
  const y = (h) => H - pad - (H - 2 * pad) * (h - min) / ((max - min) || 1);

  // zero line
  if (min < 0 && max > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.moveTo(pad, y(0)); ctx.lineTo(W - pad, y(0)); ctx.stroke();
  }
  ctx.strokeStyle = '#4aa3ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p, i) => { const px = x(p.t), py = y(p.h); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.stroke();

  // marker at selected time
  const selT = date.getTime();
  if (selT >= t0 && selT <= t1) {
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    const selectedGraphHeight = (state.tideLevel ?? 0) - graphOffset;
    ctx.arc(x(selT), y(selectedGraphHeight), 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,204,0,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x(selT), pad); ctx.lineTo(x(selT), H - pad); ctx.stroke();

    const label = `${new Date(selT).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}  ${selectedGraphHeight.toFixed(2)} m ${graphDatum}`;
    ctx.font = 'bold 11px system-ui';
    const labelW = ctx.measureText(label).width + 10;
    const labelX = Math.max(3, Math.min(W - labelW - 3, x(selT) - labelW / 2));
    ctx.fillStyle = 'rgba(15,22,32,0.9)';
    ctx.fillRect(labelX, 3, labelW, 17);
    ctx.fillStyle = '#ffdc55';
    ctx.fillText(label, labelX + 5, 15);
  }
}

// ---- map click -> popup ----------------------------------------------------
async function onMapClick(e) {
  const { lat, lng } = e.latlng;
  if (!grid.inBounds(lat, lng)) {
    L.popup().setLatLng(e.latlng)
      .setContent('Hors de la zone bathymétrique disponible.').openOn(map);
    return;
  }

  const raw = grid.sampleRaw(lat, lng);
  const elev = Number.isNaN(raw) ? NaN : grid.rawToElevation(raw);

  // Ensure we have a tide value for the selected instant.
  if (state.tideLevel === null) await onDatetimeChange();
  const tide = state.tideLevel;
  const wh = Number.isNaN(elev) || tide === null ? NaN : waterHeight(tide, elev);

  const marker = L.marker(e.latlng);
  if (state.clickMarker) map.removeLayer(state.clickMarker);
  state.clickMarker = marker.addTo(map);

  const fmt = (v, u = ' m') => (Number.isNaN(v) ? 'n/d' : `${v.toFixed(2)}${u}`);
  const bathyLine = Number.isNaN(elev)
    ? 'Bathymétrie: n/d (pas de donnée)'
    : `Bathymétrie (élévation fond): <strong>${fmt(elev)}</strong>` +
      `<br><span class="muted">valeur brute: ${fmt(raw)}</span>`;
  const whClass = Number.isNaN(wh) ? '' : (wh >= state.threshold ? 'ok' : 'shallow');
  const whLine = Number.isNaN(wh)
    ? 'Hauteur d’eau: n/d'
    : `Hauteur d’eau: <strong class="${whClass}">${fmt(wh)}</strong>` +
      (wh <= 0 ? ' <span class="muted">(exondé)</span>' : '');

  const when = new Date(state.datetimeISO).toLocaleString('fr-FR');
  marker.bindPopup(
    `<div class="popup">
       <div>📍 <strong>${lat.toFixed(5)}, ${lng.toFixed(5)}</strong></div>
       <div>${bathyLine}</div>
       <div>🌊 Niveau de marée (${when}): <strong>${fmt(tide)}</strong></div>
       <div>${whLine}</div>
       <div class="muted">Seuil actuel: ${state.threshold.toFixed(1)} m</div>
     </div>`
  ).openPopup();
}

init().catch((err) => setStatus(`Erreur d'initialisation: ${err.message}`, true));
