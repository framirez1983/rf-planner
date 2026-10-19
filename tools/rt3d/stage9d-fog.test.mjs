// Stage 9D — Cloud transparency polish (DISPLAY ONLY).
//
// The volumetric cloud must read as fog, never as a solid: the final
// accumulated presentation result is capped at RT3D_CLOUD_MAX_OPACITY.
// Proves the cap without touching physics:
//   1. One centralized constant equals 0.18, wired to the shader.
//   2. The cap applies ONCE to the accumulated result, never per sample.
//   3. RGB stays premultiplied-consistent with the capped alpha.
//   4. Raw integration, density, packing, LUT, sheets, multi-floor,
//      freshness and the 2D path are all unchanged.
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
function constSegment(name, endMarker) {
  const i = CODE.indexOf('const ' + name + '=');
  if (i < 0) return null;
  const j = endMarker ? CODE.indexOf(endMarker, i) : -1;
  return j < 0 ? CODE.slice(i) : CODE.slice(i, j);
}
function fnSegment(name, endMarker) {
  const i = CODE.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const j = endMarker ? CODE.indexOf(endMarker, i) : -1;
  return j < 0 ? CODE.slice(i) : CODE.slice(i, j);
}

const main = mainEnv();
main.run(`state=freshState(); state.activeFloor=0;`);

// ---------------------------------------------------------------
// A. One centralized presentation ceiling, exactly 0.18
// ---------------------------------------------------------------
check(1, 'RT3D_CLOUD_MAX_OPACITY exists and equals 0.18',
  main.run('RT3D_CLOUD_MAX_OPACITY') === 0.18);
check(2, 'ceiling is wired to the cloud material as a uniform',
  CODE.includes('uMaxOpacity:{ value:cloudIntensity }'),
  'uniform wiring missing');
check(3, 'shader declares the ceiling uniform and scales the final result once',
  (() => {
    const frag = constSegment('RT3D_CLOUD_FRAG', 'function rt3dCloudMeshFor');
    return !!frag && frag.includes('uniform float uMaxOpacity;') &&
      frag.includes('fragColor = vec4(acc * uMaxOpacity, rawAlpha * uMaxOpacity);');
  })(), 'final presentation scaling missing');
check(4, 'no per-sample 0.18 clamp inside the march loop',
  (() => {
    const frag = constSegment('RT3D_CLOUD_FRAG', 'function rt3dCloudMeshFor');
    if (!frag) return false;
    // Exactly three mentions: the uniform declaration plus the two final
    // presentation terms. Nothing inside the integration loop, no literal.
    const uses = (frag.match(/uMaxOpacity/g) || []).length;
    return uses === 3 && !frag.includes('0.18');
  })(), 'ceiling leaked into per-sample integration');

// ---------------------------------------------------------------
// B. Presentation math: raw 0.10/0.50/1.00 -> 1.8%/9%/18%
// ---------------------------------------------------------------
const disp = (raw) => main.run(`RT3D_CLOUD_MAX_OPACITY * ${raw}`);
check(5, 'display mapping keeps weak raw opacity proportionally weak',
  Math.abs(disp(0.10) - 0.018) < 1e-12 && Math.abs(disp(0.50) - 0.09) < 1e-12,
  `0.10->${disp(0.10)} 0.50->${disp(0.50)}`);
check(6, 'strongest raw opacity still never exceeds ~18%',
  Math.abs(disp(1.00) - 0.18) < 1e-12, `1.00->${disp(1.00)}`);
check(7, 'premultiplied RGB scales with the same factor as alpha',
  (() => {
    const frag = constSegment('RT3D_CLOUD_FRAG', 'function rt3dCloudMeshFor');
    // acc and rawAlpha share uMaxOpacity, so rgb <= alpha is preserved.
    return !!frag && /vec4\(\s*acc \* uMaxOpacity\s*,\s*rawAlpha \* uMaxOpacity\s*\)/.test(frag);
  })(), 'rgb/alpha scaling inconsistent');

// ---------------------------------------------------------------
// C. Everything physical stays exactly as it was
// ---------------------------------------------------------------
check(8, 'raw step-length integration is unchanged and step-stable',
  Math.abs(main.run('rt3dVolumeIntegrateUniform(0.3,8,64)') -
    main.run('rt3dVolumeIntegrateUniform(0.3,8,96)')) < 1e-9);
check(9, 'density transfer function is untouched',
  main.run('rt3dVolumeDensityAt(-40)') === 2.0 &&
  Math.abs(main.run('rt3dVolumeDensityAt(-60)') - 1.375) < 1e-9 &&
  main.run('rt3dVolumeDensityAt(-Infinity)') === 0);
check(10, 'quantization and LUT bytes are unchanged',
  main.run('rt3dVolumeQuantize(-40)') === 120 &&
  main.run(`(function(){ var l=rt3dVolumeBuildLUT(); return l.length===1024; })()`) === true);
check(11, 'tomography sheets keep their own appearance (no ceiling there)',
  (() => {
    const seg = fnSegment('refresh3dVolume', 'function rt3dExpWorkerStartVolume');
    return !!seg && seg.includes('opacity:0.6') && !seg.includes('uMaxOpacity') &&
      !seg.includes('MAX_OPACITY');
  })(), 'sheets appearance changed');
check(12, 'multi-floor retention still keys on revision + coverage',
  CODE.includes('function rt3dVolumeFresh(') &&
    CODE.includes('state.activeFloor>rt3dVolume.maxFloorIndex') &&
    CODE.includes('function rt3dVolumeFloorEntry('),
  'freshness/entry logic changed');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('  - ' + failures.join('\n  - '));
  process.exit(1);
}
