# RF Planner

RF Planner is an open-source Wi-Fi planning tool with fast design preview
and authoritative 2D/3D RF simulation for multi-floor projects.

> **Screenshots wanted.** This section should show the 2D plan with
> authoritative coverage and the 3D volumetric cloud on a real project
> (`docs/screenshot-2d.png`, `docs/screenshot-3d.png`).

## Why RF Planner

RF Planner is a fork of [WiFi Coverage Simulator by nevva](https://github.com/nevva/wifi-simulator),
focused on practical Wi-Fi planning with a stable, evidence-driven RF model:
one physical `Coverage(x,y,z)` field, an instant preview for design work, and
a slower authoritative simulation whose 2D slices and 3D volume always agree
because they sample the same field.

## Features

- Multi-floor plan editor: walls with material attenuation, pillars, slabs
  with openings, ceiling areas, RF objects/racks, zones, labels, background
  plan images with calibration.
- Access points with bands, transmit power, mounting height, antenna pattern
  (azimuth, elevation, downtilt), channels, and free-text manufacturer/model.
- **Vista previa**: instant smoothed coverage preview while designing.
- **Simular cobertura**: one authoritative whole-project job — exact 0.16 m
  receiver-height slices per floor plus a 0.48 m × 8-plane volumetric field
  per floor, computed in a background worker with progress and cancel.
- **Mostrar cobertura**: inspect the retained result in Plano 2D (heatmap)
  or Vista 3D (raymarched RF cloud with depth occlusion); adjustable cloud
  intensity; tomography-sheet fallback when WebGL2 is unavailable.
- Floor footprints: upper-floor plans clip to the real slab outline while
  Planta Baja stays the permanent site reference underneath.
- Project save/load as `.rfplan` — RF Planner's native project extension;
  files stay JSON internally and legacy `.json` projects still open. PNG
  exports (RF, RF+plan, plan) and glTF scene export.
- UI in Spanish, English and Swedish. No backend, no database, no accounts.

## Core workflow

```
Design
  ↓
Vista previa            fast design feedback, always available
  ↓
Simular cobertura       ONE authoritative whole-project calculation
  ↓
authoritative result    every floor, 2D + 3D, same design revision
  ↓
inspect in Plano 2D or Vista 3D    two views of the same simulated project
```

- **Vista previa** is a fast approximation for laying out walls and APs.
- **Simular cobertura** runs the authoritative model over all floors. It
  takes on the order of a minute on real projects; progress, minimize and
  cancel are shown in one card.
- **Plano 2D** and **Vista 3D** never compute anything; they only display
  the current product state.
- Any RF-relevant edit (APs, walls, materials, slabs, ceilings, openings,
  heights, receiver height, band, RF parameters) discards the authoritative
  result and returns to Design/Preview. There is no stale-result display.

## RF model overview

The simulator evaluates a true 3D field, `Coverage(x,y,z)`:

- For each participating AP, every physically valid path is solved: the
  direct/transmitted path plus exact first-order specular reflections off
  walls. Transmission loss is charged per material traversal (walls,
  pillars, RF objects, slabs, ceilings, openings).
- Per AP, the **strongest valid path** wins; the displayed receiver value
  is the **strongest AP**. Power values in dBm are never summed or
  averaged across APs or paths.
- Antenna gain is fully three-dimensional (azimuth and elevation beamwidth
  plus downtilt); path length is true 3D distance.
- Authoritative 2D is a receiver-height slice of that field on a 0.16 m
  grid. The 3D cloud samples the same field on a 0.48 m XY grid with
  8 heights per floor.

Display interpolation (2D bilinear raster, GPU trilinear volume filtering,
texture smoothing) is presentation only: it never modifies stored RF
values, and sample centers always reproduce the exact computed value.

## Limitations and accuracy statement

**RF Planner is a planning aid, not a substitute for an on-site RF survey
or certified measurement.**

- Material loss values must reflect real construction to mean anything.
- Only first-order wall reflections are modeled; higher-order multipath,
  diffraction around edges, and fast fading are not modeled.
- Result quality depends entirely on geometry, material, and AP inputs.
- Validate simulated coverage against real measurements for any critical
  deployment. No measurement-accuracy percentages are claimed.

## Installation

Requirements: Docker with the Compose plugin, and outbound internet at
runtime for the 3D library (see below).

```bash
git clone https://github.com/framirez1983/rf-planner
cd rf-planner
docker compose up -d --build
```

Open **http://\<host\>:8080**. Without Compose:

```bash
docker build -t rf-planner .
docker run -d --name rf-planner --restart unless-stopped -p 8080:80 rf-planner
```

Change the host port by editing `"8080:80"` in `docker-compose.yml`.
Logs: `docker logs rf-planner`.

## Browser and runtime requirements

- The 2D editor and fast preview work without WebGL and without internet.
- The volumetric cloud requires **WebGL2** with 3D-texture support.
  **Firefox has been explicitly tested**; if the cloud path is unavailable
  the app automatically falls back to stacked tomography sheets.
- Three.js r128 loads from the cdnjs CDN, so the container needs outbound
  internet for any 3D view. To run fully offline, download `three.min.js`
  next to the app, point the `<script src>` tag in `index.html` at it, and
  add `COPY three.min.js /usr/share/nginx/html/` to the `Dockerfile`.
- Mobile and small-screen support is unverified; Chromium support has not
  been claimed as tested yet.

## Project save/load and exports

- Projects are user-managed `.rfplan` files (JSON internally): save downloads
  `<name>.rfplan`, and Load opens `.rfplan` and legacy `.json` projects alike.
  Validity is judged by project content, never by filename extension alone.
- Editor preferences (language, grid, smoothing) live in `localStorage`;
  simulation results are never persisted.
- Exports: PNG coverage map, PNG coverage + plan, PNG floor plan, and a
  glTF 3D scene. Diagnostic/audit tooling inside the app is developer-only.

## Development and testing

The app is a single static file (`index.html`) plus a coverage worker
(`rt3d-worker.js`, `rt3d-core.js`), served by `nginx:alpine`. There is no
bundler, framework, or backend.

```bash
tools/release-check.sh        # full release gate (engine + product + Docker)
node tools/rt3d/run-all.mjs   # RF engine track only
```

The `?rt3d=1` experimental panel and console RF functions are development
aids, not product features.

## Release status

Feature set is frozen; only bug fixes, documentation, release engineering,
packaging and compatibility fixes land from here. See `CHANGELOG.md`.

## Upstream credit

RF Planner is a fork of [WiFi Coverage Simulator](https://github.com/nevva/wifi-simulator)
by nevva. Third-party runtime dependency: [Three.js r128](https://threejs.org)
(MIT), loaded from cdnjs.

## License

MIT — see [LICENSE](LICENSE). The upstream copyright and permission notice
are retained verbatim as the license requires.
