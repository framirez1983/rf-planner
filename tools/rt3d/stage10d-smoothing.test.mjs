// Stage 10D — Coverage display smoothing (DISPLAY ONLY, final polish).
//
// Exact Coverage samples are bilinearly interpolated in display space and
// only then colored: stair-steps fade without new RF work, new samples, or
// blur filters. Proves, without touching physics:
//   1. Stored scalar arrays stay byte-identical through painting.
//   2. Painting calls no Coverage/RF and changes no grid spec or resolution.
//   3. On-sample display equals the exact sample; midpoints equal the true
//      bilinear scalar; color is applied after scalar interpolation.
//   4. Invalid boundaries never interpolate across: nearest-exact fallback,
//      transparent stays transparent.
//   5. Preview RF math, 3D cloud, sheets, intensity, serialization untouched.
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

const main = mainEnv();
main.run(`state=freshState(); state.activeFloor=0;
  var __G=new Float32Array([-40,-55,-65,-72, -50,-60,-70,-80, -45,-58,-68,-78]);
  function __sig(a){ var o=[]; for(var k=0;k<a.length;k++){ var v=a[k];
    o.push(v===-Infinity?'-Inf':String(v)); } return o.join(','); }`);

// ---------------------------------------------------------------
// A. Invariants: samples, specs, no RF in paint
// ---------------------------------------------------------------
const before = main.run('__sig(__G)');
main.run(`rt3dExpPaint({spec:{cols:4,rows:3,b:{minx:0,miny:0,maxx:4,maxy:3}},
  grid:{best:__G}});`);
check(1, 'original scalar RF arrays remain byte-identical through painting',
  main.run('__sig(__G)') === before);
const paintSeg = fnSegment('rt3dPaintSmooth', 'function rt3dExpPaint') +
  fnSegment('rt3dBilinearSample', 'function rt3dPaintSmooth');
check(2, 'interpolation never calls Coverage(x,y,z) or any RF model',
  !/Coverage|rssifromAP|rssIFromAP|bestRSSI|cellField|runRayTrace|sinrAt/i
    .test(paintSeg.replace(/rt3dBilinearSample|rt3dPaintSmooth|rt3dExpPaint/g, '')),
  'RF call inside display paint');
check(3, 'physical grid specs and sampling density are unchanged',
  main.run('RT3D_DISPLAY_SCALE') === 2 &&
  main.run('RT3D_VOLUME_MAX_PLANES') === 8 &&
  CODE.includes('const cell=0.16;') && CODE.includes('const cell=RT3D_VOLUME_CELL;'),
  'resolution changed');
check(4, 'painted canvas oversamples display only (2x, same bounds)',
  JSON.parse(main.run(`JSON.stringify((function(){
    var c=rt3dExpPaint({spec:{cols:4,rows:3,b:{minx:0,miny:0,maxx:4,maxy:3}},
      grid:{best:new Float32Array(12).fill(-60)}});
    return [c.width,c.height]; })())`)).join(',') === '8,6');

// ---------------------------------------------------------------
// B. Scalar-first composition: exact centers, true midpoints
// ---------------------------------------------------------------
const at = (x, y) => main.run(`rt3dBilinearSample(__G,4,3,${x},${y})`);
check(5, 'interpolated display at exact sample centers equals the sample',
  at(0, 0) === -40 && at(3, 2) === -78 && at(1, 1) === -60);
check(6, 'midpoint between valid samples gives the correct bilinear scalar',
  Math.abs(at(0.5, 0.5) - (-40 - 55 - 50 - 60) / 4) < 1e-9 &&
  Math.abs(at(1.5, 0.5) - (-55 - 65 - 60 - 70) / 4) < 1e-9,
  `${at(0.5, 0.5)} ${at(1.5, 0.5)}`);
check(7, 'rssiColor is applied after scalar interpolation, never before',
  (() => {
    const seg = fnSegment('rt3dPaintSmooth', 'function rt3dExpPaint');
    return !!seg && seg.indexOf('rt3dBilinearSample') < seg.indexOf('colorFn(') &&
      !seg.includes('Gaussian') && !seg.includes('gauss') &&
      !seg.includes('boxBlur') && !seg.includes('feather');
  })(), 'color-first or blur-based composition');

// ---------------------------------------------------------------
// C. Conservative invalid handling
// ---------------------------------------------------------------
main.run(`var __H=new Float32Array([-Infinity,-55,-65,-72]);`);
check(8, 'validity boundary falls back to nearest exact (never across)',
  main.run('rt3dBilinearSample(__H,2,2,0.5,0.5)') === -72);
main.run(`var __N=new Float32Array([-Infinity,-Infinity,-Infinity,-Infinity]);`);
check(9, 'no-signal neighborhoods stay transparent',
  main.run('rt3dBilinearSample(__N,2,2,0.5,0.5)') === -Infinity &&
  main.run('rt3dBilinearSample(__N,2,2,0,0)') === -Infinity);
check(10, 'degenerate grids cannot fabricate values',
  main.run('rt3dBilinearSample(new Float32Array(0),0,0,0,0)') === -Infinity);

// ---------------------------------------------------------------
// D. Everything else untouched
// ---------------------------------------------------------------
check(11, 'preview RF calculation path is unchanged',
  CODE.includes('bestRSSI(wx,wy,state.activeFloor,mhz)') &&
    CODE.includes('heatmapSmoothing'),
  'preview math touched');
check(12, '3D cloud shader, sampling and sheets are untouched',
  CODE.includes('fragColor = vec4(acc * uMaxOpacity, rawAlpha * uMaxOpacity);') &&
    CODE.includes('volTex.magFilter=THREE.LinearFilter') &&
    CODE.includes('new THREE.DataTexture3D(pack.data') &&
    !fnSegment('rt3dVolumePaintPlane', 'function refresh3dVolume')
      .includes('BilinearSample'),
  '3D path changed');
check(13, 'intensity default and visibility rules are untouched',
  main.run('cloudIntensity') === 0.25 &&
    main.run('RT3D_CLOUD_MAX_OPACITY') === 0.18);
check(14, 'product runtime state stays out of project serialization',
  !main.run('JSON.stringify(serialize())').includes('productState') &&
  !main.run('JSON.stringify(serialize())').includes('RT3D_DISPLAY'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('  - ' + failures.join('\n  - '));
  process.exit(1);
}
