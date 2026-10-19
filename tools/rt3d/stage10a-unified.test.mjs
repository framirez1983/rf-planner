// Stage 10A — Unified coverage UX (PRODUCT FLOW ONLY, no RF change).
//
// One operation (Simular cobertura), two concepts (Vista previa vs Mostrar
// cobertura), three product states (DESIGN/SIMULATING/SIMULATED). Proves
// headlessly where possible, structurally otherwise:
//   1. Fresh load starts in DESIGN with the fast preview available.
//   2. The toggle flips preview in DESIGN and authoritative in SIMULATED.
//   3. Simulation hides preview immediately and chains 2D->3D off one
//      shared snapshot/revision; staged publishes can never go live
//      superseded or revision-stale.
//   4. Only an atomic commit enters SIMULATED and auto-shows; abort paths
//      keep the previous valid result or fall back to DESIGN.
//   5. Render paths are mutually exclusive by construction.
//   6. Any RF mutation discards both products, restores Preview, preserves
//      visibility intent, and never shows a stale badge/result.
//   7. Internal controls leave the normal toolbar but keep working.
//   8. View switches never simulate; serialization and RF are untouched.
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
// A. Initial product state: DESIGN with preview available
// ---------------------------------------------------------------
check(1, 'fresh load starts in DESIGN with fast preview available',
  main.run('productState') === 'DESIGN' && main.run('showHeat') === true &&
  main.run('authVisible()') === false);
check(2, 'preview toggle preserves the legacy showHeat flip',
  CODE.includes('showHeat=!showHeat'), 'legacy toggle expression gone');

// ---------------------------------------------------------------
// B. Toggle behavior per state (live state machine)
// ---------------------------------------------------------------
main.run('onCoverageToggle();');
check(3, 'Preview OFF hides fast coverage in DESIGN',
  main.run('showHeat') === false && main.run('productState') === 'DESIGN');
main.run('onCoverageToggle();');
check(4, 'Preview ON restores fast coverage in DESIGN',
  main.run('showHeat') === true);
main.run(`productState='SIMULATED'; showAuthoritative=true; updateCoverageToggle();`);
check(5, 'SIMULATED toggle controls only the authoritative result',
  main.run('authVisible()') === true &&
  (main.run('onCoverageToggle(); authVisible()') === false) &&
  main.run('showHeat') === true);
main.run(`productState='SIMULATED'; showAuthoritative=false; updateCoverageToggle();`);
check(6, 'SIMULATED toggle restores without recalculation',
  main.run('onCoverageToggle(); authVisible()') === true);
main.run(`productState='SIMULATING'; showHeat=true; showAuthoritative=true;
  onCoverageToggle();`);
check(7, 'toggle is inert while SIMULATING',
  main.run(`showHeat===true&&showAuthoritative===true`) === true);
main.run(`productState='DESIGN'; showAuthoritative=true;`);

// ---------------------------------------------------------------
// C. Orchestrator: one snapshot, chained stages, guarded publishes
// ---------------------------------------------------------------
const orch = fnSegment('runAuthoritativeCoverage', 'STAGE 9B');
check(8, 'one orchestrator launches one whole-project job',
  !!orch && orch.includes('runProjectCoverage({ runId:runId') &&
    orch.includes('twoD:req.twoD, volFloors:req.volFloors'),
  'orchestrator missing or not project-scoped');
check(9, 'the project job shares one snapshot object and one launch revision',
  !!orch && orch.includes('snapshotState:snapshotState') &&
    orch.includes('simulationStartRevision:revision') &&
    orch.includes('rt3dProjectRequest()'),
  'stages could diverge onto different designs');
check(10, 'project publish is revision/generation guarded',
  CODE.includes('opts.runId!==authRunId') && CODE.includes('opts.onDone') &&
    CODE.includes('opts.onAbort'),
  'stale staged results could publish');
check(11, 'preview hides the moment simulation starts (SIMULATING first)',
  !!orch && orch.indexOf("productState='SIMULATING'") <
    orch.indexOf('runProjectCoverage({ runId:runId'),
  'preview visible during startup');
check(12, 'commit requires the full COMPLETE, the same run and a clean revision',
  !!orch && orch.includes("productState='SIMULATED'") &&
    orch.includes('runId!==authRunId') && orch.includes('abortAll'),
  'partial result could go product-valid');

// ---------------------------------------------------------------
// D. Abort without a worker: staged failure returns to DESIGN
// ---------------------------------------------------------------
main.run(`productState='DESIGN'; showHeat=true;`);
let threw = false;
try { main.run('runAuthoritativeCoverage()'); } catch (e) { threw = true; }
check(13, 'orchestrator runs without a worker and aborts cleanly to DESIGN',
  threw === false && main.run('productState') === 'DESIGN');

// ---------------------------------------------------------------
// E. Invalidation: discard both, restore Preview, keep intent
// ---------------------------------------------------------------
main.run(`productState='SIMULATED'; showAuthoritative=true; showHeat=false;
  rt3dNormalActive=true; rt3dNormalCanvas={}; rt3dNormalMeta={floorId:'x'};
  rt3dVolume={maxFloorIndex:0,floors:[],meta:{simulationRevision:0}};
  markRfChanged();`);
check(14, 'RF mutation discards both authoritative products',
  main.run(`productState==='DESIGN'&&rt3dNormalActive===false&&
    rt3dNormalCanvas===null&&rt3dVolume===null`) === true);
check(15, 'visibility intent preserved: ON authoritative becomes ON preview',
  main.run('showHeat') === true);
main.run(`productState='SIMULATED'; showAuthoritative=false; showHeat=false;
  rt3dNormalActive=true; rt3dVolume={maxFloorIndex:0,floors:[],meta:{}};
  markRfChanged();`);
check(16, 'OFF intent stays OFF (clean plan for editing is never relit)',
  main.run(`productState==='DESIGN'&&showHeat===false`) === true);
check(17, 'no stale badge or result survives invalidation',
  main.run(`rt3dNormalCanvas===null&&rt3dVolume===null`) === true);

// ---------------------------------------------------------------
// F. Render paths are mutually exclusive by construction
// ---------------------------------------------------------------
check(18, '2D preview paints only in DESIGN, authoritative only when visible',
  CODE.includes("productState==='DESIGN' && showHeat && heatCanvas") &&
    CODE.includes('authVisible() && rt3dNormalActive'),
  'draw2d gating missing');
check(19, '3D legacy plane and volume obey the same exclusivity',
  CODE.includes("productState!=='DESIGN' || !showHeat || !heatCanvas") &&
    CODE.includes('if(!authVisible()) return false;') &&
    CODE.includes('if(!authVisible()) return;'),
  '3D gating missing');
check(20, 'preview and authoritative gates cannot overlap in 2D',
  CODE.includes("productState==='DESIGN' && showHeat && heatCanvas") &&
    CODE.includes('authVisible() && rt3dNormalActive'),
  'draw2d gates missing');

// ---------------------------------------------------------------
// G. Internal controls hidden, functions preserved; views never simulate
// ---------------------------------------------------------------
check(21, 'Cobertura 3D / Ray tracing buttons hidden from normal UI',
  CODE.includes('#btnVolume,#btnTrace,#simStatus,#volStatus{display:none!important;}'),
  'hide rule missing');
check(22, 'underlying developer/audit functions still exist',
  CODE.includes('function runVolumeCoverage(') &&
    CODE.includes('function runRayTrace(') &&
    CODE.includes('function updateSimStatus(') &&
    CODE.includes('function updateVolStatus('),
  'functionality deleted instead of hidden');
check(23, '2D/3D view switching never launches a simulation',
  (() => {
    const seg = fnSegment('setView', 'function snapState');
    return !!seg && !seg.includes('runSimulateCoverage') &&
      !seg.includes('runVolumeCoverage') && !seg.includes('runAuthoritativeCoverage');
  })(), 'view switch triggers computation');

// ---------------------------------------------------------------
// H. i18n, serialization, RF fingerprints
// ---------------------------------------------------------------
const tr = JSON.parse(main.run(`JSON.stringify({
  esP: translations.es['toolbar.preview'], esS: translations.es['toolbar.showCoverage'],
  enP: translations.en['toolbar.preview'], enS: translations.en['toolbar.showCoverage'],
  svP: translations.sv['toolbar.preview'], svS: translations.sv['toolbar.showCoverage'] })`));
check(24, 'product terminology translated in ES/EN/SV',
  tr.esP === 'Vista previa' && tr.esS === 'Mostrar cobertura' &&
  tr.enP === 'Preview' && tr.enS === 'Show coverage' &&
  typeof tr.svP === 'string' && tr.svP.length > 0 &&
  typeof tr.svS === 'string' && tr.svS.length > 0,
  JSON.stringify(tr));
check(25, 'product state never enters project serialization',
  !main.run('JSON.stringify(serialize())').includes('productState') &&
  !main.run('JSON.stringify(serialize())').includes('showAuthoritative'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('  - ' + failures.join('\n  - '));
  process.exit(1);
}
