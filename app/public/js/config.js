// Client-side configuration. Tweak here without touching app logic.
export const CONFIG = {
  // Map view centred on Ploumanac'h.
  center: [48.8286, -3.4783],
  zoom: 14,
  minZoom: 11,
  maxZoom: 19,

  // ---------------------------------------------------------------------------
  // BATHYMETRY SIGN CONVENTION  (make the water-height maths dataset-agnostic)
  //
  //   elevation = BATHY_SIGN * rawValue + BATHY_DATUM_OFFSET      [m, positive up]
  //   waterHeight = tideLevel - elevation                         [m above seabed]
  //
  // The bundled LITTO3D grid stores ELEVATION, positive up (IGN69), so:
  //   BATHY_SIGN = +1, BATHY_DATUM_OFFSET = 0
  //
  // For a dataset storing DEPTH positive-down (e.g. +12 means 12 m below datum),
  // set BATHY_SIGN = -1. Use BATHY_DATUM_OFFSET to shift the vertical datum onto
  // the tide datum if they differ.
  // ---------------------------------------------------------------------------
  BATHY_SIGN: +1,
  BATHY_DATUM_OFFSET: 0,

  // Colour scale for the bathymetry visualisation (elevation, metres).
  // Below ~0 = underwater (blue ramp), above = land (green/brown).
  colorRange: { min: -35, max: 20 },

  // Binary water-height layer defaults.
  waterThreshold: 2.0,     // metres of water above the seabed
  layerOpacity: 1.0,
  colorAbove: [46, 204, 113],   // >= threshold (enough water) — green
  colorBelow: [231, 76, 60],    // <  threshold (too shallow / dry) — red

  // Initial tide instant (local). Defaults to now, rounded to the hour.
  // Left null => set at runtime.
  initialDatetime: null,
};
