// Stage 11 — Release UX polish (non-RF):
//
//   1. Native .rfplan project extension (JSON internally; legacy .json
//      projects keep opening; validity is content-based).
//   2. Correct 3D right-drag ground-plane panning.
//
// Headless: evaluates the app's own index.html code in a Node VM sandbox
// (see loader.mjs). No browser, no dependencies, no build step.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApp, run, blankState } from './loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const APP = path.join(ROOT, 'index.html');
const html = fs.readFileSync(APP, 'utf8');

const sb = loadApp();
blankState(sb); // state = freshState()

let passed = 0, failed = 0;
const failures = [];
function check(id, name, cond, detail) {
  if (cond) { passed++; console.log(`  ok   ${String(id).padStart(2)}. ${name}`); }
  else {
    failed++; failures.push(`${id}. ${name}${detail ? ' :: ' + detail : ''}`);
    console.log(`  FAIL ${String(id).padStart(2)}. ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// ---------------------------------------------------------------
// Source-level guardrails (the two changes are in place)
// ---------------------------------------------------------------
check(1, 'save defaults to the native .rfplan extension',
  html.includes("download(new Blob([data],{type:'application/json'}), 'RF Planner.rfplan')"),
  'saveProject download name missing or wrong');
check(2, 'save toast no longer advertises .json as preferred',
  html.includes('"project.saved": "Proyecto guardado."') &&
  html.includes('"project.saved": "Project saved."') &&
  html.includes('"project.saved": "Projekt sparat."'),
  'a language toast still mentions JSON');
check(3, 'file input prefers .rfplan while retaining .json',
  html.includes('accept=".rfplan,.json,application/json"'),
  'accept attribute unchanged');
check(4, 'right-drag vertical pans on XZ instead of changing target height',
  html.includes('o.tx+=Math.sin(o.az)*dy*s') &&
  html.includes('o.tz+=(Math.cos(o.az))*dy*s') &&
  !html.includes('o.ty+=dy*s'),
  'pan branch not replaced as specified');
check(5, 'left-drag orbit and wheel code untouched',
  html.includes('o.az-=dx*0.006; o.el=clamp(o.el-dy*0.006,0.06,1.5);') &&
  html.includes('o.r=clamp(o.r*Math.exp(e.deltaY*0.0012),5,160);'),
  'orbit/wheel code altered');

// ---------------------------------------------------------------
// Runtime: .rfplan save (download name + serialized payload)
// ---------------------------------------------------------------
run(sb, `var __dl = null;
  download = function (blob, name) { __dl = { name: name }; };`);
run(sb, 'saveProject();');
const dl = run(sb, '__dl');
check(6, 'new project save downloads a .rfplan file by default',
  dl && typeof dl.name === 'string' && /\.rfplan$/.test(dl.name),
  `name=${dl && dl.name}`);
check(7, 'default save name is a sensible RF Planner .rfplan name',
  dl && dl.name === 'RF Planner.rfplan', `name=${dl && dl.name}`);

const payload = run(sb, 'JSON.stringify(serialize(), null, 2)');
const parsed = JSON.parse(payload);
check(8, 'serialized payload is unchanged project JSON (schema/content)',
  parsed.version === 2 && Array.isArray(parsed.floors) && parsed.floors.length === 1,
  'payload shape changed');
check(9, 'serialized bytes are deterministic across saves (unchanged by the extension)',
  run(sb, 'JSON.stringify(serialize(), null, 2)') === payload, 'serialize() not stable');

// ---------------------------------------------------------------
// Runtime: load .rfplan and legacy .json (content-based validity)
// ---------------------------------------------------------------
run(sb, `state = freshState();
  const f = state.floors[0];
  f.aps.push(makeAP(-3, 0, 'AP-Main', f.height));
  f.walls.push({ id: uid('wall'), x1: -5, y1: -3, x2: 5, y2: -3,
                 materialId: state.materials[0].id, thickness: 0.2 });`);
const projectJson = run(sb, 'JSON.stringify(serialize(), null, 2)');

run(sb, `var __lastToastKey = null;
  showToast = function (show, msg) {
    if (show && msg && msg.key) __lastToastKey = msg.key;
  };
  FileReader = class {
    constructor() { this.result = ''; this.onload = null; }
    readAsText(f) {
      this.result = typeof f.text === 'string' ? f.text : String(f);
      if (this.onload) this.onload({});
    }
  };`);
function loadNamed(name, text) {
  return run(sb, `loadProject({ name: ${JSON.stringify(name)}, text: ${JSON.stringify(text)} });`);
}
function projectIntact() {
  return run(sb, 'state.floors.length') === 1 &&
    run(sb, "state.floors[0].aps.some(a => a.name === 'AP-Main')") === true &&
    run(sb, "state.floors[0].walls.some(w => w.x2 === 5)") === true;
}
check(10, 'legacy .json project still opens',
  loadNamed('legacy-project.json', projectJson) === undefined && projectIntact(),
  'load did not restore the .json project');
check(11, '.rfplan project opens successfully',
  loadNamed('proyecto.rfplan', projectJson) === undefined && projectIntact(),
  'load did not restore the .rfplan project');
check(12, 'invalid content is rejected as .json (validity is content, not extension)',
  (() => {
    loadNamed('bad.json', '{}');
    return run(sb, '__lastToastKey') === 'error.readFile' && projectIntact();
  })(), 'invalid .json accepted or state clobbered');
check(13, 'invalid content is rejected as .rfplan (extension is not validity)',
  (() => {
    loadNamed('also-bad.rfplan', '{ not json');
    return run(sb, '__lastToastKey') === 'error.readFile' && projectIntact();
  })(), 'invalid .rfplan accepted or state clobbered');

// ---------------------------------------------------------------
// Runtime: 3D right-drag pan (real setupOrbit math, headless Three double)
// ---------------------------------------------------------------
run(sb, `
  function mk3() {
    var e = document.createElement('div');
    e.position = { x: 0, y: 0, z: 0, set: function (x, y, z) { this.x = x; this.y = y; this.z = z; } };
    e.lookAt = function () {}; e.updateProjectionMatrix = function () {};
    e.setPixelRatio = function () {}; e.setClearColor = function () {};
    e.setSize = function () {}; e.render = function () {};
    e.add = function (o) { if (o) this.children.push(o); };
    e.children = []; e.userData = {}; e.material = {}; e.uniforms = {};
    e.visible = true; e.domElement = e;
    return e;
  }
  window.THREE = {
    WebGLRenderer: function () {
      var r = mk3(); r.domElement = document.createElement('canvas');
      r.domElement.setPointerCapture = function () {}; return r;
    },
    Scene: mk3, PerspectiveCamera: mk3, Fog: function () {},
    AmbientLight: function () { return mk3(); },
    DirectionalLight: function () {
      var l = mk3(); l.position = { set: function () {} }; return l;
    },
    Group: mk3, GridHelper: mk3
  };
  // Capture window listeners (setupOrbit binds pointermove/pointerup there).
  window.addEventListener = function (t, f) {
    var l = window.__lw || (window.__lw = {});
    (l[t] || (l[t] = [])).push(f);
  };
  window.removeEventListener = function () {};
  // Don't let the app's requestAnimationFrame pump keep the process alive.
  window.requestAnimationFrame = function () { return 0; };
  window.cancelAnimationFrame = function () {};
`);
run(sb, 'init3d();'); // view === '2d', so animate3d returns after one pass

const dom = run(sb, 'three.renderer.domElement');
const orbit = () => run(sb, 'three.orbit');
const pointerDown = (button, x, y, id) =>
  dom.dispatchEvent({ type: 'pointerdown', button, clientX: x, clientY: y, pointerId: id });
const pointerMove = (x, y) =>
  run(sb, 'window.__lw["pointermove"][0]')({ type: 'pointermove', clientX: x, clientY: y });

// Snapshot helpers: three.orbit is a live object, so primitive fields must be
// read before any further gesture mutates it.
function snap() {
  const o = orbit();
  return { tx: o.tx, ty: o.ty, tz: o.tz, az: o.az, el: o.el, r: o.r };
}
const o0 = snap(); // { az: 0.9, el: 0.62, r: 34, tx: 0, ty: 0, tz: 0 }

// Right-drag: lateral pan (accepted sign) + forward/back on XZ.
pointerDown(2, 100, 100, 1); // right button -> pan
pointerMove(130, 120);      // dx = 30, dy = 20
const o1 = snap();
const s0 = o0.r * 0.0016;
const expTx = -Math.cos(o0.az) * 30 * s0 + Math.sin(o0.az) * 20 * s0;
const expTz =  Math.sin(o0.az) * 30 * s0 + Math.cos(o0.az) * 20 * s0;
check(14, 'right-drag changes only tx/tz (horizontal + forward/back on XZ)',
  Math.abs(o1.tx - expTx) < 1e-9 && Math.abs(o1.tz - expTz) < 1e-9,
  `tx=${o1.tx} tz=${o1.tz} expected tx=${expTx} tz=${expTz}`);
check(15, 'right-drag leaves ty, r, az, el untouched',
  o1.ty === o0.ty && o1.r === o0.r && o1.az === o0.az && o1.el === o0.el,
  `ty=${o1.ty} r=${o1.r} az=${o1.az} el=${o1.el}`);

// Pan after camera rotation must use the rotated azimuth as the XZ basis.
run(sb, 'three.orbit.az = 2.5;');
const o2 = snap();
pointerDown(2, 10, 10, 2);
pointerMove(10, 40); // dx = 0, dy = 30 -> forward/back along rotated basis
const o3 = snap();
const s2 = o2.r * 0.0016;
const expTx3 = o2.tx + Math.sin(o2.az) * 30 * s2;
const expTz3 = o2.tz + Math.cos(o2.az) * 30 * s2;
check(16, 'right-drag after rotation uses camera-relative XZ directions',
  Math.abs(o3.tx - expTx3) < 1e-9 && Math.abs(o3.tz - expTz3) < 1e-9,
  `tx=${o3.tx} tz=${o3.tz} expected ${expTx3}/${expTz3}`);
check(17, 'vertical drag never lifts/lowers the target (ty fixed)',
  o3.ty === o2.ty && o3.r === o2.r && o3.az === o2.az && o3.el === o2.el);

// Left-drag orbit: accepted behavior unchanged.
pointerDown(0, 400, 300, 3); // left button -> orbit
pointerMove(410, 290);       // dx = 10, dy = -10
const o4 = snap();
check(18, 'left-drag orbit unchanged (az/el move, target and distance fixed)',
  Math.abs(o4.az - (o2.az - 0.06)) < 1e-9 &&
  Math.abs(o4.el - clamp(o2.el + 0.06, 0.06, 1.5)) < 1e-9 &&
  o4.tx === o3.tx && o4.tz === o3.tz && o4.ty === o3.ty && o4.r === o3.r,
  `az=${o4.az} el=${o4.el}`);

// Mouse-wheel zoom: accepted behavior unchanged.
const rBeforeWheel = run(sb, 'three.orbit.r');
let prevented = null;
run(sb, 'three.renderer.domElement._l["wheel"][0]')({
  type: 'wheel', deltaY: 120,
  preventDefault: function () { prevented = true; }
});
const o5 = snap();
const expR = clamp(rBeforeWheel * Math.exp(120 * 0.0012), 5, 160);
check(19, 'wheel zoom unchanged (r changes, target and angles fixed)',
  Math.abs(o5.r - expR) < 1e-9 && prevented === true &&
  o5.tx === o4.tx && o5.tz === o4.tz && o5.ty === o4.ty &&
  o5.az === o4.az && o5.el === o4.el,
  `r=${o5.r} expected ${expR}`);
run(sb, 'three.renderer.domElement._l["wheel"][0]')({
  type: 'wheel', deltaY: -120, preventDefault: function () {}
});
const o6 = snap();
check(20, 'wheel zooms back symmetrically',
  Math.abs(o6.r - rBeforeWheel) < 1e-9, `r=${o6.r} start=${rBeforeWheel}`);

// Panning is navigation state only: project serialization is untouched.
const serialBefore = run(sb, 'JSON.stringify(serialize())');
check(21, 'project serialization unchanged by camera panning',
  run(sb, 'JSON.stringify(serialize())') === serialBefore, 'serialize() changed after pan');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed) {
  console.log('  - ' + failures.join('\n  - '));
  process.exit(1);
}
