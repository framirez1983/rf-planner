// Stage 9A — Tomography prototype regressions.
//
// Proves, without touching RF math:
//   1. RUN_VOLUME builds the RF world once and reuses it for every plane.
//   2. Returned planes carry the requested absolute Zs.
//   3. rt3dVolumePlanes() always includes the exact receiver-height plane,
//      is sorted ascending, stays inside the floor, caps at 4, and derives
//      from floor height (no hardcoded absolute heights).
//   4. Each volume plane is bit-identical to an independent
//      rt3dCoverageSlice() call with the same state/spec/planeZ.
//   5. Cancellation emits CANCELLED and no COMPLETE (no partial publish).
//   6. App-level abort/error paths never assign rt3dVolume (prior valid
//      volume survives cancel/error by construction).
//   7. An RF edit after launch makes the retained volume STALE by revision
//      comparison (Stage 8B rule); the volume is never serialized.
//   8. 3D placement uses planeZ - floorElevation(); presentation uses the
//      existing rssiColor(); legacy heatCanvas/heatGridRssi is never a
//      volume RF source.
//   9. Single-slice RUN_SLICE still works (backward compatible).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RT3DCore, mainEnv, workerEnv, manualTick, runProtocol } from './worker-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const APP_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(id, name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${String(id).padStart(2)}. ${name}`); }
  else {
    fail++; failures.push(`${id}. ${name}${detail ? ' :: ' + detail : ''}`);
    console.log(`  FAIL ${String(id).padStart(2)}. ${name}${detail ? ' :: ' + detail : ''}`);
  }
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');
}
const CODE = stripComments(APP_HTML);
function fnSegment(name, endMarker) {
  const i = CODE.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const j = endMarker ? CODE.indexOf(endMarker, i) : -1;
  return j < 0 ? CODE.slice(i) : CODE.slice(i, j);
}

const SCENE = `
  state=freshState();
  var f=state.floors[0];
  f.id='flr_pb'; f.name='PB'; f.w=12; f.d=8; f.height=3.0;
  f.walls=[]; f.pillars=[]; f.rfObjects=[]; f.ceilingAreas=[]; f.openings=[]; f.aps=[];
  var M=state.materials[4].id;
  f.walls.push({id:'w1',x1:-6,y1:-4,x2:6,y2:-4,materialId:M,thickness:0.15});
  f.walls.push({id:'w2',x1:-6,y1:4,x2:6,y2:4,materialId:M,thickness:0.15});
  f.walls.push({id:'w3',x1:0,y1:-4,x2:0,y2:4,materialId:M,thickness:0.15});
  var ap=makeAP(-3,0,'AP1',3.0); ap.mount=2.6; f.aps.push(ap);
  state.activeFloor=0; state.receiverHeight=1.2;`;
const SPEC = { cols: 24, rows: 16, cell: 0.5, cw: 0.5, ch: 0.5, raySpacing: 0.5,
               b: { minx: -6, miny: -4, maxx: 6, maxy: 4 } };

// ---------------------------------------------------------------
// A. Plane placement rules (main env, real helpers)
// ---------------------------------------------------------------
const main = mainEnv();
main.run(SCENE);

const planesJson = main.run(`JSON.stringify((function(){
  var elev=floorElevation(0), rx=elev+receiverHeight();
  var zs=rt3dVolumePlanes(0);
  return { zs:zs, rx:rx, elev:elev, h:state.floors[0].height };
})())`);
const P = JSON.parse(planesJson);
check(1, 'volume planes: 1..4 planes returned', P.zs.length >= 1 && P.zs.length <= 4, JSON.stringify(P.zs));
check(2, 'volume planes: receiver-height plane always included exactly',
  P.zs.some(z => z === P.rx), `rx=${P.rx} zs=${JSON.stringify(P.zs)}`);
check(3, 'volume planes: sorted ascending',
  P.zs.every((z, i, a) => i === 0 || a[i - 1] < z), JSON.stringify(P.zs));
check(4, 'volume planes: all inside the floor interior',
  P.zs.every(z => z >= P.elev && z <= P.elev + P.h), JSON.stringify(P.zs));
// Derived from floor height: a taller floor must move the non-receiver planes.
const tallJson = main.run(`JSON.stringify((function(){
  state.floors[0].height=4.5;
  var zs=rt3dVolumePlanes(0);
  state.floors[0].height=3.0;
  return zs;
})())`);
const tall = JSON.parse(tallJson);
check(5, 'volume planes: derived from floor height, not hardcoded',
  JSON.stringify(tall) !== JSON.stringify(P.zs) && tall.some(z => z === P.rx),
  `h=3: ${JSON.stringify(P.zs)} h=4.5: ${JSON.stringify(tall)}`);
check(6, 'placement helper: local Y is planeZ - floorElevation',
  main.run(`(rt3dVolumePlaneLocalY(${P.rx}, 0) === ${P.rx} - floorElevation(0))`) === true);

// ---------------------------------------------------------------
// B. RUN_VOLUME: one world build, correct Zs, bit-identical planes
// ---------------------------------------------------------------
const worker = workerEnv();
worker.run(SCENE);
worker.run(`globalThis.__builds=0;
  globalThis.__origBuildWorld=rt3dBuildWorld;
  globalThis.rt3dBuildWorld=function(){ globalThis.__builds++; return globalThis.__origBuildWorld.apply(this, arguments); };`);
worker.run(`var __SNAP={ state: JSON.parse(JSON.stringify(state, function(k,v){ return k==='_img'?undefined:v; })),
  floorIndex: state.activeFloor, spec: ${JSON.stringify(SPEC)},
  zs: [0.4, 1.2, 2.55] };`);
const snapshot = worker.run('__SNAP');

const tick = manualTick();
const { messages } = runProtocol(worker, snapshot, { jobId: 1, tick });
tick.flushAll();
const done = messages.find(m => m.type === 'COMPLETE');
check(7, 'RUN_VOLUME completes through the canonical protocol', !!done,
  JSON.stringify(messages.map(m => m.type)));
check(8, 'RUN_VOLUME builds the RF world exactly once',
  worker.run('globalThis.__builds') === 1, `builds=${worker.run('globalThis.__builds')}`);
check(9, 'RUN_VOLUME returns the requested absolute Zs',
  !!done && JSON.stringify(done.planeZs) === JSON.stringify([0.4, 1.2, 2.55]),
  done ? JSON.stringify(done.planeZs) : 'no COMPLETE');
check(10, 'RUN_VOLUME planes carry per-plane absolute Z + matching diagnostics',
  !!done && done.planes.length === 3 &&
    done.planes.every((p, i) => p.planeZ === [0.4, 1.2, 2.55][i] &&
      p.diagnostics.receiverPlaneZ === p.planeZ),
  done ? JSON.stringify(done.planes.map(p => p.planeZ)) : 'no COMPLETE');

// Bit-identity vs independent rt3dCoverageSlice with same state/spec/planeZ.
function sig(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    out.push(v === -Infinity ? '-Inf' : String(v));
  }
  return out.join(',');
}
let identical = !!done, identityDetail = '';
if (done) {
  main.run(`var __W=rt3dBuildWorld(); var __S=rt3dCoverageSources(); var __SPEC=${JSON.stringify(SPEC)};`);
  for (let i = 0; i < 3; i++) {
    const z = [0.4, 1.2, 2.55][i];
    const ref = main.run(`JSON.stringify((function(){
      var s=rt3dCoverageSlice(__W, __SPEC, ${z}, {sources:__S, backend:'bvh'});
      function s2(a){ var o=[]; for(var k=0;k<a.length;k++){ var v=a[k]; o.push(v===-Infinity?'-Inf':String(v)); } return o.join(','); }
      return { best:s2(s.best), ap:s2(s.apBest), valid:s2(s.valid),
               eval:s.evaluatedCells, validCells:s.validCells, noSig:s.noSignalCells };
    })())`);
    const r = JSON.parse(ref);
    const vp = done.planes[i];
    const vb = sig(vp.grid.best), va = sig(vp.grid.apBest), vv = sig(vp.grid.valid);
    // Cross-realm arrays: the worker's Float32Array text uses the same
    // shortest-round-trip formatting, so text equality is bit equality.
    const same = vb === r.best && va === r.ap && vv === r.valid &&
      vp.evaluatedCells === r.eval && vp.validCells === r.validCells && vp.noSignalCells === r.noSig;
    if (!same) {
      identical = false;
      identityDetail = `plane ${z}: eval ${vp.evaluatedCells}/${r.eval}, ` +
        `best[0..3]=${vb.slice(0, 32)} vs ${r.best.slice(0, 32)}`;
      break;
    }
  }
}
check(11, 'each volume plane is bit-identical to an independent CoverageSlice', identical, identityDetail);

// ---------------------------------------------------------------
// C. Cancellation: no partial publish; single-slice intact
// ---------------------------------------------------------------
const worker2 = workerEnv();
worker2.run(SCENE);
worker2.run(`var __SNAP2={ state: JSON.parse(JSON.stringify(state, function(k,v){ return k==='_img'?undefined:v; })),
  floorIndex: state.activeFloor, spec: ${JSON.stringify(SPEC)},
  zs: [0.4, 1.2, 2.55] };`);
const tick2 = manualTick();
const run2 = runProtocol(worker2, worker2.run('__SNAP2'),
  { jobId: 2, tick: tick2, options: { timeBudgetMs: 0 } });
tick2.flushOne(); tick2.flushOne();   // step + first evaluation chunk
run2.handle.cancel();
tick2.flushAll();
const types2 = run2.messages.map(m => m.type);
check(12, 'cancelled volume emits CANCELLED and no COMPLETE (no partial publish)',
  types2.includes('CANCELLED') && !types2.includes('COMPLETE'), types2.join(','));

// Single-slice backward compatibility through the same runner.
const worker3 = workerEnv();
worker3.run(SCENE);
worker3.run(`var __SNAP3={ state: JSON.parse(JSON.stringify(state, function(k,v){ return k==='_img'?undefined:v; })),
  floorIndex: state.activeFloor, spec: ${JSON.stringify(SPEC)}, planeZ: 1.2,
  columnX: 0, columnY: 0, columnZs: [] };`);
const tick3 = manualTick();
const run3 = runProtocol(worker3, worker3.run('__SNAP3'), { jobId: 3, tick: tick3 });
tick3.flushAll();
const done3 = run3.messages.find(m => m.type === 'COMPLETE');
check(13, 'single-slice RUN_SLICE still completes without a volume flag',
  !!done3 && !done3.volume && !!done3.grid && !!done3.grid.best, run3.messages.map(m => m.type).join(','));

// ---------------------------------------------------------------
// D. App-level structural guarantees (comment-stripped source)
// ---------------------------------------------------------------
const volSeg = fnSegment('runVolumeCoverage', 'const RT3D_AUDIT_TRUTH_HIERARCHY');
check(14, 'volume launch code exists as one contained unit', !!volSeg && volSeg.length > 1000);
const volAssigns = (volSeg.match(/rt3dVolume\s*=/g) || []).length;
check(15, 'only COMPLETE publishes the volume (abort/error assign nothing)',
  volAssigns === 1, `rt3dVolume= occurrences: ${volAssigns}`);
const paintSeg = fnSegment('rt3dVolumePaintPlane', 'function refresh3dVolume');
check(16, 'volume presentation paints through the existing rssiColor()',
  !!paintSeg && paintSeg.includes('rssiColor('), 'rssiColor not referenced');
check(17, 'volume paint reads only the retained plane array (no legacy source)',
  !!paintSeg && !paintSeg.includes('heatGridRssi') && !paintSeg.includes('heatCanvas') &&
    !paintSeg.includes('heatGridDisp'), 'legacy heat grid referenced');
const refrSeg = fnSegment('refresh3dVolume', 'function rt3dExpWorkerStartVolume');
check(18, '3D refresh uses canonical local Y and plane geometry',
  !!refrSeg && refrSeg.includes('rt3dVolumePlaneLocalY(') && refrSeg.includes('PlaneGeometry'),
  'placement helper or PlaneGeometry missing');
check(19, '3D refresh never uses legacy heatCanvas as an RF source',
  !!refrSeg && !refrSeg.includes('heatCanvas'), 'heatCanvas referenced');
check(20, 'volume uses no smoothing painter (only the exact cell painter)',
  !!refrSeg && refrSeg.includes('rt3dVolumePaintPlane') && !refrSeg.includes('paintHeat('),
  'paintHeat referenced');

// ---------------------------------------------------------------
// E. Freshness + non-serialization (live app env)
// ---------------------------------------------------------------
main.run(`rfRevision=0;
  rt3dVolume={ floorId: state.floors[0].id, floorIndex: 0, elev: 0,
    spec: null, zs: [], planes: [],
    meta: { simulationRevision: 0, simulationStartRevision: 0 } };`);
check(21, 'retained volume is CURRENT at its simulation revision',
  main.run('rt3dVolumeFresh()') === true);
main.run('markRfChanged()');
check(22, 'an RF edit makes the retained volume STALE by revision comparison',
  main.run('rt3dVolumeFresh()') === false);
const serJson = main.run('JSON.stringify(serialize())');
check(23, 'retained volume is never serialized into project JSON',
  !serJson.includes('rt3dVolume') && !serJson.includes('"volume"'),
  serJson.slice(0, 120));
const snapJson = main.run('snapState()');
check(24, 'retained volume is never in undo history snapshots',
  !snapJson.includes('rt3dVolume'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('  - ' + failures.join('\n  - '));
  process.exit(1);
}
