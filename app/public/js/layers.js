// Canvas-based Leaflet grid layers rendered directly from the in-memory
// bathymetry grid. Both layers redraw cheaply, so the binary water layer can
// react instantly to tide / threshold / opacity changes.
import { CONFIG } from './config.js';
import { waterHeight } from './bathy.js';

const L = window.L;

// --- colour helpers ---------------------------------------------------------
function lerp(a, b, t) { return a + (b - a) * t; }

// Elevation -> RGBA for the bathymetry visualisation.
function bathyColor(elev) {
  const { min, max } = CONFIG.colorRange;
  if (elev < 0) {
    // Underwater: deep (dark blue) -> shallow (light cyan).
    const t = Math.max(0, Math.min(1, (elev - min) / (0 - min)));
    return [lerp(8, 150, t), lerp(48, 220, t), lerp(107, 255, t), 255];
  }
  // Land: shore green -> upland brown.
  const t = Math.max(0, Math.min(1, elev / (max || 1)));
  return [lerp(120, 140, t), lerp(180, 110, t), lerp(90, 70, t), 255];
}

// Build per-column longitudes and per-row latitudes for a tile. Web Mercator is
// axis-separable, so we only unproject one row and one column per tile.
function tileGeoAxes(map, coords, size) {
  const nw = coords.scaleBy(size);
  const lons = new Float64Array(size.x);
  const lats = new Float64Array(size.y);
  for (let px = 0; px < size.x; px++) {
    lons[px] = map.unproject(L.point(nw.x + px + 0.5, nw.y), coords.z).lng;
  }
  for (let py = 0; py < size.y; py++) {
    lats[py] = map.unproject(L.point(nw.x, nw.y + py + 0.5), coords.z).lat;
  }
  return { lons, lats };
}

// Generic canvas grid layer: `paint(elev, lat, lon)` returns an RGBA array or
// null (transparent). `revision()` lets callers force a redraw on state change.
function makeGridLayer(grid, paint) {
  return new (L.GridLayer.extend({
    createTile(coords) {
      const size = this.getTileSize();
      const tile = document.createElement('canvas');
      tile.width = size.x;
      tile.height = size.y;
      this._drawTile(tile, coords, size);
      return tile;
    },
    _drawTile(tile, coords, size) {
      const map = this._map;
      if (!map) return;
      const ctx = tile.getContext('2d');
      const img = ctx.createImageData(size.x, size.y);
      const { lons, lats } = tileGeoAxes(map, coords, size);
      const d = img.data;
      let o = 0;
      for (let py = 0; py < size.y; py++) {
        const lat = lats[py];
        for (let px = 0; px < size.x; px++) {
          const lon = lons[px];
          let rgba = null;
          if (grid.inBounds(lat, lon)) {
            const elev = grid.elevationAt(lat, lon);
            if (!Number.isNaN(elev)) rgba = paint(elev, lat, lon);
          }
          if (rgba) {
            d[o] = rgba[0]; d[o + 1] = rgba[1]; d[o + 2] = rgba[2]; d[o + 3] = rgba[3];
          } else {
            d[o + 3] = 0;
          }
          o += 4;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    // Repaint currently loaded tiles in place (no tile reload flicker).
    refresh() {
      for (const key in this._tiles) {
        const t = this._tiles[key];
        this._drawTile(t.el, t.coords, this.getTileSize());
      }
    },
  }))();
}

export function createBathyLayer(grid) {
  return makeGridLayer(grid, (elev) => bathyColor(elev));
}

// Binary layer: green where waterHeight >= threshold, red where below.
// `getState()` returns { tideLevel, threshold }.
export function createWaterLayer(grid, getState) {
  const layer = makeGridLayer(grid, (elev) => {
    const { tideLevel, threshold } = getState();
    if (tideLevel === null || tideLevel === undefined) return null;
    const wh = waterHeight(tideLevel, elev);
    const c = wh >= threshold ? CONFIG.colorAbove : CONFIG.colorBelow;
    return [c[0], c[1], c[2], 255];
  });
  return layer;
}
