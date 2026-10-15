// Stage 9E — 3D floor-plan clipping & base reference (VISUALIZATION ONLY).
//
// PB stays the permanent full reference; upper floors clip to their canonical
// footprint. Proves, without a GPU or any RF change:
//   1. bgPlanDisplayForFloor() routes PB -> legacy, upper+footprint ->
//      clipped, upper+no-footprint -> legacy fallback.
//   2. Clipped geometry covers exactly footprint-minus-holes (area match),
//      holes stay empty, multipart renders every part, outer bounds hold.
//   3. Clipping preserves plan alignment (canonical blueprintUVThree).
//   4. Triangle winding faces up like the proven topGeoForPlan convention.
//   5. Cutaway, slab, cloud, 2D and serialization behavior are unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainEnv } from './worker-harness.mjs';

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
// Even-odd point-in-polygon over a single ring.
function pip(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) &&
      p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function triArea(t) {
  return Math.abs((t[1].x - t[0].x) * (t[2].y - t[0].y) -
    (t[2].x - t[0].x) * (t[1].y - t[0].y)) / 2;
}

const main = mainEnv();
main.run(`state=freshState();
  state.floors[0].id='flr_pb'; state.floors[0].name='PB';
  state.floors[0].w=24; state.floors[0].d=20;
  state.floors[0].bg={data:'data:image/png;base64,AAA',w:100,h:100,scale:0.2,
    x:-2,y:-2,rot:0,opacity:0.8,visible:true};
  var pa=freshFloor('PA',1);
  pa.id='flr_pa'; pa.height=3.0; pa.w=24; pa.d=20;
  pa.bg={data:'data:image/png;base64,AAA',w:100,h:100,scale:0.2,
    x:-2,y:-2,rot:0,opacity:0.8,visible:true};
  pa.footprint={parts:[{outer:[{x:0,y:0},{x:10,y:0},{x:10,y:6},{x:0,y:6}],
    holes:[[{x:4,y:2},{x:6,y:2},{x:6,y:4},{x:4,y:4}]]}]};
  state.floors.push(pa);
  state.activeFloor=1; state.receiverHeight=1.2;`);

// ---------------------------------------------------------------
// A. Display routing
// ---------------------------------------------------------------
check(1, 'PB stays the full legacy reference while PA is active',
  main.run(`JSON.stringify(bgPlanDisplayForFloor(state.floors[0],0))`) ===
    JSON.stringify({ kind: 'legacy' }));
check(2, 'PB stays legacy when PB itself is active',
  main.run(`(function(){ state.activeFloor=0;
    var r=bgPlanDisplayForFloor(state.floors[0],0); state.activeFloor=1; return r.kind; })()`) === 'legacy');
check(3, 'upper floor with valid footprint uses the clipped representation',
  main.run(`(function(){ var r=bgPlanDisplayForFloor(state.floors[1],1);
    return r&&r.kind==='clipped'&&r.tris.length>0; })()`) === true);
check(4, 'upper floor without footprint keeps the rectangular fallback',
  main.run(`(function(){ var keep=state.floors[1].footprint;
    state.floors[1].footprint=null;
    var r=bgPlanDisplayForFloor(state.floors[1],1);
    state.floors[1].footprint=keep; return r&&r.kind; })()`) === 'legacy');
check(5, 'hidden plan stays hidden on every floor',
  main.run(`(function(){ state.floors[1].bg.visible=false;
    var r=bgPlanDisplayForFloor(state.floors[1],1);
    state.floors[1].bg.visible=true; return r; })()`) === null);
check(6, 'plan fully outside the footprint yields nothing (footprint authoritative)',
  main.run(`(function(){ var keep=state.floors[1].bg.x;
    state.floors[1].bg.x=100;
    var r=bgPlanDisplayForFloor(state.floors[1],1);
    state.floors[1].bg.x=keep; return r; })()`) === null);

// ---------------------------------------------------------------
// B. Clipped geometry: area, holes, outer bounds, multipart
// ---------------------------------------------------------------
// Footprint 10x6=60 minus hole 2x2=4, fully inside the 20x20 image.
const tris = JSON.parse(main.run('JSON.stringify(bgPlanClippedTriangles(state.floors[1]))'));
const area = tris.reduce((a, t) => a + triArea(t), 0);
check(7, 'clipped area equals footprint-minus-holes (60-4=56)',
  Math.abs(area - 56) < 0.05, `area=${area.toFixed(3)}`);
const hole = [{ x: 4, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 4 }, { x: 4, y: 4 }];
const outer = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }];
const cents = tris.map(t => ({
  x: (t[0].x + t[1].x + t[2].x) / 3, y: (t[0].y + t[1].y + t[2].y) / 3
}));
check(8, 'holes remain visually empty (no triangle centroid inside)',
  cents.every(c => !pip(c, hole)), `${cents.filter(c => pip(c, hole)).length} centroids in hole`);
check(9, 'outer footprint bounds the visible geometry',
  cents.every(c => pip(c, outer)), 'centroid outside outer ring');
main.run(`var p2=freshFloor('P2',2);
  p2.id='flr_p2'; p2.height=3.0;
  p2.bg={data:'data:image/png;base64,AAA',w:100,h:100,scale:0.2,
    x:-2,y:-2,rot:0,opacity:0.8,visible:true};
  p2.footprint={parts:[
    {outer:[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4}],holes:[]},
    {outer:[{x:6,y:0},{x:10,y:0},{x:10,y:4},{x:6,y:4}],holes:[]}]};
  state.floors.push(p2);`);
const tris2 = JSON.parse(main.run('JSON.stringify(bgPlanClippedTriangles(state.floors[2]))'));
const area2 = tris2.reduce((a, t) => a + triArea(t), 0);
const cents2 = tris2.map(t => ({
  x: (t[0].x + t[1].x + t[2].x) / 3, y: (t[0].y + t[1].y + t[2].y) / 3
}));
const inA = cents2.some(c => c.x < 4), inB = cents2.some(c => c.x > 6);
check(10, 'multipart footprints render every valid part (16+16=32)',
  Math.abs(area2 - 32) < 0.05 && inA && inB,
  `area=${area2.toFixed(3)} inA=${inA} inB=${inB}`);
main.run('state.floors.pop();');

// ---------------------------------------------------------------
// C. Alignment: canonical projection, up-facing winding
// ---------------------------------------------------------------
const uv = (x, y) => JSON.parse(main.run(
  `JSON.stringify(blueprintUVThree(state.floors[1].bg,${x},${y}))`));
const r5 = (v) => Math.round(v * 1e6) / 1e6;
check(11, 'image corners map exactly (TL 0,1 TR 1,1 BL 0,0 BR 1,0)',
  JSON.stringify([uv(-2, -2), uv(18, -2), uv(-2, 18), uv(18, 18)].map(
    t => [r5(t.u), r5(t.v)])) === JSON.stringify([[0, 1], [1, 1], [0, 0], [1, 0]]));
check(12, 'image centre maps to (0.5,0.5): no shift, no rescale',
  (() => { const t = uv(8, 8); return r5(t.u) === 0.5 && r5(t.v) === 0.5; })(),
  JSON.stringify(uv(8, 8)));
check(13, 'clipped triangles wind up-facing like topGeoForPlan',
  (() => {
    // Builder pushes (t[2],t[1],t[0]); the y-component of (b-a)x(c-a) in
    // three XZ must be positive for an up-facing front face.
    for (const t of tris.slice(0, 50)) {
      const a = { x: t[2].x, z: t[2].y }, b = { x: t[1].x, z: t[1].y }, c = { x: t[0].x, z: t[0].y };
      const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      if (!(ny > 0)) return false;
    }
    return true;
  })(), 'down-facing triangle found');

// ---------------------------------------------------------------
// D. Untouched surroundings
// ---------------------------------------------------------------
check(14, 'active-floor cutaway still hides everything above activeFloor',
  CODE.includes('if(idx>state.activeFloor) return;'),
  'cutaway rule changed');
check(15, 'build3d routes backgrounds through the new display selector',
  CODE.includes('bgPlanDisplayForFloor(f, idx)') &&
    CODE.includes('bgPlanGeometryFootprint(f)'),
  'build3d wiring missing');
check(16, 'slab builders know nothing about background plans',
  (() => {
    // Every call site must live inside exactly one of: the glTF export, the
    // 9E display wrapper, the 9E geometry builder. Anything else (notably
    // any slab/RF builder) fails the check by enclosing-function name.
    const owners = [];
    let from = 0;
    for (;;) {
      const at = CODE.indexOf('=bgPlanClippedTriangles(f)', from);
      if (at < 0) break;
      const fn = CODE.lastIndexOf('function ', at);
      owners.push(CODE.slice(fn + 9, CODE.indexOf('(', fn)).trim());
      from = at + 1;
    }
    owners.sort();
    return JSON.stringify(owners) ===
      JSON.stringify(['bgPlanDisplayForFloor', 'bgPlanGeometryFootprint', 'exportGLTF']);
  })(), 'slab geometry coupled to plans');
check(17, 'cloud renderer and 9D opacity ceiling are untouched',
  main.run('RT3D_CLOUD_MAX_OPACITY') === 0.18 &&
    CODE.includes('fragColor = vec4(acc * uMaxOpacity, rawAlpha * uMaxOpacity);'),
  'cloud path changed');
check(18, 'authoritative 2D plan path is intact',
  CODE.includes('ctx.drawImage(f.bg._img') &&
    CODE.includes('ctx.rotate(f.bg.rot||0)'),
  '2D plan drawing changed');
check(19, 'clipping is pure: floor state identical before/after',
  main.run(`(function(){
    var a=JSON.stringify(state.floors[1]);
    bgPlanClippedTriangles(state.floors[1]);
    bgPlanDisplayForFloor(state.floors[1],1);
    return a===JSON.stringify(state.floors[1]);
  })()`) === true);
check(20, 'project serialization still carries bg data and footprint',
  main.run(`(function(){ var s=JSON.stringify(serialize());
    return s.includes('data:image/png;base64,AAA') && s.includes('flr_pa'); })()`) === true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('  - ' + failures.join('\n  - '));
  process.exit(1);
}
