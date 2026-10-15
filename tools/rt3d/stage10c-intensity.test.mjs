// Stage 10C — Coverage intensity control (DISPLAY ONLY).
//
// A floating in-canvas slider scales the final cloud presentation opacity
// through the existing uMaxOpacity uniform. Proves, without touching RF:
//   1. Range constants and default (0.05 / 0.25 / 0.45), clamped input.
//   2. Slider writes update every live cloud material immediately, with no
//      Worker, no RF edit, no invalidation, no sample/texture mutation.
//   3. One global value covers all floors; rebuilt meshes inherit it.
//   4. The control shows only for SIMULATED + Vista 3D + coverage ON.
//   5. Sheets, architectural transparency, 2D and serialization untouched.
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
main.run(`state=freshState(); state.activeFloor=0;`);

// ---------------------------------------------------------------
// A. Range, default, clamped live update across all floor clouds
// ---------------------------------------------------------------
check(1, 'intensity range is 0.05..0.45 with default 0.25',
  main.run('RT3D_CLOUD_INTENSITY_MIN') === 0.05 &&
  main.run('RT3D_CLOUD_INTENSITY_DEFAULT') === 0.25 &&
  main.run('RT3D_CLOUD_INTENSITY_MAX') === 0.45 &&
  main.run('cloudIntensity') === 0.25);
main.run(`onCloudIntensityInput({target:{value:'0.40'}});`);
check(2, 'slider input takes effect immediately',
  main.run('cloudIntensity') === 0.4);
main.run(`onCloudIntensityInput({target:{value:'99'}});`);
const hi = main.run('cloudIntensity');
main.run(`onCloudIntensityInput({target:{value:'-3'}});`);
const lo = main.run('cloudIntensity');
main.run(`onCloudIntensityInput({target:{value:'xx'}});`);
check(3, 'input clamps to range and ignores garbage',
  hi === 0.45 && lo === 0.05 && main.run('cloudIntensity') === 0.05);
main.run(`cloudMeshes.push(
  {material:{uniforms:{uMaxOpacity:{value:0}}}},
  {material:{uniforms:{uMaxOpacity:{value:0}}}});
  onCloudIntensityInput({target:{value:'0.30'}});
  cloudMeshes.length=0;`);
check(4, 'one value updates every visible floor cloud, nothing else',
  main.run('cloudIntensity') === 0.3);
check(5, 'recreated cloud materials inherit the current intensity',
  CODE.includes('uMaxOpacity:{ value:cloudIntensity }'),
  'mesh creation does not read the runtime value');

// ---------------------------------------------------------------
// B. Handler purity: no compute, no invalidation, no sample writes
// ---------------------------------------------------------------
const hseg = fnSegment('onCloudIntensityInput', 'function updateIntensityControl');
check(6, 'intensity path launches no Worker and changes no RF state',
  !!hseg && !hseg.includes('Worker') && !hseg.includes('markRfChanged') &&
    !hseg.includes('invalidateAuthoritative') && !hseg.includes('scheduleHeat') &&
    !hseg.includes('draw2d') && !hseg.includes('build3d'),
  'slider has computation side effects');
check(7, 'intensity path never touches samples, bricks or textures',
  !!hseg && !hseg.includes('.best') && !hseg.includes('PackPlanes') &&
    !hseg.includes('DataTexture') && !hseg.includes('LUT'),
  'slider reaches stored RF data');

// ---------------------------------------------------------------
// C. Visibility matrix (loader stubs expose style.display)
// ---------------------------------------------------------------
function shown() {
  return main.run(`(function(){
    view='2d'; productState='DESIGN'; showAuthoritative=true;
    updateIntensityControl();
    return $('#legendIntensity').style.display; })()`);
}
check(8, 'control hidden for DESIGN / Vista previa', shown() === 'none');
const vis = (v, ps, auth) => main.run(`(function(){
  view=${JSON.stringify(v)}; productState=${JSON.stringify(ps)};
  showAuthoritative=${auth ? 'true' : 'false'};
  updateIntensityControl();
  return $('#legendIntensity').style.display; })()`);
check(9, 'control hidden while SIMULATING', vis('3d', 'SIMULATING', true) === 'none');
check(10, 'control hidden in Plano 2D', vis('2d', 'SIMULATED', true) === 'none');
check(11, 'control hidden when authoritative coverage is hidden',
  vis('3d', 'SIMULATED', false) === 'none');
check(12, 'control visible only for SIMULATED + Vista 3D + coverage ON',
  vis('3d', 'SIMULATED', true) === 'block');
main.run(`view='2d'; productState='DESIGN'; showAuthoritative=true; updateIntensityControl();`);

// ---------------------------------------------------------------
// D. Untouched surroundings + placement + i18n
// ---------------------------------------------------------------
check(13, 'tomography sheets keep their own fixed appearance',
  CODE.includes('opacity:0.6') &&
    !fnSegment('refresh3dVolume', 'function rt3dExpWorkerStartVolume')
      .includes('uMaxOpacity'),
  'sheets coupled to intensity');
check(14, 'architectural transparency hierarchy is unchanged',
  CODE.includes('const dim = idx===state.activeFloor ? 1 : 0.32;'),
  'floor dimming changed');
check(15, 'intensity lives inside the shared legend HUD, no standalone panel',
  APP_HTML.indexOf('<div id="legend">') < APP_HTML.indexOf('id="legendIntensity"') &&
    APP_HTML.indexOf('id="legendIntensity"') < APP_HTML.indexOf('id="covReadout"') &&
    !APP_HTML.includes('id="rfIntensity"') &&
    !APP_HTML.includes('#rfIntensity{') &&
    APP_HTML.includes('type="range" id="rfIntensitySlider" min="0.05" max="0.45"'),
  'standalone panel remains or merge order wrong');
const ci = JSON.parse(main.run(`JSON.stringify({
  t: translations.es['cloud.intensity'], f: translations.es['cloud.faint'],
  s: translations.es['cloud.strong'],
  en: [translations.en['cloud.intensity'], translations.en['cloud.faint'], translations.en['cloud.strong']],
  sv: [translations.sv['cloud.intensity'], translations.sv['cloud.faint'], translations.sv['cloud.strong']] })`));
check(16, 'intensity wording translated in ES/EN/SV',
  ci.t === 'Intensidad' && ci.f === 'Tenue' && ci.s === 'Intensa' &&
  ci.en[0] === 'Intensity' && ci.en[1] === 'Subtle' && ci.en[2] === 'Strong' &&
  ci.sv.every(s => typeof s === 'string' && s.length > 0),
  JSON.stringify(ci));
check(17, 'intensity stays out of project serialization',
  !main.run('JSON.stringify(serialize())').includes('cloudIntensity'));
check(18, '9D ceiling constant still defined (slider range covers it)',
  main.run('RT3D_CLOUD_MAX_OPACITY') === 0.18);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('  - ' + failures.join('\n  - '));
  process.exit(1);
}
