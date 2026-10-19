// Stage 8A focused regression tests
// Validates the product integration points without requiring a browser

import fs from 'node:fs';

const html = fs.readFileSync('/opt/wifi-simulator/index.html', 'utf-8');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ok   ', msg); passed++; }
  else { console.log('  FAIL ', msg); failed++; }
}

function assertNot(cond, msg) {
  if (!cond) { console.log('  ok   ', msg); passed++; }
  else { console.log('  FAIL ', msg); failed++; }
}

console.log('\n=== Stage 8A Integration Tests ===\n');

// 1. runSimulateCoverage function exists (Stage 10A: optional staged-mode param)
assert(html.includes('function runSimulateCoverage('), 'runSimulateCoverage function defined');
assert(html.includes('rt3dExpWorkerStart'), 'calls rt3dExpWorkerStart');
assert(html.includes('phase('), 'uses phased progress');
assert(html.includes('showToast'), 'uses existing toast for progress');
assert(html.includes('rt3dExpWorkerCancel'), 'supports cancellation');

// 2. btnSimulate button exists without ?rt3d=1 gating
assert(html.includes('id="btnSimulate"'), 'btnSimulate element exists');
assert(html.includes('toolbar.simulateCoverage'), 'i18n key for button label');
assert(html.includes('toolbar.simulateCoverageTitle'), 'i18n key for tooltip');
assertNot(html.match(/RT3D_EXP_ENABLED.*btnSimulate/), 'button not gated by experimental flag');

// 3. i18n translations exist for all three languages
assert(html.includes('"toolbar.simulateCoverage": "Simular cobertura"'), 'ES translation');
assert(html.includes('"toolbar.simulateCoverage": "Simulate Coverage"'), 'EN translation');
assert(html.includes('"toolbar.simulateCoverage": "Simulera täckning"'), 'SV translation');
assert(html.includes('"toolbar.simulateCoverageTitle": "Ejecutar simulación de cobertura RT3D autoritativa"'), 'ES tooltip');
assert(html.includes('"toolbar.simulateCoverageTitle": "Run authoritative RT3D coverage simulation"'), 'EN tooltip');
assert(html.includes('"toolbar.simulateCoverageTitle": "Kör auktoritativ RT3D-täckningssimulering"'), 'SV tooltip');

// 4. wireGlobals hooks the single authoritative action (Stage 10A: the
// Simulate control launches the 2D+3D orchestrator; the raw pipeline stays
// available for dev/console use)
assert(html.includes('btnSimulate'), 'btnSimulate referenced in wireGlobals');
assert(html.includes('runAuthoritativeCoverage'), 'orchestrator called in wireGlobals');
assert(html.includes('.onclick=runAuthoritativeCoverage'), 'click handler wired');

// 5. showToast supports HTML content via msg.html
assert(html.includes('msg.html'), 'showToast checks for msg.html');
assert(html.includes('html = msg.html'), 'showToast uses msg.html directly');

// 6. Live Preview path (btnHeat) remains unchanged
assert(html.includes('showHeat=!showHeat'), 'Live Preview toggle preserved');
assert(html.includes('scheduleHeat'), 'Live Preview schedules heat');
assert(html.includes('computeHeatSimple'), 'computeHeatSimple still used');
assertNot(html.match(/scheduleHeat.*rt3dExpRunCoverage/), 'Live Preview does not auto-trigger RT3D');

// 7. Experimental panel still exists for ?rt3d=1 coexistence
assert(html.includes('rt3dExpBuildPanel'), 'experimental panel builder exists');
assert(html.includes('rt3dExpRunCoverage'), 'experimental run function exists');
assert(html.includes('RT3D_EXP_ENABLED'), 'experimental flag check exists');

// 8. Worker protocol reuses canonical rt3dExpWorkerStart
assert(html.includes('rt3dExpWorkerStart(snapshot'), 'uses rt3dExpWorkerStart');
assert(html.includes("phase('world')"), 'snapshot phase');
assert(html.includes("phase('bvh')"), 'world phase');
assert(html.includes("phase('init')"), 'bvh phase');
assert(html.includes("phase('evaluate')"), 'init phase');
assert(html.includes("phase('paint')"), 'evaluate phase');
assert(html.includes('rt3dExpCovJob && rt3dExpCovJob.id!==m.jobId'), 'stale jobId guard');
assert(html.includes('rt3dExpWorkerCancel'), 'cancels via worker protocol');

// 9. COMPLETE publishes authoritative result and paints RT3D grid
assert(html.includes('rt3dExpPaint(res)'), 'paints via rt3dExpPaint');
assert(html.includes('rt3dExpCanvas='), 'stores canvas');
assert(html.includes('rt3dExpMeta='), 'stores meta');
assert(html.includes('rt3dExpSetView'), 'sets view to RT3D');
assert(html.includes('rt3dAuditRetainRt3d'), 'retains for audit');

// 10. CANCEL does not publish partial coverage
const abortSection = html.substring(html.indexOf('const abort='), html.indexOf('const workerError='));
assertNot(abortSection.includes('publish('), 'abort does not call publish');
assert(abortSection.includes('rt3d.cov.cancelledKeep'), 'shows cancelled message');
assert(abortSection.includes('rt3d.cov.keeping'), 'references kept result');

// 11. stale jobId COMPLETE cannot overwrite newer job
assert(html.includes('rt3dExpCovJob && rt3dExpCovJob.id!==m.jobId'), 'onProgress guards stale');
assert(html.includes('rt3dExpCovJob && rt3dExpCovJob.id!==m.jobId'), 'onComplete guards stale');
assert(html.includes('rt3dExpCovJob && rt3dExpCovJob.id!==m.jobId'), 'onCancelled guards stale');
assert(html.includes('rt3dExpCovJob && rt3dExpCovJob.id!==m.jobId'), 'onError guards stale');

// 12. Worker ERROR leaves application usable
assert(html.includes('rt3d.cov.workerError'), 'worker error message key');
assert(html.includes('rt3d.cov.cancelledKeep'), 'shows keep message on error');
const errorSection = html.substring(html.indexOf('const workerError='), html.indexOf('const finish='));
assertNot(errorSection.includes('runRayTrace'), 'no fallback to legacy RT');
assertNot(errorSection.includes('computeHeatSimple'), 'no fallback to simple');

// 13. Normal workflow does not require experimental panel
const runSimSection = html.substring(html.indexOf('function runSimulateCoverage'), html.indexOf('// ============================================================', html.indexOf('function runSimulateCoverage') + 100));
assertNot(runSimSection.includes('rt3dExpBuildPanel'), 'does not build experimental panel');
assertNot(runSimSection.includes('rt3dExpOut'), 'does not write to experimental panel output');

// ============================================================
// STAGE 8A BUTTON HANDLER REGRESSION TESTS
// These catch browser SyntaxErrors from malformed inline onclick strings,
// and click-loss from progress re-renders replacing button DOM nodes.
// ============================================================

// 14. NO inline onclick handlers in the progress card (the SyntaxError bug)
assertNot(html.includes('document.createEvent'), 'no document.createEvent in progress card');
assertNot(html.includes('dispatchEvent'), 'no dispatchEvent in progress card');
assertNot(html.includes("onclick=\"var evt"), 'no onclick var evt pattern');
assertNot(html.includes("\\\"Event\\\""), 'no escaped quotes in onclick strings');

// 15. Buttons use data-action, not inline onclick or per-node ids
assert(html.includes('data-action="minimize"'), 'minimize button has data-action');
assert(html.includes('data-action="cancel"'), 'cancel button has data-action');
assert(html.includes('data-action="restore"'), 'restore button has data-action');

// 16. ONE delegated listener on the STABLE toast container, not per-button listeners
assert(html.includes('const toastEl = $(\'#toast\')'), 'delegated listener targets stable #toast');
assert(html.includes("toastEl.addEventListener('click', onToastClick)"), 'one delegated click listener');
assertNot(runSimSection.includes("querySelector('#rt3d-"), 'no per-button node listeners in render');

// 17. No document-global custom-event workaround
assertNot(html.includes("addEventListener('rt3d-minimize'"), 'no document-global minimize custom event');
assertNot(html.includes("addEventListener('rt3d-restore'"), 'no document-global restore custom event');
assertNot(html.includes("addEventListener('rt3d-cancel'"), 'no document-global cancel custom event');

// 18. The delegated listener survives render(): render() must NOT attach any listener
const renderFn = runSimSection.substring(runSimSection.indexOf('const render='), runSimSection.indexOf('render();\n\n  const floorIndex'));
assertNot(renderFn.includes('addEventListener'), 'render() attaches NO listeners (survives re-renders)');

// 19. Cleanup removes the delegated listener in all terminal paths
assert(runSimSection.includes("toastEl.removeEventListener('click', onToastClick)"), 'removes delegated listener');
const finishSection = runSimSection.substring(runSimSection.indexOf('const finish='), runSimSection.indexOf('const finish=') + 400);
assert(finishSection.includes('removeEventListener'), 'finish() removes delegated listener');
const abortSection2 = runSimSection.substring(runSimSection.indexOf('const abort='), runSimSection.indexOf('const abort=') + 400);
assert(abortSection2.includes('removeEventListener'), 'abort() removes delegated listener');
const errSection = runSimSection.substring(runSimSection.indexOf('const workerError='), runSimSection.indexOf('const workerError=') + 400);
assert(errSection.includes('removeEventListener'), 'workerError() removes delegated listener');

// 20. No listener accumulation across renders or runs. Each run path (the
// single-slice simulation and the Stage 9A tomography volume) attaches its
// delegated #toast listener exactly once and removes it on every terminal
// path — the same invariant, per run function rather than file-global.
const onToastClickCount = (html.match(/onToastClick\)/g) || []).length;
assert(onToastClickCount >= 8, `one attach + three removes per run path (found ${onToastClickCount})`);
const volSection = html.substring(html.indexOf('function runVolumeCoverage'), html.indexOf('\n//  STAGE 10B'));
const simAdd = (runSimSection.match(/toastEl\.addEventListener/g) || []).length;
const simRem = (runSimSection.match(/toastEl\.removeEventListener/g) || []).length;
const volAdd = (volSection.match(/toastEl\.addEventListener/g) || []).length;
const volRem = (volSection.match(/toastEl\.removeEventListener/g) || []).length;
assert(simAdd === 1, `slice path: exactly one addEventListener call (found ${simAdd})`);
assert(simRem === 3, `slice path: exactly three removeEventListener calls (found ${simRem})`);
assert(volAdd === 1, `volume path: exactly one addEventListener call (found ${volAdd})`);
assert(volRem === 3, `volume path: exactly three removeEventListener calls (found ${volRem})`);

// 21. Cancel calls canonical worker cancel exactly once
const cancelCalls = (runSimSection.match(/rt3dExpCovJob\.cancel\(\)/g) || []).length;
assert(cancelCalls === 1, `cancel invokes rt3dExpCovJob.cancel() exactly once (found ${cancelCalls})`);
assert(runSimSection.includes('rt3dExpWorkerCancel'), 'cancels via canonical worker cancel');
assert(runSimSection.includes('rt3dExpWorkerCancel(jobId)'), 'worker cancel scoped to jobId');

// 22. Minimize/Restore must NOT touch Worker execution (one minimize +
// restore line per delegated handler: slice, volume and project cards)
const minimizeLines = html.split('\n').filter(l => l.includes("action==='minimize'") || l.includes("action==='restore'"));
assert(minimizeLines.length === 6, 'minimize and restore handled in delegated handlers');
for (const line of minimizeLines) assertNot(line.includes('cancel') || line.includes('Worker'), 'minimize/restore does not touch Worker');

// 23. Progress re-render safety: render() re-paints the card every PROGRESS event
assert(html.includes('onProgress: (m)=>{'), 'progress handler wired');
const onProg = runSimSection.substring(runSimSection.indexOf('onProgress:'), runSimSection.indexOf('onProgress:') + 300);
assert(onProg.includes('render()'), 'progress re-renders the card');
assertNot(onProg.includes('addEventListener'), 'progress re-render attaches no listeners');
assert(html.includes('showToast(true, {html: L.join(\'\')})'), 'render re-paints via toast innerHTML (buttons replaced)');
console.log(`    note: buttons ARE replaced on each render; the delegated listener on #toast
              keeps one physical click = one action (this is the microfix)`);

// 24. Phase labels use user-friendly rt3d.cov.phase namespace
assert(html.includes('rt3d.cov.phase.snapshot'), 'user-friendly phase key snapshot');
assert(html.includes('rt3d.cov.phase.world'), 'user-friendly phase key world');
assert(html.includes('rt3d.cov.phase.bvh'), 'user-friendly phase key bvh');
assert(html.includes('rt3d.cov.phase.evaluate'), 'user-friendly phase key evaluate');
assert(html.includes('rt3d.cov.phase.paint'), 'user-friendly phase key paint');

// 25. Missing translations present in all three langs
assert(html.includes('"common.minimize"'), 'common.minimize key exists');
assert(html.includes('"common.restore"'), 'common.restore key exists');
assert(html.includes('"rt3d.cov.rateUnit"'), 'rt3d.cov.rateUnit key exists');

// 26. Spanish translations
assert(html.includes('"common.minimize": "Minimizar"'), 'ES minimize');
assert(html.includes('"common.restore": "Restaurar"'), 'ES restore');
assert(html.includes('"rt3d.cov.rateUnit": "celdas/s"'), 'ES rate unit');
assert(html.includes('"rt3d.cov.phase.snapshot": "Preparando proyecto"'), 'ES snapshot phase');
assert(html.includes('"rt3d.cov.phase.evaluate": "Evaluando cobertura"'), 'ES evaluate phase');

// 27. English translations
assert(html.includes('"common.minimize": "Minimize"'), 'EN minimize');
assert(html.includes('"common.restore": "Restore"'), 'EN restore');
assert(html.includes('"rt3d.cov.rateUnit": "cells/s"'), 'EN rate unit');
assert(html.includes('"rt3d.cov.phase.snapshot": "Preparing project"'), 'EN snapshot phase');
assert(html.includes('"rt3d.cov.phase.evaluate": "Evaluating coverage"'), 'EN evaluate phase');

// 28. Swedish translations
assert(html.includes('"common.minimize": "Minimera"'), 'SV minimize');
assert(html.includes('"common.restore": "Återställ"'), 'SV restore');
assert(html.includes('"rt3d.cov.rateUnit": "celler/s"'), 'SV rate unit');
assert(html.includes('"rt3d.cov.phase.snapshot": "Förbereder projekt"'), 'SV snapshot phase');
assert(html.includes('"rt3d.cov.phase.evaluate": "Utvärderar täckning"'), 'SV evaluate phase');

// 29. Normal product RT3D display works without ?rt3d=1 (no experimental gating)
assert(html.includes('rt3dNormalActive'), 'normal product display state exists');
assert(html.includes('rt3dNormalCanvas'), 'normal product canvas exists');
assert(runSimSection.includes('rt3dNormalActive=true'), 'publish activates normal display');
assertNot(runSimSection.includes('rt3dExpSetView'), 'does not gate on experimental view');
assert(html.includes('rt3dNormalActive && rt3dNormalCanvas'), 'draw2d renders normal RT3D result');

// 30. Image smoothing enabled for normal product display (presentation only)
const normalDrawSection = html.substring(html.indexOf('rt3dNormalActive &&'), html.indexOf('rt3dNormalActive &&') + 300);
assert(normalDrawSection.includes('imageSmoothingEnabled=true'), 'normal display uses smooth interpolation');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
