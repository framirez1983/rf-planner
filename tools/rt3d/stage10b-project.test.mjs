// Stage 10B — Whole-project authoritative coverage (PRODUCT SCOPE ONLY).
//
// Simular cobertura simulates EVERY floor against one snapshot/revision:
// fine 2D receiver slices plus volume planes per floor, one shared world,
// one atomic commit. Proves, without touching RF math:
//   1. The project request covers all floors regardless of activeFloor.
//   2. One snapshot/revision feeds every task; world/BVH/sources resolve once.
//   3. Every 2D slice is bit-identical to an independent canonical slice;
//      volume sampling rules (0.48 m x 8 planes) are preserved.
//   4. Progress denominator spans all tasks and never resets; exactly one
//      COMPLETE; cancel publishes nothing partial.
//   5. Commit retains every floor; floor switches never recalculate; 2D shows
//      the matching slice, 3D shows 0..activeFloor; visibility toggles do
//      not recompute; RF edits discard everything.
//   6. The progress card is product-oriented (no engine labels) with working
//      minimize/restore; serialization and RF are untouched.
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
  var ap=makeAP(-3,0,'AP-PB',3.0); ap.mount=2.6; f.aps.push(ap);
  var g=freshFloor('PA',1);
  g.id='flr_pa'; g.height=2.6; g.w=10; g.d=7;
  g.walls.push({id:'v1',x1:-5,y1:-3.5,x2:5,y2:-3.5,materialId:M,thickness:0.15});
  var ap2=makeAP(2,1,'AP-PA',2.6); ap2.mount=2.2; g.aps.push(ap2);
  state.floors.push(g);
  state.activeFloor=0; state.receiverHeight=1.2;`;
// Tiny but shape-faithful specs: 2D uses fine cells, volume coarse cells.
const FINE0 = { cols: 24, rows: 16, cell: 0.16, cw: 0.5, ch: 0.5, raySpacing: 0.5,
                b: { minx: -6, miny: -4, maxx: 6, maxy: 4 } };
const FINE1 = { cols: 20, rows: 14, cell: 0.16, cw: 0.5, ch: 0.5, raySpacing: 0.5,
                b: { minx: -5, miny: -3.5, maxx: 5, maxy: 3.5 } };
const COARSE = { cols: 12, rows: 8, cell: 0.48, cw: 1, ch: 1, raySpacing: 1,
                 b: { minx: -6, miny: -4, maxx: 6, maxy: 4 } };
const COARSE1 = { cols: 10, rows: 7, cell: 0.48, cw: 1, ch: 1, raySpacing: 1,
                  b: { minx: -5, miny: -3.5, maxx: 5, maxy: 3.5 } };
const Z0 = [1.2], Z1 = [4.2];
const TOTAL = 24 * 16 + 20 * 14 + 12 * 8 + 10 * 7;

// ---------------------------------------------------------------
// A. Project request: every floor, both task kinds, any activeFloor
// ---------------------------------------------------------------
const main = mainEnv();
main.run(SCENE2);
const req = JSON.parse(main.run('JSON.stringify(rt3dProjectRequest())'));
check(1, 'request covers every project floor regardless of activeFloor',
  req.twoD.length === 2 && req.volFloors.length === 2 &&
  req.twoD[0].floorIndex === 0 && req.twoD[1].floorIndex === 1 &&
  req.volFloors[0].floorIndex === 0 && req.volFloors[1].floorIndex === 1,
  `2D:${req.twoD.length} vol:${req.volFloors.length} activeFloor=0`);
check(2, '2D tasks use fine specs at receiver height; volume keeps 0.48 m rules',
  req.twoD.every(D => D.spec.cell === 0.16 && Number.isFinite(D.planeZ)) &&
  req.volFloors.every(V => V.spec.cell === 0.48 && V.zs.length >= 1 &&
    V.zs.length <= 8),
  'spec/plane rules changed');

// ---------------------------------------------------------------
// B. One world for the complete job; bit-identical 2D slices
// ---------------------------------------------------------------
const worker = workerEnv();
worker.run(SCENE2);
worker.run(`globalThis.__builds=0; globalThis.__sources=0;
  globalThis.__origBuildWorld=rt3dBuildWorld;
  globalThis.__origSources=rt3dCoverageSources;
  globalThis.rt3dBuildWorld=function(){ globalThis.__builds++; return globalThis.__origBuildWorld.apply(this,arguments); };
  globalThis.rt3dCoverageSources=function(){ globalThis.__sources++; return globalThis.__origSources.apply(this,arguments); };`);
worker.run(`var __SNAP={ state: JSON.parse(JSON.stringify(state, function(k,v){ return k==='_img'?undefined:v; })),
  twoD: [ { floorIndex: 0, spec: ${JSON.stringify(FINE0)}, planeZ: 1.2 },
          { floorIndex: 1, spec: ${JSON.stringify(FINE1)}, planeZ: 4.2 } ],
  floors: [ { floorIndex: 0, spec: ${JSON.stringify(COARSE)}, zs: ${JSON.stringify(Z0)} },
            { floorIndex: 1, spec: ${JSON.stringify(COARSE1)}, zs: ${JSON.stringify(Z1)} } ] };`);
const tick = manualTick();
const run = runProtocol(worker, worker.run('__SNAP'),
  { jobId: 1, tick, options: { progressEveryCells: 32 } });
tick.flushAll();
const done = run.messages.find(m => m.type === 'COMPLETE');
const completes = run.messages.filter(m => m.type === 'COMPLETE').length;
check(3, 'exactly one COMPLETE publishes the whole project (2D + volume)',
  !!done && completes === 1 && done.project === true &&
  done.twoD.length === 2 && done.floors.length === 2,
  run.messages.map(m => m.type).join(','));
check(4, 'RF world built once, sources resolved once for the complete job',
  worker.run('globalThis.__builds') === 1 &&
  worker.run('globalThis.__sources') === 1,
  `builds=${worker.run('globalThis.__builds')} sources=${worker.run('globalThis.__sources')}`);
check(5, 'BVH reused across every task (identical node counts project-wide)',
  !!done && done.twoD.concat(done.floors[0].planes, done.floors[1].planes)
    .every(p => p.diagnostics.bvhNodes === done.twoD[0].diagnostics.bvhNodes),
  'node counts differ');
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
  const jobs = [
    { spec: FINE0, z: 1.2, got: done.twoD[0] },
    { spec: FINE1, z: 4.2, got: done.twoD[1] },
    { spec: COARSE, z: 1.2, got: done.floors[0].planes[0] },
    { spec: COARSE1, z: 4.2, got: done.floors[1].planes[0] },
  ];
  for (const j of jobs) {
    const ref = main.run(`JSON.stringify((function(){
      var s=rt3dCoverageSlice(__W, ${JSON.stringify(j.spec)}, ${j.z}, {sources:__S, backend:'bvh'});
      function s2(a){ var o=[]; for(var k=0;k<a.length;k++){ var v=a[k]; o.push(v===-Infinity?'-Inf':String(v)); } return o.join(','); }
      return { best:s2(s.best), ap:s2(s.apBest), valid:s2(s.valid) };
    })())`);
    const r = JSON.parse(ref);
    if (sig(j.got.grid.best) !== r.best || sig(j.got.grid.apBest) !== r.ap ||
      sig(j.got.grid.valid) !== r.valid) {
      identical = false;
      identityDetail = `floor task z=${j.z} differs`;
      break;
    }
  }
}
check(6, 'every 2D slice and volume plane is bit-identical to an independent slice',
  identical, identityDetail);
const prog = run.messages.filter(m => m.type === 'PROGRESS');
check(7, 'denominator spans all 2D + volume tasks across every floor',
  prog.length > 0 && prog.every(m => m.totalCells === TOTAL),
  `msgs=${prog.length} totals=${[...new Set(prog.map(m => m.totalCells))].join(',')}`);
check(8, 'progress is monotonic across floor and task transitions',
  prog.every((m, i) => i === 0 || m.evaluatedCells >= prog[i - 1].evaluatedCells) &&
    !!done && done.evaluatedCells === TOTAL,
  done ? `final ${done.evaluatedCells}/${done.totalCells}` : 'no COMPLETE');
check(9, 'progress carries product task context (2D vs volume per floor)',
  prog.every(m => (m.kind === 'slice2d' || m.kind === 'vol') &&
    Number.isFinite(m.floorIndex) && Number.isFinite(m.kindIndex)),
  'task context missing');

// Cancellation publishes nothing partial.
const worker2 = workerEnv();
worker2.run(SCENE2);
worker2.run(`var __SNAP2={ state: JSON.parse(JSON.stringify(state, function(k,v){ return k==='_img'?undefined:v; })),
  twoD: [ { floorIndex: 0, spec: ${JSON.stringify(FINE0)}, planeZ: 1.2 } ],
  floors: [ { floorIndex: 0, spec: ${JSON.stringify(COARSE)}, zs: ${JSON.stringify(Z0)} } ] };`);
const tick2 = manualTick();
const run2 = runProtocol(worker2, worker2.run('__SNAP2'),
  { jobId: 2, tick: tick2, options: { timeBudgetMs: 0 } });
tick2.flushOne(); tick2.flushOne();
run2.handle.cancel();
tick2.flushAll();
const types2 = run2.messages.map(m => m.type);
check(10, 'cancelled project run emits CANCELLED and no partial COMPLETE',
  types2.includes('CANCELLED') && !types2.includes('COMPLETE'), types2.join(','));

// ---------------------------------------------------------------
// C. Commit retains every floor; switches and toggles never recalculate
// ---------------------------------------------------------------
main.run(`rfRevision=0;
  var __P={ twoD:[
    { floorIndex:0, spec:${JSON.stringify(FINE0)}, planeZ:1.2,
      grid:{ best:new Float32Array(24*16).fill(-60), apBest:new Int16Array(24*16).fill(0), valid:new Uint8Array(24*16).fill(1) } },
    { floorIndex:1, spec:${JSON.stringify(FINE1)}, planeZ:4.2,
      grid:{ best:new Float32Array(20*14).fill(-70), apBest:new Int16Array(20*14).fill(0), valid:new Uint8Array(20*14).fill(1) } } ],
    floors:[
    { floorIndex:0, spec:${JSON.stringify(COARSE)}, planeZs:${JSON.stringify(Z0)},
      planes:[{ planeZ:1.2, grid:{ best:new Float32Array(96).fill(-60), apBest:new Int16Array(96).fill(0), valid:new Uint8Array(96).fill(1) },
        evaluatedCells:96, validCells:96, noSignalCells:0, diagnostics:{} }] },
    { floorIndex:1, spec:${JSON.stringify(COARSE1)}, planeZs:${JSON.stringify(Z1)},
      planes:[{ planeZ:4.2, grid:{ best:new Float32Array(70).fill(-70), apBest:new Int16Array(70).fill(0), valid:new Uint8Array(70).fill(1) },
        evaluatedCells:70, validCells:70, noSignalCells:0, diagnostics:{} }] } ],
    sources:[] };
  var __S={ floors: state.floors.map(function(f){ return {id:f.id}; }) };
  rt3dProjectCommit(__P, __S, 0);`);
check(11, 'commit retains every floor in both products with canvases',
  main.run(`(rt3dAuth2D&&rt3dAuth2D.floors.length===2&&
    rt3dAuth2D.floors.every(function(e){return !!e.canvas;})&&
    rt3dVolume&&rt3dVolume.floors.length===2&&
    rt3dVolume.maxFloorIndex===1&&
    rt3dAuth2D.meta.simulationRevision===0)`) === true);
check(12, '2D floor switch displays the retained matching slice',
  main.run(`(function(){ state.activeFloor=1; auth2DSyncView();
    return rt3dNormalActive===true&&rt3dNormalMeta.floorId===state.floors[1].id; })()`) === true);
main.run(`state.activeFloor=0; auth2DSyncView();`);
check(13, 'switching back restores the first floor without recomputation',
  main.run(`rt3dNormalActive===true&&rt3dNormalMeta.floorId===state.floors[0].id`) === true);
check(14, 'visibility toggles never launch a worker job',
  (() => {
    const seg = fnSegment('onCoverageToggle', 'function updateSimStatus');
    return !!seg && !seg.includes('Worker') && !seg.includes('runProject') &&
      !seg.includes('runSimulate') && !seg.includes('runVolumeCoverage');
  })(), 'toggle triggers computation');
main.run(`productState='SIMULATED'; showAuthoritative=false;`);
check(15, 'Show coverage OFF/ON hides and restores without recalculation',
  main.run('authVisible()') === false &&
  (main.run('showAuthoritative=true; authVisible()') === true));
main.run(`markRfChanged();`);
check(16, 'RF edit discards the complete project result',
  main.run(`productState==='DESIGN'&&rt3dAuth2D===null&&rt3dVolume===null`) === true);

// ---------------------------------------------------------------
// D. Product card: no engine labels, working minimize
// ---------------------------------------------------------------
const card = fnSegment('runProjectCoverage', 'function runAuthoritativeCoverage');
check(17, 'progress card never names engines or pipeline stages',
  !!card && card.includes("t('auth.simulating')") &&
    !card.includes('RT3D COVERAGE FIELD') && !card.includes('Stage 6') &&
    !card.includes('rt3d.cov.title'),
  'diagnostic label leaked into product card');
check(18, 'card shows task context, stats and phase checklist in three languages',
  !!card && card.includes("t('auth.task'") && card.includes('auth.task2d') &&
    card.includes('auth.taskVol') && card.includes("t('auth.cells'") &&
    ['es', 'en', 'sv'].every(L => APP_HTML.includes(`"auth.simulating":`) && true) &&
    ['Simulando cobertura', 'Simulating coverage', 'Simulerar täckning']
      .every(s => APP_HTML.includes(s)),
  'task/i18n content missing');
check(19, 'minimized card stays concise with restore affordance',
  !!card && card.includes("data-action=\"restore\"") &&
    card.includes('·') && card.includes("t('common.restore')"),
  'minimized form missing');
check(20, 'project serialization carries no product runtime state',
  !main.run('JSON.stringify(serialize())').includes('productState') &&
  !main.run('JSON.stringify(serialize())').includes('rt3dAuth2D'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('  - ' + failures.join('\n  - '));
  process.exit(1);
}
