#!/usr/bin/env bash
# Bathymetry preprocessing pipeline (requires GDAL CLI).
#
# Mosaics all LITTO3D MNT1m ASCII tiles, aggregates them to 5 m by taking the
# maximum elevation in each output cell (conservative water-depth convention),
# reprojects Lambert-93/IGN69 -> WGS84 with max resampling, and emits the compact
# grid consumed by the web app (data/bathy.bin + .json).
#
# Usage:  ./scripts/preprocess.sh [RAW_DATA_DIR]
#   RAW_DATA_DIR defaults to the repository root and collects every delivered
#   LITTO3D package (for example 0215_6880 and 0220_6880).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$HERE")"
DATA_SRC="${1:-$APP_DIR/..}"
WORK="$APP_DIR/.gdal_work"
OUT="$APP_DIR/data"

mkdir -p "$WORK" "$OUT"

echo "==> Collecting MNT1m tiles from $DATA_SRC"
find "$(cd "$DATA_SRC" && pwd)" -path '*/MNT1m/*.asc' | sort > "$WORK/tiles.txt"
echo "    $(wc -l < "$WORK/tiles.txt") tiles"

echo "==> Building 1 m VRT mosaic (EPSG:2154)"
gdalbuildvrt -a_srs EPSG:2154 -vrtnodata -99999 \
  "$WORK/mosaic_1m.vrt" $(cat "$WORK/tiles.txt") >/dev/null

echo "==> Aggregating to aligned 5 m cells (maximum elevation)"
gdalwarp -overwrite -s_srs EPSG:2154 -t_srs EPSG:2154 -tr 5 5 -tap -r max \
  -srcnodata -99999 -dstnodata -99999 -of GTiff -co COMPRESS=DEFLATE \
  "$WORK/mosaic_1m.vrt" "$WORK/mosaic_5m_max_l93.tif" >/dev/null

echo "==> Warping to WGS84 (maximum elevation)"
gdalwarp -overwrite -s_srs EPSG:2154 -t_srs EPSG:4326 -r max \
  -srcnodata -99999 -dstnodata -99999 -of GTiff -co COMPRESS=DEFLATE \
  "$WORK/mosaic_5m_max_l93.tif" "$WORK/mosaic_wgs84.tif" >/dev/null

echo "==> Exporting raw Float32 (ENVI)"
gdal_translate -of ENVI -ot Float32 \
  "$WORK/mosaic_wgs84.tif" "$WORK/mosaic.raw" >/dev/null

# Parse geometry from GDAL and hand off to the JSON/bin emitter.
read -r W H OLON OLAT DLON DLAT ND < <(gdalinfo -json "$WORK/mosaic_wgs84.tif" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);s=d['size'];g=d['geoTransform'];\
print(s[0],s[1],g[0],g[3],g[1],g[5],d['bands'][0].get('noDataValue',-99999))")

echo "==> Emitting bathy.bin / bathy.json"
node "$HERE/build_meta.mjs" "$WORK/mosaic.raw" "$W" "$H" "$OLON" "$OLAT" "$DLON" "$DLAT" "$ND" "$OUT"

echo "==> Done. Data in $OUT"
