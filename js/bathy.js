// Loads the bathymetry grid and provides fast point sampling + the sign
// convention that turns raw grid values into elevation and water height.
import { CONFIG } from './config.js';

export class BathyGrid {
  constructor(meta, data) {
    this.meta = meta;
    this.data = data; // Float32Array, row-major, top-left origin
    this.nodata = meta.nodata;
  }

  static async load() {
    const meta = await (await fetch('./data/bathy.json')).json();
    const buf = await (await fetch('./data/bathy.bin')).arrayBuffer();
    return new BathyGrid(meta, new Float32Array(buf));
  }

  // Fractional column/row for a lon/lat (pixel-centre aligned).
  colRowOf(lat, lon) {
    const { originLon, originLat, dxLon, dyLat } = this.meta;
    const col = (lon - originLon) / dxLon - 0.5;
    const row = (lat - originLat) / dyLat - 0.5;
    return { col, row };
  }

  inBounds(lat, lon) {
    const b = this.meta.bounds;
    return lon >= b.west && lon <= b.east && lat <= b.north && lat >= b.south;
  }

  valueAt(row, col) {
    const { width, height } = this.meta;
    if (col < 0 || row < 0 || col >= width || row >= height) return NaN;
    const v = this.data[row * width + col];
    return v === this.nodata ? NaN : v;
  }

  // Bilinear-sampled RAW value at a lon/lat (NaN if outside or over NoData).
  sampleRaw(lat, lon) {
    const { col, row } = this.colRowOf(lat, lon);
    const c0 = Math.floor(col), r0 = Math.floor(row);
    const fc = col - c0, fr = row - r0;
    const v00 = this.valueAt(r0, c0);
    const v10 = this.valueAt(r0, c0 + 1);
    const v01 = this.valueAt(r0 + 1, c0);
    const v11 = this.valueAt(r0 + 1, c0 + 1);
    // If any corner is NoData, fall back to nearest valid corner.
    const vals = [v00, v10, v01, v11];
    if (vals.some(Number.isNaN)) {
      const valid = vals.filter((v) => !Number.isNaN(v));
      return valid.length ? valid[0] : NaN;
    }
    const top = v00 * (1 - fc) + v10 * fc;
    const bot = v01 * (1 - fc) + v11 * fc;
    return top * (1 - fr) + bot * fr;
  }

  // Apply the configurable sign convention: raw -> elevation (positive up).
  rawToElevation(raw) {
    return CONFIG.BATHY_SIGN * raw + CONFIG.BATHY_DATUM_OFFSET;
  }

  elevationAt(lat, lon) {
    const raw = this.sampleRaw(lat, lon);
    return Number.isNaN(raw) ? NaN : this.rawToElevation(raw);
  }
}

// waterHeight = tideLevel - seabed elevation. Positive => water above seabed.
export function waterHeight(tideLevel, elevation) {
  return tideLevel - elevation;
}
