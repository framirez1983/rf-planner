// Stage 9B — Volumetric coverage cloud regressions.
//
// The cloud is DISPLAY ONLY over the exact Stage 9A samples. This suite
// proves, without a GPU:
//   1. Packing never modifies the authoritative Float32 samples.
//   2. Packed bins match the specified 0.5 dB visualization quantization.
//   3. LUT colors derive from the existing rssiColor(); LUT alpha carries
//      extinction density, not a fixed opacity.
//   4. Nonuniform zs[] maps physical Z to the correct fractional layer
//      (the JS reference the GLSL volumeLayerAt() mirrors).
//   5. Eight-plane default keeps the exact receiver-height plane.
//   6. Opacity is step-length/density based (1-exp(-d*dt)) and therefore
//      stable across raymarch step counts — not a fixed per-step alpha.
//   7. WebGL2 absence / forced sheets keeps the Stage 9A sheets path.
//   8. The cloud is excluded from the opaque depth prepass.
//   9. Freshness, non-serialization and the untouched 2D path still hold.
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
function constSegment(name, endMarker) {
  const i = CODE.indexOf('const ' + name + '=');
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
  var ap=makeAP(-3,0,'AP1',3.0); ap.mount=2.6; f.aps.push(ap);
  state.activeFloor=0; state.receiverHeight=1.2;`;

const main = mainEnv();
main.run(SCENE);

// ---------------------------------------------------------------
// A. Quantization bins (0.5 dB, display only)
// ---------------------------------------------------------------
const q = (v) => main.run(`rt3dVolumeQuantize(${v})`);
check(1, 'quantize: bin centers map to 0.5 dB bins',
  q(-40) === 120 && q(-67) === 66 && q(-92) === 16 && q(-100) === 0 && q(-30) === 140,
  [-40, -67, -92, -100, -30].map(v => `${v}->${q(v)}`).join(' '));
check(2, 'quantize: invalid/no-signal reserves bin 0',
  main.run('(rt3dVolumeQuantize(-Infinity)===0)') === true);
check(3, 'dequantize round-trips within half a bin (0.25 dB)',
  main.run(`(function(){
    var qs=[1,16,66,120,140,200,255];
    return qs.every(function(b){ return Math.abs(rt3dVolumeDequantize(b)-(b/2-100))<1e-9; });
  })()`) === true);

// ---------------------------------------------------------------
// B. Density transfer (display coefficients, centralized)
// ---------------------------------------------------------------
const d = (v) => main.run(`rt3dVolumeDensityAt(${v})`);
check(4, 'density: strong > medium > weak > faint > zero ordering',
  d(-40) > d(-60) && d(-60) > d(-70) && d(-70) > d(-85) && d(-85) > 0,
  [-40, -60, -70, -85].map(v => `${v}:${d(v)}`).join(' '));
check(5, 'density: invalid and sub-floor RSSI are exactly zero',
  d(-Infinity) === 0 && d(-95) === 0 && d(-100) === 0);
check(6, 'density: continuous across band edges (no opacity cliff)',
  Math.abs(d(-55.001) - d(-54.999)) < 0.01 &&
  Math.abs(d(-67.001) - d(-66.999)) < 0.05 &&
  Math.abs(d(-80.001) - d(-79.999)) < 0.05,
  [-55, -67, -80].map(v => `${v}: ${d(v - 0.001)} vs ${d(v + 0.001)}`).join(' ; '));
check(7, 'density: not tied to project coverageThreshold',
  (() => {
    const seg = fnSegment('rt3dVolumeDensityAt', 'function rt3dVolumeLayerAt');
    return !!seg && !seg.includes('covThreshold');
  })(), 'coverageThreshold referenced in density');

// ---------------------------------------------------------------
// C. Nonuniform Z -> fractional layer (deliberately irregular zs)
// ---------------------------------------------------------------
const NZ = [0.2, 0.9, 2.1, 2.6];   // gaps 0.7, 1.2, 0.5: nonuniform on purpose
const lay = (z) => main.run(`rt3dVolumeLayerAt(${z}, ${JSON.stringify(NZ)})`);
const approx = (a, b) => Math.abs(a - b) < 1e-9;
check(8, 'layer map: exact planes hit integer layers',
  approx(lay(0.2), 0) && approx(lay(0.9), 1) && approx(lay(2.1), 2) && approx(lay(2.6), 3),
  NZ.map((z, i) => `${z}->${lay(z)} (want ${i})`).join(' '));
check(9, 'layer map: interior points interpolate by TRUE spacing, not layer index',
  approx(lay(0.55), 0.5) && approx(lay(1.5), 1.5) && approx(lay(2.35), 2.5),
  `0.55->${lay(0.55)} 1.5->${lay(1.5)} 2.35->${lay(2.35)}`);
check(10, 'layer map: outside the sampled span clamps to the nearest layer',
  approx(lay(-5), 0) && approx(lay(99), 3));
check(11, 'GLSL mirrors the tested mapping (bracket + fractional t)',
  (() => {
    const frag = constSegment('RT3D_CLOUD_FRAG', 'function refresh3dCloud');
    return !!frag && frag.includes('volumeLayerAt') && frag.includes('(wz - z0)') &&
      frag.includes('uZs[i') && frag.includes('float(i) +');
  })(), 'bracketing logic missing from shader');

// ---------------------------------------------------------------
// D. Packing keeps Float32 authority intact; LUT derives from rssiColor
// ---------------------------------------------------------------
main.run(`var __B1=new Float32Array([-40.123,-67.7,-Infinity,-92.4]);
  var __B2=new Float32Array([-55.0,-80.2,-100,-72.9]);
  var __SPEC={cols:2,rows:2,cell:0.5,cw:0.5,ch:0.5,raySpacing:0.5,
              b:{minx:0,miny:0,maxx:1,maxy:1}};
  function __sig(a){ var o=[]; for(var k=0;k<a.length;k++){ var v=a[k];
    o.push(v===-Infinity?'-Inf':String(v)); } return o.join(','); }
  var __before=__sig(__B1)+'|'+__sig(__B2);
  var __PACK=rt3dVolumePackPlanes(__SPEC,[{best:__B1},{best:__B2}]);
  var __after=__sig(__B1)+'|'+__sig(__B2);`);
check(12, 'packing never modifies the authoritative Float32 samples',
  main.run('(__before===__after)') === true);
const packed = main.run('Array.from(__PACK.data)');
check(13, 'packed bytes equal the specified quantization of the exact values',
  JSON.stringify(packed) === JSON.stringify([120, 65, 0, 15, 90, 40, 0, 54]),
  JSON.stringify(packed));
check(14, 'packed brick layout is layer-major over the shared grid',
  main.run('(__PACK.cols===2&&__PACK.rows===2&&__PACK.depth===2&&__PACK.data.length===8)') === true);
const lutOk = main.run(`(function(){
  var lut=rt3dVolumeBuildLUT();
  if(lut.length!==1024) return 'len '+lut.length;
  var qs=[0,1,15,16,40,56,65,66,90,120,140,200,255];
  for(var n=0;n<qs.length;n++){
    var b=qs[n], r=b/2-100, c=rssiColor(r);
    if(lut[b*4]!==c[0]||lut[b*4+1]!==c[1]||lut[b*4+2]!==c[2]) return 'rgb bin '+b;
    var da=Math.round(Math.min(Math.max(rt3dVolumeDensityAt(r)/RT3D_VOLUME_DMAX,0),1)*255);
    if(lut[b*4+3]!==da) return 'density bin '+b;
  }
  return 'ok';
})()`);
check(15, 'LUT colors derive from rssiColor(); LUT alpha carries density',
  lutOk === 'ok', String(lutOk));

// ---------------------------------------------------------------
// E. Eight-plane default keeps the exact receiver plane
// ---------------------------------------------------------------
const p8 = JSON.parse(main.run(`JSON.stringify((function(){
  var elev=floorElevation(0), rx=elev+receiverHeight();
  var zs=rt3dVolumePlanes(0);
  return { zs:zs, rx:rx };
})())`));
check(16, 'default volume uses up to 8 planes',
  p8.zs.length >= 1 && p8.zs.length <= 8, JSON.stringify(p8.zs));
check(17, 'receiver-height plane remains included exactly with 8 planes',
  p8.zs.some(z => z === p8.rx), `rx=${p8.rx} zs=${JSON.stringify(p8.zs)}`);
check(18, 'planes stay sorted ascending inside the floor',
  p8.zs.every((z, i, a) => i === 0 || a[i - 1] < z), JSON.stringify(p8.zs));

// ---------------------------------------------------------------
// F. Volumetric opacity: 1-exp(-d*dt), stable across step counts
// ---------------------------------------------------------------
const integ = (dd, L, s) => main.run(`rt3dVolumeIntegrateUniform(${dd},${L},${s})`);
const a64 = integ(0.3, 8, 64), a96 = integ(0.3, 8, 96);
check(19, 'integrated opacity is stable when step count changes 64 -> 96',
  Math.abs(a64 - a96) < 1e-9, `64:${a64} 96:${a96}`);
check(20, 'per-step alpha derives from physical step length (not fixed)',
  (() => {
    // A fixed per-step alpha would give identical per-step values at any
    // step count; the physical form must differ per dt yet integrate equal.
    const s64 = 1 - Math.exp(-0.3 * (8 / 64));
    const s96 = 1 - Math.exp(-0.3 * (8 / 96));
    return Math.abs(s64 - s96) > 1e-6 && Math.abs(a64 - a96) < 1e-9;
  })(), 'formulation is not step-length based');
check(21, 'shader computes per-step alpha from density and step length',
  (() => {
    const frag = constSegment('RT3D_CLOUD_FRAG', 'function refresh3dCloud');
    return !!frag && frag.includes('exp(-dens * dt)') && !frag.includes('0.85');
  })(), 'exp(-density*dt) missing or fixed alpha present');

// ---------------------------------------------------------------
// G. Product behavior: fallback, depth exclusion, freshness
// ---------------------------------------------------------------
check(22, 'cloud/sheets are exclusive with sheets as the fallback',
  (() => {
    const seg = fnSegment('update3dVolumeView', 'function volumeDepthPrepass');
    const rc = fnSegment('refresh3dCloud', 'function update3dVolumeView');
    return !!seg && seg.includes('refresh3dCloud') && seg.includes('refresh3dVolume') &&
      !!rc && rc.includes('rt3dCloudSupported') && rc.includes('rt3dVolumeSheetsForced');
  })(), 'exclusive view coordination missing');
check(23, 'depth prepass hides transparent geometry (cloud included) and restores it',
  (() => {
    const seg = fnSegment('volumeDepthPrepass', 'STAGE 6.5');
    return !!seg && seg.includes('o.material.transparent') && seg.includes('o.visible=false') &&
      seg.includes('finally') && seg.includes('o.visible=true');
  })(), 'hide/restore missing');
check(24, 'cloud material itself is transparent (excluded by the prepass rule)',
  CODE.includes('cloudMesh=new THREE.Mesh(g,m)') &&
    CODE.includes('transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide'),
  'cloud material flags wrong');
main.run(`rfRevision=0;
  rt3dVolume={ floorId: state.floors[0].id, floorIndex: 0, elev: 0,
    spec: null, zs: [], planes: [],
    meta: { simulationRevision: 0, simulationStartRevision: 0 } };`);
check(25, 'STALE behavior preserved: CURRENT at revision, STALE after RF edit',
  main.run('rt3dVolumeFresh()') === true &&
  (main.run('markRfChanged()'), main.run('rt3dVolumeFresh()') === false));
check(26, 'runtime volume still never serialized',
  !main.run('JSON.stringify(serialize())').includes('rt3dVolume') &&
  !main.run('snapState()').includes('rt3dVolume'));
check(27, 'authoritative 2D path untouched by the cloud (no cloud refs in slice run)',
  (() => {
    const a = CODE.indexOf('function runSimulateCoverage');
    const b = CODE.indexOf('const RT3D_VOLUME_CELL', a);
    const seg = CODE.slice(a, b < 0 ? undefined : b);
    return !/cloud/i.test(seg) && seg.includes('rt3dExpWorkerStart(snapshot');
  })(), 'cloud leaked into the 2D run');

// ---------------------------------------------------------------
// H. Browser regression: native GLSL3, axis swizzle, blending, fallback
// ---------------------------------------------------------------
const VERT = constSegment('RT3D_CLOUD_VERT', 'const RT3D_CLOUD_FRAG');
const FRAG = constSegment('RT3D_CLOUD_FRAG', 'function refresh3dCloud');
check(28, 'GLSL3 fragment declares its own output, no gl_FragColor alias',
  !!VERT && !!FRAG && FRAG.includes('out vec4 fragColor') &&
    !FRAG.includes('gl_FragColor') && !VERT.includes('gl_FragColor'),
  'explicit out vec4 fragColor missing or gl_FragColor still used');
check(29, 'samplers carry explicit precision; native texture() only',
  !!FRAG && FRAG.includes('uniform highp sampler3D uVol') &&
    FRAG.includes('uniform highp sampler2D uLUT') &&
    FRAG.includes('texture(uVol,') && !FRAG.includes('texture2D') &&
    !VERT.includes('texture2D'),
  'precision qualifier or native texture() call missing');
check(30, 'vertex/fragment varyings use matching native out/in, no varying keyword',
  !!VERT && !!FRAG && VERT.includes('out vec3 vWorldPos') &&
    FRAG.includes('in vec3 vWorldPos') &&
    !VERT.includes('varying') && !FRAG.includes('varying'),
  'out/in mismatch or legacy varying keyword present');
// Deliberately asymmetric: X span 10, Y span 4, nonuniform Z gaps 0.5/1.5.
// Any X/Y/Z swap moves the wrong component.
const AB = { minx: 0, maxx: 10, miny: 0, maxy: 4 };
const AZ = [0.5, 1.0, 2.5];
const tc = (x, y, z) => JSON.parse(main.run(
  `JSON.stringify(rt3dVolumeTexCoord(${x},${y},${z},${JSON.stringify(AB)},${JSON.stringify(AZ)}))`));
const triple = (t) => t.map(v => +v.toFixed(9));
check(31, 'texcoord: project X -> u, project Y -> v, worldZ -> layer (asymmetric grid)',
  JSON.stringify(triple(tc(2.5, 1.0, 0.75))) === JSON.stringify([0.25, 0.25, 0.5]) &&
  JSON.stringify(triple(tc(7.5, 3.0, 1.75))) === JSON.stringify([0.75, 0.75, 1.5]),
  `(2.5,1,0.75)->${tc(2.5, 1.0, 0.75)} (7.5,3,1.75)->${tc(7.5, 3.0, 1.75)}`);
check(32, 'texcoord: each axis moves exactly one component (swap-proof)',
  (() => {
    const ax0 = tc(0, 1, 0.75), ax1 = tc(10, 1, 0.75);
    const ay0 = tc(2.5, 0, 0.75), ay1 = tc(2.5, 4, 0.75);
    const az0 = tc(2.5, 1, 0.5), az1 = tc(2.5, 1, 2.5);
    return ax0[0] === 0 && ax1[0] === 1 && ax0[1] === ax1[1] && ax0[2] === ax1[2] &&
      ay0[1] === 0 && ay1[1] === 1 && ay0[0] === ay1[0] && ay0[2] === ay1[2] &&
      az0[2] === 0 && az1[2] === 2 && az0[0] === az1[0] && az0[1] === az1[1];
  })(), 'axis cross-talk: a swap would move the wrong component');
check(33, 'shader samples vec3(uvw.x, uvw.z, layer), never the transposed swizzle',
  !!FRAG && FRAG.includes('vec3(uvw.x, uvw.z,') && !FRAG.includes('vec3(uvw.x, uvw.y,'),
  'axis swizzle wrong or ambiguous');
check(34, 'compositing is internally consistent: associated output + premultiplied blending',
  !!FRAG && FRAG.includes('fragColor = vec4(acc * uMaxOpacity, rawAlpha * uMaxOpacity)') &&
    CODE.includes('premultipliedAlpha: true') &&
    !CODE.includes('PremultipliedAlphaBlending'),
  'output/blending mismatch would double-multiply alpha');
check(35, 'cloud program failure falls back to sheets via runnable diagnostics',
  CODE.includes('function cloudProgramFailed(') &&
    CODE.includes('p.diagnostics.runnable===false') &&
    CODE.includes('three.cloudFailed=true') &&
    CODE.includes('clearCloudMesh(); refresh3dVolume();') &&
    CODE.includes('if(three.cloudFailed) return false;'),
  'watchdog or sticky-failure refusal missing');

// ---------------------------------------------------------------
// I. Browser regression #2: R8 upload contract + r128 blending API
// ---------------------------------------------------------------
// r128 API facts, verified against the r128 sources (Constants.js,
// DataTexture3D.js, Texture.js, WebGLTextures.js, WebGLState.js):
//   * RedFormat exists; RED+UNSIGNED_BYTE selects internal format R8,
//     which is color-filterable in WebGL2 core (LinearFilter is legal).
//   * DataTexture3D defaults to RGBAFormat (4 bytes/texel) -- the exact
//     cause of the 50048-vs-12512 upload warning with a 1-byte brick.
//   * Texture.unpackAlignment exists (DataTexture3D defaults it to 1).
//   * r128 has NO PremultipliedAlphaBlending constant; NormalBlending +
//     material.premultipliedAlpha=true yields ONE / ONE_MINUS_SRC_ALPHA.
check(36, 'single-channel brick holds exactly cols*rows*depth bytes (not x4)',
  main.run(`(function(){
    var p=rt3dVolumePackPlanes({cols:7,rows:5},
      [{best:new Float32Array(35).fill(-60)},{best:new Float32Array(35).fill(-80)}]);
    return p.data.length===7*5*2 && p.data.BYTES_PER_ELEMENT===1;
  })()`) === true);
check(37, 'volume texture declares RedFormat/UnsignedByteType to match the brick',
  (CODE.includes('volTex.format=THREE.RedFormat')||CODE.includes('cloudVolTex.format=THREE.RedFormat')) &&
    (CODE.includes('volTex.type=THREE.UnsignedByteType')||CODE.includes('cloudVolTex.type=THREE.UnsignedByteType')),
  'format/type do not match single-channel storage');
check(38, 'volume texture sets unpackAlignment=1 explicitly (no assumed default)',
  (CODE.includes('volTex.unpackAlignment=1')||CODE.includes('cloudVolTex.unpackAlignment=1')),
  'unpack alignment assumed, not set');
check(39, 'no undefined blending constants; only r128 blending API is used',
  (() => {
    if (CODE.includes('PremultipliedAlphaBlending')) return false;
    // Allowlist.traced from r128 Constants.js: 0,1,2,3,4,5 only.
    const refs = CODE.match(/THREE\.\w+Blending/g) || [];
    const ok = ['THREE.NoBlending', 'THREE.NormalBlending', 'THREE.AdditiveBlending',
      'THREE.SubtractiveBlending', 'THREE.MultiplyBlending', 'THREE.CustomBlending'];
    const bad = refs.filter(r => ok.indexOf(r) < 0);
    if (bad.length) { check.__bad = bad.join(','); return false; }
    return CODE.includes('premultipliedAlpha: true');
  })(), 'unknown blending constant referenced' + (check.__bad ? ': ' + check.__bad : ''));
check(40, 'cloud is renderable only after its resources validate; else sheets stay',
  (() => {
    const seg = fnSegment('rt3dCloudMeshFor', 'function refresh3dCloud');
    return !!seg && seg.includes('pack.data.length!==pack.cols*pack.rows*pack.depth') &&
      seg.includes('if(!(pack.cols>0&&pack.rows>0&&pack.depth>0)) return null');
  })(), 'byte-length/dimension gate missing before sheets are hidden');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('  - ' + failures.join('\n  - '));
  process.exit(1);
}
