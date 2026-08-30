#!/usr/bin/env node
/**
 * Reads a GDAL ENVI raw Float32 grid (band 1, row-major, top-left origin) plus
 * its geotransform, then emits the app's compact bathymetry payload:
 *   - data/bathy.bin  : Float32 grid, row-major, NoData kept as NODATA sentinel
 *   - data/bathy.json : grid geometry + statistics + dataset conventions
 *
 * Usage:
 *   node build_meta.mjs <raw> <width> <height> <originLon> <originLat> <dLon> <dLat> <srcNoData> <out_dir>
 *
 * Convention note (see also public/js/config.js):
 *   LITTO3D values are ELEVATIONS in metres relative to IGN69 (positive up).
 *   We store them verbatim; the sign convention is applied at compute time so
 *   the same pipeline works for depth-positive-down datasets too.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [raw, W, H, oLon, oLat, dLon, dLat, srcND, outDir] = process.argv.slice(2);
const width = +W, height = +H;
const originLon = +oLon, originLat = +oLat, dxLon = +dLon, dyLat = +dLat;
const srcNoData = +srcND;
const NODATA = -9999; // compact sentinel used in the emitted grid

const buf = readFileSync(raw);
const src = new Float32Array(buf.buffer, buf.byteOffset, width * height);
const out = new Float32Array(width * height);

let min = Infinity, max = -Infinity, valid = 0;
for (let i = 0; i < src.length; i++) {
  const v = src[i];
  if (!Number.isFinite(v) || Math.abs(v - srcNoData) < 1e-3) {
    out[i] = NODATA;
    continue;
  }
  out[i] = v;
  valid++;
  if (v < min) min = v;
  if (v > max) max = v;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'bathy.bin'), Buffer.from(out.buffer));

const meta = {
  description: 'LITTO3D (Shom/IGN) MNT5m mosaic, Côte de Granit Rose area, resampled to WGS84.',
  crs: 'EPSG:4326',
  width, height,
  // Pixel-corner geotransform (GDAL style): lon = originLon + (col+0.5)*dxLon
  originLon, originLat, dxLon, dyLat,
  bounds: {
    west: originLon,
    north: originLat,
    east: originLon + width * dxLon,
    south: originLat + height * dyLat,
  },
  nodata: NODATA,
  stats: { min, max, valid, total: width * height },
  // Vertical datum of the stored values (elevation, positive up, metres / IGN69).
  valueSemantics: 'elevation_positive_up',
  verticalDatum: 'IGN69',
};
writeFileSync(join(outDir, 'bathy.json'), JSON.stringify(meta, null, 2));
console.log('Wrote bathy.bin (%d bytes) and bathy.json', out.buffer.byteLength);
console.log('min=%s max=%s valid=%d/%d', min.toFixed(2), max.toFixed(2), valid, width * height);
