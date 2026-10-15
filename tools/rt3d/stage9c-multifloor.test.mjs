// Stage 9C — Multi-floor volumetric coverage regressions.
//
// One run covers floors 0..activeFloor against a single world/BVH/sources.
// Proves, without touching RF math:
//   1. Active floor N requests exactly floors 0..N (own spec/zs each).
//   2. World built once, sources resolved once, BVH reused (same node
//      count on every plane) for the whole multi-floor run.
//   3. Every returned floor has its own spec/elevation/zs; every plane is
//      bit-identical to an independent canonical CoverageSlice; the exact
//      receiver-height plane is included per floor.
//   4. Combined progress never resets: constant totalCells, monotonic
//      evaluatedCells; cancel publishes no partial multi-floor result.
//   5. Retention: downward/upward switches within maxFloorIndex reuse the
//      result (setActiveFloor clears nothing); above maxFloorIndex needs a
//      rerun; any RF edit makes the whole result STALE; never serialized.
//   6. Rendering shows exactly floors <= activeFloor (clouds and sheets);
//      the depth prepass still runs once per frame with no per-floor loop.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainEnv, workerEnv, manualTick, runProtocol } from './worker-harness.mjs';

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

const SCENE2 = `
  state=freshState();
  var f=state.floors[0];
  f.id='flr_pb'; f.name='PB'; f.w=12; f.d=8; f.height=3.0;
  f.walls=[]; f.pillars=[]; f.rfObjects=[]; f.ceilingAreas=[]; f.openings=[]; f.aps=[];
  var M=state.materials[4].id;
  f.walls.push({id:'w1',x1:-6,y1:-4,x2:6,y2:-4,materialId:M,thickness:0.15});
  f.walls.push({id:'w2',x1:-6,y1:4,x2:6,y2:4,materialId:M,thickness:0.15});
  var ap=makeAP(-3,0,'AP-PB',3.0); ap.mount=2.6; f.aps.push(ap);
  var g=freshFloor('PA',1);
  g.id='flr_pa'; g.height=2.6; g.w=10; g.d=7;
  g.walls.push({id:'v1',x1:-5,y1:-3.5,x2:5,y2:-3.5,materialId:M,thickness:0.15});
  var ap2=makeAP(2,1,'AP-PA',2.6); ap2.mount=2.2; g.aps.push(ap2);
  state.floors.push(g);
  state.activeFloor=1; state.receiverHeight=1.2;`;
const SPEC0 = { cols: 24, rows: 16, cell: 0.5, cw: 0.5, ch: 0.5, raySpacing: 0.5,
                b: { minx: -6, miny: -4, maxx: 6, maxy: 4 } };
const SPEC1 = { cols: 16, rows: 12, cell: 0.5, cw: 0.5, ch: 0.5, raySpacing: 0.5,
                b: { minx: -5, miny: -3.5, maxx: 5, maxy: 3.5 } };
const ZS0 = [0.4, 1.2, 2.55];
const ZS1 = [3.6, 4.4];
const TOTAL = 24 * 16 * 3 + 16 * 12 * 2;   // 1536

// ---------------------------------------------------------------
// A. Request shape: floors 0..N with independent geometry
// ---------------------------------------------------------------
const main = mainEnv();
main.run(SCENE2);
const req = JSON.parse(main.run('JSON.stringify(rt3dVolumeRequestFloors(1))'));
check(1, 'active floor 1 requests exactly floors 0..1',
  req.length === 2 && req[0].floorIndex === 0 && req[1].floorIndex === 1,
  JSON.stringify(req.map(r => r.floorIndex)));
check(2, 'each requested floor carries its own spec and absolute zs',
  req[0].spec.cols > 0 && req[0].spec.rows > 0 && req[1].spec.cols > 0 && req[1].spec.rows > 0 &&
    (req[0].spec.cols !== req[1].spec.cols || req[0].spec.rows !== req[1].spec.rows) &&
    req[0].zs.length > 0 && req[1].zs.length > 0 &&
    req[0].zs.every(z => z < 3.0) && req[1].zs.every(z => z > 3.0),
  `f0: ${req[0].spec.cols}x${req[0].spec.rows} [${req[0].zs}] f1: ${req[1].spec.cols}x${req[1].spec.rows} [${req[1].zs}]`);
check(3, 'request for floor 0 alone carries only floor 0',
  JSON.parse(main.run('JSON.stringify(rt3dVolumeRequestFloors(0))')).length === 1);
const rx = JSON.parse(main.run(`JSON.stringify([0,1].map(function(fi){
  var zs=rt3dVolumePlanes(fi);
  var want=floorElevation(fi)+receiverHeight();
  return { fi:fi, hasRx:zs.some(function(z){return z===want;}) };
}))`));
check(4, 'exact receiver-height plane included independently per floor',
  rx.every(r => r.hasRx), JSON.stringify(rx));

// ---------------------------------------------------------------
// B. One world/BVH/sources for the whole multi-floor run
// ---------------------------------------------------------------
const worker = workerEnv();
worker.run(SCENE2);
worker.run(`globalThis.__builds=0; globalThis.__sources=0;
  globalThis.__origBuildWorld=rt3dBuildWorld;
  globalThis.__origSources=rt3dCoverageSources;
  globalThis.rt3dBuildWorld=function(){ globalThis.__builds++; return globalThis.__origBuildWorld.apply(this,arguments); };
  globalThis.rt3dCoverageSources=function(){ globalThis.__sources++; return globalThis.__origSources.apply(this,arguments); };`);
worker.run(`var __SNAP={ state: JSON.parse(JSON.stringify(state, function(k,v){ return k==='_img'?undefined:v; })),
  activeFloorIndex: 1,
  floors: [ { floorIndex: 0, spec: ${JSON.stringify(SPEC0)}, zs: ${JSON.stringify(ZS0)} },
            { floorIndex: 1, spec: ${JSON.stringify(SPEC1)}, zs: ${JSON.stringify(ZS1)} } ] };`);
const tick = manualTick();
const run = runProtocol(worker, worker.run('__SNAP'),
  { jobId: 1, tick, options: { progressEveryCells: 64 } });
tick.flushAll();
const done = run.messages.find(m => m.type === 'COMPLETE');
check(5, 'multi-floor RUN_VOLUME completes with one COMPLETE',
  !!done && done.multi === true && done.floors.length === 2,
  run.messages.map(m => m.type).join(','));
check(6, 'RF world built exactly once for all floors and planes',
  worker.run('globalThis.__builds') === 1, `builds=${worker.run('globalThis.__builds')}`);
check(7, 'RF sources resolved exactly once for the whole run',
  worker.run('globalThis.__sources') === 1, `resolves=${worker.run('globalThis.__sources')}`);
check(8, 'BVH reused: identical node count on every plane of every floor',
  !!done && done.floors.every(F => F.planes.every(p => p.diagnostics.bvhNodes === done.floors[0].planes[0].diagnostics.bvhNodes)),
  done ? 'node counts differ' : 'no COMPLETE');
check(9, 'each floor returns its own spec, planeZs and plane count',
  !!done && done.floors[0].spec.cols === 24 && done.floors[1].spec.cols === 16 &&
    JSON.stringify(done.floors[0].planeZs) === JSON.stringify(ZS0) &&
    JSON.stringify(done.floors[1].planeZs) === JSON.stringify(ZS1) &&
    done.floors[0].planes.length === 3 && done.floors[1].planes.length === 2,
  done ? JSON.stringify(done.floors.map(F => F.planes.length)) : 'no COMPLETE');

// Bit-identity per plane per floor vs independent canonical slices.
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
  main.run(`var __W=rt3dBuildWorld(); var __S=rt3dCoverageSources();`);
  const floorSpecs = [SPEC0, SPEC1], floorZs = [ZS0, ZS1];
  for (let fi = 0; fi < 2 && identical; fi++) {
    for (let pi = 0; pi < floorZs[fi].length; pi++) {
      const z = floorZs[fi][pi];
      const ref = main.run(`JSON.stringify((function(){
        var s=rt3dCoverageSlice(__W, ${JSON.stringify(floorSpecs[fi])}, ${z}, {sources:__S, backend:'bvh'});
        function s2(a){ var o=[]; for(var k=0;k<a.length;k++){ var v=a[k]; o.push(v===-Infinity?'-Inf':String(v)); } return o.join(','); }
        return { best:s2(s.best), ap:s2(s.apBest), valid:s2(s.valid) };
      })())`);
      const r = JSON.parse(ref);
      const vp = done.floors[fi].planes[pi];
      if (sig(vp.grid.best) !== r.best || sig(vp.grid.apBest) !== r.ap || sig(vp.grid.valid) !== r.valid) {
        identical = false;
        identityDetail = `floor ${fi} plane ${z} differs`;
      }
    }
  }
}
check(10, 'every multi-floor plane is bit-identical to an independent CoverageSlice',
  identical, identityDetail);

// Combined progress: constant denominator, monotonic numerator.
const prog = run.messages.filter(m => m.type === 'PROGRESS');
check(11, 'combined progress covers all floors with one stable denominator',
  prog.length > 0 && prog.every(m => m.totalCells === TOTAL),
  `msgs=${prog.length} totals=${[...new Set(prog.map(m => m.totalCells))].join(',')}`);
check(12, 'progress never resets: evaluatedCells is monotonic to the total',
  prog.every((m, i) => i === 0 || m.evaluatedCells >= prog[i - 1].evaluatedCells) &&
    !!done && done.evaluatedCells === TOTAL && done.totalCells === TOTAL,
  done ? `final ${done.evaluatedCells}/${done.totalCells}` : 'no COMPLETE');

// Cancellation publishes no partial multi-floor result.
const worker2 = workerEnv();
worker2.run(SCENE2);
worker2.run(`var __SNAP2={ state: JSON.parse(JSON.stringify(state, function(k,v){ return k==='_img'?undefined:v; })),
  activeFloorIndex: 1,
  floors: [ { floorIndex: 0, spec: ${JSON.stringify(SPEC0)}, zs: ${JSON.stringify(ZS0)} },
            { floorIndex: 1, spec: ${JSON.stringify(SPEC1)}, zs: ${JSON.stringify(ZS1)} } ] };`);
const tick2 = manualTick();
const run2 = runProtocol(worker2, worker2.run('__SNAP2'),
  { jobId: 2, tick: tick2, options: { timeBudgetMs: 0 } });
tick2.flushOne(); tick2.flushOne();
run2.handle.cancel();
tick2.flushAll();
const types2 = run2.messages.map(m => m.type);
check(13, 'cancelled multi-floor run emits CANCELLED and no partial COMPLETE',
  types2.includes('CANCELLED') && !types2.includes('COMPLETE'), types2.join(','));

// ---------------------------------------------------------------
// C. Retention: reuse within range, rerun above, STALE on edit
// ---------------------------------------------------------------
main.run(`rfRevision=0;
  rt3dVolume={ maxFloorIndex: 1,
    floors: [ { floorId: state.floors[0].id, floorIndex: 0, elev: 0,
                spec: null, zs: [], planes: [] },
              { floorId: state.floors[1].id, floorIndex: 1, elev: 3.0,
                spec: null, zs: [], planes: [] } ],
    meta: { simulationRevision: 0, simulationStartRevision: 0 } };
  state.activeFloor=1;`);
check(14, 'CURRENT while revision matches and active floor is covered',
  main.run('rt3dVolumeFresh()') === true);
main.run('state.activeFloor=0;');
check(15, 'downward switch reuses the retained result without recomputation',
  main.run('rt3dVolumeFresh()') === true &&
  main.run('(rt3dVolumeFloorEntry(0)!==null)') === true);
main.run('state.activeFloor=1;');
check(16, 'switch back upward within range reuses the retained result',
  main.run('rt3dVolumeFresh()') === true &&
  main.run('(rt3dVolumeFloorEntry(1)!==null)') === true);
main.run(`state.floors.push(freshFloor('P2',2)); state.activeFloor=2;`);
check(17, 'floor above maxFloorIndex is not covered: rerun required',
  main.run('rt3dVolumeFresh()') === false);
main.run(`state.floors.pop(); state.activeFloor=1; markRfChanged();`);
check(18, 'any RF edit discards the entire multi-floor result (Stage 10A: no STALE retention)',
  main.run(`productState==='DESIGN'&&rt3dVolume===null`) === true);
main.run(`rt3dVolume={ maxFloorIndex: 1,
    floors: [ { floorId: state.floors[0].id, floorIndex: 0, elev: 0,
                spec: null, zs: [], planes: [] } ],
    meta: { simulationRevision: 0, simulationStartRevision: 0 } };`);
check(19, 'entry lookup identity-gates floors (wrong id yields nothing)',
  main.run(`(function(){
    var keep=rt3dVolume.floors[0].floorId;
    rt3dVolume.floors[0].floorId='nope';
    var r=rt3dVolumeFloorEntry(0)===null;
    rt3dVolume.floors[0].floorId=keep;
    return r;
  })()`) === true);
const setSeg = fnSegment('setActiveFloor', 'function syncFloorPanel');
check(20, 'setActiveFloor never clears the retained volume (reuse by construction)',
  !!setSeg && !setSeg.includes('rt3dVolume=null') && setSeg.includes('updateVolStatus()'),
  'clear found or status not refreshed');
check(21, 'multi-floor result is never serialized',
  !main.run('JSON.stringify(serialize())').includes('rt3dVolume') &&
  !main.run('snapState()').includes('rt3dVolume'));

// ---------------------------------------------------------------
// D. Rendering shows exactly floors <= activeFloor; prepass stays single
// ---------------------------------------------------------------
const cloudSeg = fnSegment('refresh3dCloud', 'function update3dVolumeView');
check(22, 'cloud renderer loops retained floors with cutaway + identity gates',
  !!cloudSeg && cloudSeg.includes('rt3dVolume.floors') &&
    cloudSeg.includes('e.floorIndex>state.activeFloor') &&
    cloudSeg.includes('rt3dVolumeFloorEntry('),
  'multi-floor cloud loop or gates missing');
const sheetSeg = fnSegment('refresh3dVolume', 'function rt3dExpWorkerStartVolume');
check(23, 'sheets fallback loops retained floors with the same gates',
  !!sheetSeg && sheetSeg.includes('rt3dVolume.floors') &&
    sheetSeg.includes('e.floorIndex>state.activeFloor') &&
    sheetSeg.includes('rt3dVolumeFloorEntry('),
  'multi-floor sheets loop or gates missing');
check(24, 'depth prepass still runs once per frame with no per-floor volume loop',
  (() => {
    const seg = fnSegment('volumeDepthPrepass', 'const RT3D_AUDIT_TRUTH_HIERARCHY');
    return !!seg && !seg.includes('rt3dVolume') && seg.includes('o.material.transparent');
  })(), 'prepass gained volume coupling');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('  - ' + failures.join('\n  - '));
  process.exit(1);
}
