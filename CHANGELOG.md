# Changelog

## v1.0.0-rc.1 — 2026-10-19

First public release candidate of RF Planner, forked from WiFi Coverage
Simulator by nevva.

### Added

- Native `.rfplan` project extension: projects save as `.rfplan`, remain JSON
  internally, and legacy `.json` project files keep opening.
- True 3D RF field (`Coverage(x,y,z)`): strongest valid path per AP
  (direct plus first-order wall reflections), strongest AP serves, no dBm
  summation, full-3D antenna gain with elevation and downtilt.
- Authoritative whole-project simulation: exact 0.16 m receiver-height 2D
  slices plus a 0.48 m × 8-plane volumetric field per floor, computed in a
  background worker with progress, minimize and cancel.
- Volumetric 3D RF cloud (WebGL2 raymarched volume with depth occlusion
  and adjustable intensity) with automatic tomography-sheet fallback.
- Unified product flow: fast Vista previa while designing, one Simular
  cobertura action, Mostrar cobertura to inspect 2D/3D; RF edits return to
  Design with no stale-result display.
- Multi-floor coverage with floor-footprint slab outlines; upper-floor
  background plans clip to the footprint while Planta Baja stays reference.
- 2D display smoothing via scalar bilinear interpolation (no blur filters).
- UI in Spanish, English and Swedish.
- Project JSON save/load, PNG exports (RF, RF+plan, plan), glTF scene
  export, background plan images with calibration.
- BVH-accelerated ray queries; single-file static app served by nginx.

### Changed

- 3D right-drag now pans the horizontal project plane in both directions
  (up/down = forward/back relative to the current view); it no longer changes
  target height, camera distance, azimuth or elevation.
- Legacy instant engine kept only as the fast design preview; the
  authoritative model is the sole simulation result.
- Internal engine controls (legacy Ray tracing, per-engine buttons,
  CURRENT/STALE badges) hidden from the normal toolbar; developer and
  audit functions remain available.

### Technical

- No bundler, framework or backend; `index.html` + coverage worker.
- 100+ automated checks: bit-exact RF oracle, worker-protocol parity,
  product workflow regressions, production-isolation audit.

### Known limitations

- Planning aid, not a substitute for an on-site RF survey; no accuracy
  percentages claimed. First-order wall reflections only.
- 3D view requires internet (Three.js CDN) and WebGL2; sheets fallback
  otherwise. Firefox explicitly tested; Chromium and mobile unverified.
- Whole-project authoritative runs take on the order of a minute on real
  projects.
