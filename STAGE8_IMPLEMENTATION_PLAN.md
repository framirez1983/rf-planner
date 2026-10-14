# Stage 8 Implementation Plan — Product Integration

**Objective**: Integrate RT3D into the normal application workflow as the authoritative "Simular cobertura / Simulate Coverage" operation while preserving the existing instant Live Preview exactly as the interactive design aid.

---

## 8A — Authoritative Simulate Coverage Workflow

### Current State
- **Live Preview** (instant): `computeHeatSimple()` + `computeIndoorFine()` → `heatGridRssi/heatGridDisp` → painted by `paintHeat()` (smoothed, interpolated)
- **Legacy RT** (manual): `runRayTrace()` → deposits into same `heatGridRssi/heatGridDisp` + `heatRtReach` → painted by `paintHeat()` (same canvas, same smoothing)
- **RT3D Experimental** (`?rt3d=1` only): `rt3dExpRunCoverage()` → Worker → `rt3dCoverageSlice()` → direct binning (no smoothing) → separate `rt3dExpCanvas` / `rt3dExpMeta`
- **UI Controls**: 
  - Top bar: `btnHeat` (toggle coverage), `btnTrace` (run legacy RT)
  - `?rt3d=1` panel: engine selector (hidden/legacy/RT3D), fan preset, run buttons, progress, cancel

### Required Changes
1. **New "Simular cobertura" button** in top bar (primary action, always visible)
2. **Worker launch path**: `rt3dExpWorkerStart()` with project snapshot (already implemented in Stage 7A.1)
3. **Progress/Cancel UI**: Reuse toast/progress infrastructure; show phases (snapshot → world → BVH → init → evaluate → finalize → paint)
4. **Retained RT3D coverage state**: `rt3dExpLastCoverage`, `rt3dExpCanvas`, `rt3dExpMeta` (already exist)
5. **Paint path**: On completion, `rt3dExpPaint()` → `rt3dExpCanvas` + `rt3dExpMeta` → `draw2d()` renders it
6. **No `?rt3d=1` required**: All experimental gating (`RT3D_EXP_ENABLED`) removed for production path

### Files/Functions Affected
| File/Function | Before | After |
|---------------|--------|-------|
| `index.html` top bar | `btnHeat` (toggle), `btnTrace` (legacy RT) | Add `btnSimulate` (primary, "Simular cobertura") |
| `rt3dExpRunCoverage()` | Only under `?rt3d=1`, writes to experimental panel | Always available; publishes to main UI via `onDone` |
| `rt3dExpWorkerStart()` | Called from experimental panel | Called from new `btnSimulate` click handler |
| `showToast()` progress | Used by legacy RT and experimental | Used by new workflow with phase labels |
| `draw2d()` | Renders `heatCanvas` OR `rt3dExpCanvas` | Renders `rt3dExpCanvas` when RT3D result exists and is current |
| `rt3dExpPaint()` | Development-only, no smoothing | Production path; direct binning, no interpolation |

### Behavior Before → After
| Aspect | Before | After |
|--------|--------|-------|
| Simulate Coverage entry | `btnTrace` (legacy RT) or `?rt3d=1` panel | `btnSimulate` (primary, always visible) |
| Engine selection | User chooses in experimental panel | Fixed: RT3D (authoritative) |
| Progress display | Legacy: toast with %; Experimental: panel | Toast with phase labels + progress bar + cancel |
| Cancel | Legacy: none; Experimental: button | Toast cancel button → `rt3dExpWorkerCancel()` |
| Result display | Legacy: smoothed heatmap; Experimental: raw cells | Raw RT3D cells (authoritative), no smoothing |
| Stale handling | Implicit (re-run on any change) | Explicit freshness model (see 8B) |

### Tests Required
- Click `btnSimulate` → worker boots → progress phases render → completion paints RT3D coverage
- Cancel mid-run → previous display preserved, toast shows "cancelled — previous display untouched"
- Switch floors during run → run completes for original floor, result painted when that floor is active
- No `?rt3d=1` required; works on clean page load

### Migration/Compatibility
- No project file changes (runtime state only)
- Old projects load unchanged; `loadProject()` migration block unchanged
- Legacy `runRayTrace()` remains callable for regression (see 8C)

### Risk
- **Medium**: Worker bootstrap failure must surface cleanly (already throws in `rt3dExpWorkerEnsure()`)
- **Low**: Progress/cancel UX reuses existing toast infrastructure

### Acceptance Criteria
- [ ] `btnSimulate` visible in top bar, labelled "Simular cobertura" / "Simulate Coverage"
- [ ] Click runs RT3D in worker, shows phased progress, supports cancel
- [ ] Completion paints authoritative RT3D coverage (raw cells, no smoothing)
- [ ] No `?rt3d=1` needed; works on production URL
- [ ] Live Preview (`btnHeat` toggle) unchanged — instant, smoothed, interactive

---

## 8B — Freshness / Stale-State Integration

### Current State
- No explicit freshness model
- `scheduleHeat()` debounced (90ms) → `computeHeatSimple()` runs on any RF-relevant change
- Legacy RT (`runRayTrace()`) manual; result stays in `heatGridRssi` until next `scheduleHeat()` or manual re-run
- RT3D experimental: `rt3dExpLastResult` cached per floor; switching floors drops it from display

### Required Freshness Model
```
NO_SIMULATION   → (user clicks Simular cobertura) → SIMULATING
SIMULATING      → (worker completes)               → CURRENT
CURRENT         → (RF-relevant edit)               → STALE
STALE           → (user clicks Simular cobertura)  → SIMULATING
```

### Mutations That Invalidate Freshness (mark STALE)
| Mutation Family | Detection Point |
|-----------------|-----------------|
| AP position/configuration | `scheduleHeat()` calls, property panel commits |
| Walls (add/move/delete/material/height/thickness) | `geometryChanged()`, `commit()` in wall handlers |
| Pillars (add/move/delete/material/height/diameter) | `commit()` in pillar handlers |
| RF Objects (add/move/delete/material/extraLoss/rotation/size) | `commit()` in rfobj handlers |
| Floors/heights (add/remove/change height) | `setActiveFloor()`, floor panel commits |
| Slab (material/extraLoss/openings) | `commit()` in slab panel |
| Ceiling Areas (add/delete/material/extraLoss/height/thickness) | `ceilingCreate()`, property commits |
| Materials/losses (db change) | `buildMaterials()` commit |
| Receiver height | `receiverHeight` slider commit |
| RF settings affecting Coverage(x,y,z) | `plExp`, `slabDb`, `band`, `noiseFloor`, `covThreshold`, `indoorOnly` changes |

### Implementation
- Add `simulationFreshness` state: `{ status: 'NO_SIMULATION'|'SIMULATING'|'CURRENT'|'STALE', floorId, timestamp }`
- On RT3D completion: `status = 'CURRENT', floorId = activeFloor.id`
- On any mutation above: if `status === 'CURRENT' && mutation.floorId === floorId` → `status = 'STALE'`
- UI: `btnSimulate` shows badge/state (CURRENT: green check; STALE: amber warning; NO_SIMULATION: neutral)
- Clicking `btnSimulate` when STALE → runs new simulation (no auto-recompute)

### Files/Functions Affected
| File/Function | Change |
|---------------|--------|
| `state` initialization | Add `simulationFreshness` field |
| `scheduleHeat()` | Only triggers Live Preview; does NOT affect RT3D freshness |
| All `commit()` calls for RF-relevant mutations | Set `simulationFreshness.status = 'STALE'` if current |
| `rt3dExpRunCoverage()` completion | Set `simulationFreshness = { status: 'CURRENT', floorId, timestamp }` |
| `btnSimulate` rendering | Reflect freshness state (CSS class / tooltip) |
| `draw2d()` | If STALE and showing RT3D, overlay "stale" indicator chip |

### Tests Required
- Edit AP position after RT3D complete → status becomes STALE
- Edit wall material → STALE
- Change floor height → STALE
- Switch floor → STALE (result tied to floorId)
- Click Simular cobertura on STALE → runs new simulation → CURRENT
- Live Preview edits (move AP) → instant preview updates, RT3D stays STALE (not recomputed)

### Migration/Compatibility
- `simulationFreshness` is **ephemeral** (not in project JSON)
- No persistence needed; survives only within session
- Old projects: `simulationFreshness` starts as `NO_SIMULATION`

### Risk
- **Low**: Purely additive state; no RF math changes
- **Medium**: Must correctly identify all mutation families (list above is exhaustive based on code audit)

### Acceptance Criteria
- [ ] Freshness state transitions correctly on all listed mutations
- [ ] UI clearly indicates CURRENT vs STALE vs NO_SIMULATION
- [ ] STALE result remains visible (authoritative until refreshed)
- [ ] No auto-recompute on STALE; user must click Simular cobertura

---

## 8C — Legacy/Dev Cleanup and Final Acceptance

### Current Legacy/Experimental Surface
| Component | User-Visible? | Purpose |
|-----------|---------------|---------|
| `btnTrace` (top bar) | Yes | Runs legacy `runRayTrace()` |
| `runRayTrace()` | Via `btnTrace` | 2.5D ray marching, azimuth-only antenna |
| `?rt3d=1` panel (`rt3dExpPanel`) | Only with flag | Engine selector, fan presets, run buttons, audit |
| `rt3dExpRunLegacy()` | In experimental panel | Runs legacy RT, caches for comparison |
| `rt3dExpRunRt3d()` / `rt3dExpRunCoverage()` | In experimental panel | Runs Stage-5 fan or Stage-6 coverage |
| `rt3dAudit*` (probe, delta map, report) | In experimental panel | Development diagnostics |
| `rt3dExpWorker*` | Internal | Worker transport (Stage 7A.1) |

### Disposition
| Component | Classification | Action |
|-----------|----------------|--------|
| `btnTrace` | **REMOVE** | Legacy RT not a user choice; keep function for tests |
| `runRayTrace()` | **KEEP DEV-ONLY** | Callable via console: `runRayTrace()` for regression |
| `?rt3d=1` gate (`RT3D_EXP_ENABLED`) | **REMOVE AFTER MIGRATION** | Production path no longer gated |
| `rt3dExpPanel` (engine selector, fan presets) | **REMOVE AFTER MIGRATION** | Replaced by `btnSimulate` |
| `rt3dExpRunLegacy()` | **KEEP DEV-ONLY** | Callable via console for differential audit |
| `rt3dAudit*` (probe, delta, report) | **KEEP DEV-ONLY** | Accessible via console: `rt3dAuditProbeAt()`, `rt3dAuditBuildDeltaMap()`, `rt3dAuditDownloadReport()` |
| `rt3dExpWorker*` | **PROMOTE TO NORMAL PRODUCT** | Worker is now the standard execution path |
| `rt3d-core.js` / `rt3d-worker.js` | **PROMOTE TO NORMAL PRODUCT** | Core protocol and worker runtime |

### Least Invasive Dev Access
- Legacy functions remain in global scope (not removed)
- Add `window.__RT3D_DEV__ = { runRayTrace, rt3dAuditProbeAt, rt3dAuditBuildDeltaMap, rt3dAuditDownloadReport, rt3dAuditSliceDiagnostics }`
- No UI surface; developer opens console and calls directly
- `?rt3d=1` query parameter **removed entirely** — no flag needed

### Files/Functions Affected
| File/Function | Change |
|---------------|--------|
| Top bar HTML | Remove `btnTrace`; add `btnSimulate` |
| `RT3D_EXP_ENABLED` constant | Remove; all gated code paths always active |
| `rt3dExpBuildPanel()` | Remove (or guard behind `window.__RT3D_DEV__`) |
| `rt3dExpInit()` | Remove auto-init; `btnSimulate` handler initializes worker |
| `rt3dExpSetView()` | Remove (engine selector gone) |
| `draw2d()` | Remove `rt3dExpActive()` branch; always render `rt3dExpCanvas` when RT3D result exists and is current |
| `window.__RT3D_DEV__` | Add object exposing dev-only functions |

### Tests Required
- `runRayTrace()` callable from console → produces legacy heatmap
- `rt3dAuditProbeAt(x,y)` callable from console → returns probe record
- `rt3dAuditDownloadReport()` callable from console → downloads .md
- No `?rt3d=1` in URL; all production features work
- No experimental panel renders without dev flag

### Migration/Compatibility
- No project file changes
- Worker code (`rt3d-core.js`, `rt3d-worker.js`) promoted to production — no changes needed
- Legacy `runRayTrace()` byte-identical (frozen oracle preserved)

### Risk
- **Low**: Removing UI surface only; functions preserved for dev
- **Medium**: Ensure no dead code paths remain referencing removed panel elements

### Acceptance Criteria
- [ ] `btnTrace` removed from top bar
- [ ] `?rt3d=1` does nothing (flag removed)
- [ ] `runRayTrace()` works from console
- [ ] `rt3dAudit*` functions work from console
- [ ] Worker is standard execution path for Simular cobertura
- [ ] No experimental panel renders in production

---

## Blockers for Stage 8A

**STAGE 8A READY: YES**

No blockers identified. All required infrastructure exists:
- ✅ RT3D Coverage Field engine (`rt3dCoverageSlice`, `rt3dCoverageAt`, `rt3dCoverageColumn`)
- ✅ Worker transport (`rt3d-worker.js`, `rt3d-core.js`, `rt3dExpWorkerStart`)
- ✅ Progress/cancel protocol (phased progress, jobId guarding, cancellation)
- ✅ Paint path (`rt3dExpPaint`, `rt3dExpCanvas`, `rt3dExpMeta`)
- ✅ Project snapshot serialization (already used by worker)
- ✅ Toast/progress UI infrastructure
- ✅ Freshness model can be added as pure state (no RF changes)

**All Stage 7 work is complete and validated.** Stage 8A is a pure integration/wiring task.

---

## Summary of Substage Dependencies

```
8A (Simulate Coverage workflow)
  ├─ Requires: Worker, RT3D engine, paint path — ALL DONE
  ├─ Delivers: btnSimulate, worker launch, progress UI, RT3D result display
  └─ Enables: 8B (freshness tracking needs a "current simulation" concept)

8B (Freshness/Stale state)
  ├─ Requires: 8A complete (simulation exists to be fresh/stale)
  ├─ Delivers: Deterministic freshness state, STALE badge, no auto-recompute
  └─ Enables: 8C (cleanup can remove experimental panel once production path is solid)

8C (Legacy/Dev cleanup)
  ├─ Requires: 8A+8B complete (production path fully functional)
  ├─ Delivers: Clean production UI, dev-only console access, no ?rt3d=1
  └─ Final acceptance gate
```