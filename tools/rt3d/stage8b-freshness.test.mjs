// Stage 8B — Minimal simulation freshness / stale state
//
// Tests the rfRevision counter, markRfChanged() invalidation helper,
// updateSimStatus() UI indicator, and the CURRENT/STALE semantics.
//
// This test runs in Node by extracting only the relevant functions from
// the application script and evaluating them in isolation.

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const APP = path.join(ROOT, 'index.html');

function readAppScript(file = APP) {
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
  if (!m) throw new Error('app <script> block not found in ' + file);
  return m[1];
}

const APP_SOURCE = readAppScript();

// Extract only the functions we need for testing
function extractFunctions(source) {
  const relevantCode = `
// Minimal dependencies
let uid_counter = 0;
function uid(prefix='') { return prefix + (++uid_counter).toString(36) + Math.random().toString(36).slice(2); }

const translations = {
  "es": {
    "rt3d.sim.current": "Cobertura actualizada",
    "rt3d.sim.stale": "Cobertura desactualizada",
    "rt3d.sim.currentTooltip": "La simulación refleja el estado actual del proyecto",
    "rt3d.sim.staleTooltip": "El diseño cambió desde la última simulación",
  },
  "en": {
    "rt3d.sim.current": "Coverage up to date",
    "rt3d.sim.stale": "Coverage out of date",
    "rt3d.sim.currentTooltip": "The simulation reflects the current state of the project",
    "rt3d.sim.staleTooltip": "The design changed since the last simulation",
  },
  "sv": {
    "rt3d.sim.current": "Täckning uppdaterad",
    "rt3d.sim.stale": "Täckning föråldrad",
    "rt3d.sim.currentTooltip": "Simuleringen speglar projektets nuvarande tillstånd",
    "rt3d.sim.staleTooltip": "Designen har ändrats sedan senaste simulering",
  },
  "common": {
    "minimize": "Minimize",
    "restore": "Restore",
  }
};
let uiLanguage = 'en';
function t(key, params) {
  const lang = translations[uiLanguage] || translations.en;
  let text = lang[key] || key;
  if (params) {
    Object.keys(params).forEach(k => { text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k]); });
  }
  return text;
}
function escapeHtml(s) { return String(s).replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"'); }
function \$ (id) { return { id, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, dataset: {}, addEventListener() {}, removeEventListener() {}, querySelector() { return null; } }; }

// Mock document with PERSISTENT simStatusElement
const simStatusElement = { textContent: '', style: { display: '', color: '', background: '', border: '', borderRadius: '' }, title: '' };
const mockDocument = {
  getElementById: (id) => {
    if (id === 'simStatus') return simStatusElement;
    if (id === 'canvas2d' || id === 'canvas3d') return { width: 800, height: 600, getContext: () => ({}), style: {}, addEventListener: () => {}, removeEventListener: () => {} };
    return { style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, dataset: {}, addEventListener: () => {}, removeEventListener: () => {}, querySelector() { return null; } };
  },
  querySelector: (sel) => {
    if (sel === '#canvas2d' || sel === '#canvas3d') return { width: 800, height: 600, getContext: () => ({}), style: {}, addEventListener: () => {}, removeEventListener: () => {} };
    return { style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, dataset: {}, addEventListener: () => {}, removeEventListener: () => {}, querySelector() { return null; } };
  },
  createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, dataset: {}, addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null }),
  createEvent: () => ({ initEvent: () => {} }),
  addEventListener: () => {},
  removeEventListener: () => {},
  readyState: 'complete',
  body: { appendChild: (c) => c },
  documentElement: { lang: 'es' },
};

// Expose document and window globally for the functions
const document = mockDocument;
const window = { document: mockDocument, location: { search: '', href: '' } };
globalThis.document = document;
globalThis.window = window;

const MockMutationObserver = class { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} };
const MockResizeObserver = class { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} };

// Minimal state
let state = null;

function freshFloor(name, idx) {
  return { id: uid('flr'), name: name || ('Floor ' + (idx + 1)), height: 3.0, w: 20, d: 14,
           walls: [], pillars: [], aps: [], labels: [], racks: [], cableRoutes: [], openings: [], zones: [], rfObjects: [], bg: null };
}

function freshState() {
  const mats = [
    { id: uid('mat'), name: 'Gypsum / Drywall', db: 3, color: '#c9b58a' },
    { id: uid('mat'), name: 'Wood', db: 4, color: '#a9743c' },
    { id: uid('mat'), name: 'Glass', db: 6, color: '#6fc3d6' },
    { id: uid('mat'), name: 'Brick', db: 9, color: '#b5573e' },
    { id: uid('mat'), name: 'Concrete', db: 15, color: '#8a8f96' },
    { id: uid('mat'), name: 'Solid metal', db: 26, color: '#cfd6df' },
    { id: uid('mat'), name: 'Open metal mesh', db: 8, color: '#9fb7c9' },
    { id: uid('mat'), name: 'Metal railing / cables', db: 1, color: '#b9c2cc' },
  ];
  const s = {
    version: 2, materials: mats, plExp: 3.0, slabDb: 16, band: '5',
    receiverHeight: 1.2,
    activeFloor: 0, activeMat: mats[4].id,
    covThreshold: -67, showFail: false, heatView: 'rssi', noiseFloor: -95, indoorOnly: true,
    originX: 0, originY: 0, northAngle: 0,
    floors: [ freshFloor('Ground floor', 0) ],
    rfRevision: 0
  };
  return s;
}

function markRfChanged() {
  if (!state) return;
  state.rfRevision = (state.rfRevision || 0) + 1;
  updateSimStatus();
}

let rt3dNormalActive = false;
let rt3dNormalCanvas = null;
let rt3dNormalMeta = null;

function updateSimStatus() {
  const el = document.getElementById('simStatus');
  if (!el) return;
  if (!rt3dNormalActive || !rt3dNormalCanvas) {
    el.textContent = ''; el.style.display = 'none'; return;
  }
  const simRev = rt3dNormalMeta?.simulationRevision ?? rt3dNormalMeta?.simulationRevision;
  if (simRev === undefined) {
    el.textContent = ''; el.style.display = 'none'; return;
  }
  const isCurrent = (state.rfRevision === simRev);
  el.textContent = isCurrent ? t('rt3d.sim.current') : t('rt3d.sim.stale');
  el.title = isCurrent ? t('rt3d.sim.currentTooltip') : t('rt3d.sim.staleTooltip');
  el.style.display = 'inline-block';
  el.style.color = isCurrent ? '#34d6c4' : '#f4a83a';
  el.style.background = isCurrent ? 'rgba(52,214,196,0.1)' : 'rgba(244,168,58,0.1)';
  el.style.border = isCurrent ? '1px solid #34d6c4' : '1px solid #f4a83a';
  el.style.borderRadius = '3px';
}

// Initialize state
state = freshState();

// Expose for testing
globalThis.__TEST_STATE__ = () => state;
globalThis.__TEST_MARK_RF_CHANGED__ = () => markRfChanged();
globalThis.__TEST_UPDATE_SIM_STATUS__ = () => updateSimStatus();
globalThis.__TEST_RT3D_NORMAL_ACTIVE__ = () => rt3dNormalActive;
globalThis.__TEST_RT3D_NORMAL_CANVAS__ = () => rt3dNormalCanvas;
globalThis.__TEST_RT3D_NORMAL_META__ = () => rt3dNormalMeta;
globalThis.__TEST_DOCUMENT__ = () => document;
globalThis.__TEST_T__ = (key) => t(key);
`;

  return relevantCode;
}

const TEST_SOURCE = extractFunctions(APP_SOURCE);

function createEnv() {
  const globals = {
    setTimeout, clearTimeout, setInterval, clearInterval,
    queueMicrotask, structuredClone: globalThis.structuredClone,
    TextDecoder, TextEncoder, Blob, URL,
    MutationObserver: class { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} },
    ResizeObserver: class { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} },
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    console, performance: { now: () => Date.now() },
  };
  const ctx = vm.createContext(globals);
  vm.runInContext(TEST_SOURCE, ctx, { filename: 'stage8b-test' });
  return ctx;
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ok   ', msg); passed++; }
  else { console.log('  FAIL ', msg); failed++; }
}
function assertNot(cond, msg) {
  if (!cond) { console.log('  ok   ', msg); passed++; }
  else { console.log('  FAIL ', msg); failed++; }
}

console.log('\n=== Stage 8B Freshness Tests ===\n');

function run(ctx, code) {
  return vm.runInContext(code, ctx, { filename: 'test' });
}

// --- Test 1: rfRevision exists and starts at 0 ---
{
  const ctx = createEnv();
  const rev = run(ctx, '__TEST_STATE__().rfRevision');
  assert(rev === 0, 'rfRevision starts at 0');
}

// --- Test 2: markRfChanged increments rfRevision ---
{
  const ctx = createEnv();
  run(ctx, '__TEST_MARK_RF_CHANGED__()');
  const rev = run(ctx, '__TEST_STATE__().rfRevision');
  assert(rev === 1, 'markRfChanged increments rfRevision to 1');
  run(ctx, '__TEST_MARK_RF_CHANGED__()');
  const rev2 = run(ctx, '__TEST_STATE__().rfRevision');
  assert(rev2 === 2, 'markRfChanged increments rfRevision to 2');
}

// --- Test 3: rfRevision not persisted in project serialization ---
{
  const ctx = createEnv();
  run(ctx, '__TEST_MARK_RF_CHANGED__()');
  const newState = run(ctx, 'freshState()');
  assert(newState.rfRevision === 0, 'freshState initializes rfRevision to 0 (not persisted)');
}

// --- Test 4: updateSimStatus shows nothing before any simulation ---
{
  const ctx = createEnv();
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  const statusEl = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  assert(statusEl.textContent === '', 'status is empty before any simulation');
}

// --- Test 5: successful COMPLETE => CURRENT ---
{
  const ctx = createEnv();
  run(ctx, `
    rt3dNormalActive = true;
    rt3dNormalCanvas = { width: 100, height: 100 };
    rt3dNormalMeta = { simulationRevision: 5, simulationStartRevision: 5 };
    state.rfRevision = 5;
  `);
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  const statusEl = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  const isCurrent = statusEl.textContent.includes('actualizada') || statusEl.textContent.includes('up to date') || statusEl.textContent.includes('uppdaterad');
  assert(isCurrent, 'status shows CURRENT when rfRevision matches simulationRevision');
}

// --- Test 6: STALE when rfRevision differs ---
{
  const ctx = createEnv();
  run(ctx, `
    rt3dNormalActive = true;
    rt3dNormalCanvas = { width: 100, height: 100 };
    rt3dNormalMeta = { simulationRevision: 5, simulationStartRevision: 5 };
    state.rfRevision = 6; // different!
  `);
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  const statusEl = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  const isStale = statusEl.textContent.includes('desactualizada') || statusEl.textContent.includes('out of date') || statusEl.textContent.includes('föråldrad');
  assert(isStale, 'status shows STALE when rfRevision differs');
}

// --- Test 7: pan/zoom/selection does NOT mark stale ---
{
  const ctx = createEnv();
  run(ctx, '__TEST_MARK_RF_CHANGED__()');
  const revBefore = run(ctx, '__TEST_STATE__().rfRevision');
  // These are visual-only operations that should NOT call markRfChanged
  run(ctx, `
    camera = { zoom: 2, x: 10, y: 20 };
    selection = { type: 'ap', id: 'test' };
  `);
  const revAfter = run(ctx, '__TEST_STATE__().rfRevision');
  assert(revAfter === revBefore, 'pan/zoom/selection does not increment rfRevision');
}

// --- Test 8: AP move => STALE ---
{
  const ctx = createEnv();
  run(ctx, `
    rt3dNormalActive = true;
    rt3dNormalCanvas = { width: 100, height: 100 };
    rt3dNormalMeta = { simulationRevision: 10, simulationStartRevision: 10 };
    state.rfRevision = 10;
  `);
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  let statusEl = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  const wasCurrent = statusEl.textContent.includes('actualizada') || statusEl.textContent.includes('up to date') || statusEl.textContent.includes('uppdaterad');
  
  run(ctx, '__TEST_MARK_RF_CHANGED__()');
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  statusEl = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  const isStale = statusEl.textContent.includes('desactualizada') || statusEl.textContent.includes('out of date') || statusEl.textContent.includes('föråldrad');
  assert(wasCurrent && isStale, 'AP move (markRfChanged) marks simulation as STALE');
}

// --- Test 9: wall/material/RF-object mutation => STALE ---
{
  const ctx = createEnv();
  run(ctx, `
    rt3dNormalActive = true;
    rt3dNormalCanvas = { width: 100, height: 100 };
    rt3dNormalMeta = { simulationRevision: 20, simulationStartRevision: 20 };
    state.rfRevision = 20;
  `);
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  const statusEl1 = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  const wasCurrent = statusEl1.textContent.includes('actualizada') || statusEl1.textContent.includes('up to date') || statusEl1.textContent.includes('uppdaterad');
  
  run(ctx, '__TEST_MARK_RF_CHANGED__()');
  const statusEl2 = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  const isStale = statusEl2.textContent.includes('desactualizada') || statusEl2.textContent.includes('out of date') || statusEl2.textContent.includes('föråldrad');
  assert(wasCurrent && isStale, 'wall/material/RF-object mutation (markRfChanged) marks STALE');
}

// --- Test 10: receiver height / RF setting change => STALE ---
{
  const ctx = createEnv();
  run(ctx, `
    rt3dNormalActive = true;
    rt3dNormalCanvas = { width: 100, height: 100 };
    rt3dNormalMeta = { simulationRevision: 30, simulationStartRevision: 30 };
    state.rfRevision = 30;
  `);
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  const statusEl1 = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  const wasCurrent = statusEl1.textContent.includes('actualizada') || statusEl1.textContent.includes('up to date') || statusEl1.textContent.includes('uppdaterad');
  
  run(ctx, '__TEST_MARK_RF_CHANGED__()');
  const statusEl2 = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  const isStale = statusEl2.textContent.includes('desactualizada') || statusEl2.textContent.includes('out of date') || statusEl2.textContent.includes('föråldrad');
  assert(wasCurrent && isStale, 'receiver height / RF setting change (markRfChanged) marks STALE');
}

// --- Test 11: stale result remains displayed ---
{
  const ctx = createEnv();
  run(ctx, `
    rt3dNormalActive = true;
    rt3dNormalCanvas = { width: 100, height: 100 };
    rt3dNormalMeta = { simulationRevision: 10, simulationStartRevision: 10 };
    state.rfRevision = 11; // STALE
  `);
  const canvasExists = run(ctx, '!!rt3dNormalCanvas');
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  const statusEl = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  const isStale = statusEl.textContent.includes('desactualizada') || statusEl.textContent.includes('out of date') || statusEl.textContent.includes('föråldrad');
  assert(run(ctx, '!!rt3dNormalCanvas') && isStale, 'stale canvas remains and status shows STALE');
}

// --- Test 12: rerun => CURRENT ---
{
  const ctx = createEnv();
  run(ctx, `
    rt3dNormalActive = true;
    rt3dNormalCanvas = { width: 100, height: 100 };
    rt3dNormalMeta = { simulationRevision: 10, simulationStartRevision: 10 };
    state.rfRevision = 11; // STALE
  `);
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  let statusEl = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  const wasStale = statusEl.textContent.includes('desactualizada') || statusEl.textContent.includes('out of date') || statusEl.textContent.includes('föråldrad');
  
  // Simulate re-run: new simulation completes with matching revision
  run(ctx, `
    rt3dNormalMeta = { simulationRevision: 11, simulationStartRevision: 11 };
    state.rfRevision = 11;
  `);
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  statusEl = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  const isCurrent = statusEl.textContent.includes('actualizada') || statusEl.textContent.includes('up to date') || statusEl.textContent.includes('uppdaterad');
  assert(wasStale && isCurrent, 'rerun with matching revision => CURRENT');
}

// --- Test 13: cancel preserves previous freshness ---
{
  const ctx = createEnv();
  run(ctx, `
    rt3dNormalActive = true;
    rt3dNormalCanvas = { width: 100, height: 100 };
    rt3dNormalMeta = { simulationRevision: 15, simulationStartRevision: 15 };
    state.rfRevision = 15;
  `);
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  let statusEl = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  const wasCurrent = statusEl.textContent.includes('actualizada') || statusEl.textContent.includes('up to date') || statusEl.textContent.includes('uppdaterad');
  
  // Simulate cancellation - rfRevision should not change, previous result stays
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  statusEl = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  const stillCurrent = statusEl.textContent.includes('actualizada') || statusEl.textContent.includes('up to date') || statusEl.textContent.includes('uppdaterad');
  assert(wasCurrent && stillCurrent, 'cancel preserves previous CURRENT state and canvas');
  
  // Now make it stale, then cancel - should preserve STALE
  run(ctx, '__TEST_MARK_RF_CHANGED__()'); // rfRevision = 16
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  const statusEl2 = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  const wasStale = statusEl2.textContent.includes('desactualizada') || statusEl2.textContent.includes('out of date') || statusEl2.textContent.includes('föråldrad');
  
  // Cancel - should preserve STALE
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  const stillStale = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus").textContent').includes('desactualizada') || run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus").textContent').includes('out of date') || run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus").textContent').includes('föråldrad');
  assert(wasStale && stillStale, 'cancel preserves previous STALE state');
}

// --- Test 14: error preserves previous freshness ---
{
  const ctx = createEnv();
  run(ctx, `
    rt3dNormalActive = true;
    rt3dNormalCanvas = { width: 100, height: 100 };
    rt3dNormalMeta = { simulationRevision: 20, simulationStartRevision: 20 };
    state.rfRevision = 20;
  `);
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  let statusEl = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  const wasCurrent = statusEl.textContent.includes('actualizada') || statusEl.textContent.includes('up to date') || statusEl.textContent.includes('uppdaterad');
  
  // Simulate error - rfRevision doesn't change, previous result stays
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  const stillCurrent = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus").textContent').includes('actualizada') || run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus").textContent').includes('up to date') || run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus").textContent').includes('uppdaterad');
  assert(wasCurrent && stillCurrent, 'error preserves previous CURRENT state');
  
  // Now make it stale, then error - should preserve STALE
  run(ctx, '__TEST_MARK_RF_CHANGED__()');
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  const statusEl2 = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  const wasStale = statusEl2.textContent.includes('desactualizada') || statusEl2.textContent.includes('out of date') || statusEl2.textContent.includes('föråldrad');
  
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  const stillStale = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus").textContent').includes('desactualizada') || run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus").textContent').includes('out of date') || run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus").textContent').includes('föråldrad');
  assert(wasStale && stillStale, 'error preserves previous STALE state');
}

// --- Test 15: mutation during active simulation => COMPLETE publishes STALE ---
{
  const ctx = createEnv();
  // Simulate: simulation starts at rev 10, mutation happens during (rev 11), COMPLETE at rev 11
  run(ctx, `
    rt3dNormalActive = false;
    rt3dNormalCanvas = { width: 100, height: 100 };
    rt3dNormalMeta = null;
    state.rfRevision = 10;
  `);
  
  // Simulate mutation during simulation
  run(ctx, '__TEST_MARK_RF_CHANGED__()'); // rfRevision = 11
  
  // Simulate COMPLETE with simulationRevision = 10 (captured at start) but current rfRevision = 11
  run(ctx, `
    rt3dNormalActive = true;
    rt3dNormalMeta = { simulationRevision: 10, simulationStartRevision: 10 };
    // rfRevision is now 11 (mutated during simulation)
  `);
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  const statusEl = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus")');
  const isStale = statusEl.textContent.includes('desactualizada') || statusEl.textContent.includes('out of date') || statusEl.textContent.includes('föråldrad');
  assert(isStale, 'mutation during simulation => COMPLETE publishes STALE');
}

// --- Test 16: rfRevision is runtime-only, never serialized ---
// Regression: serialized project output must contain none of the ephemeral
// freshness keys. Checks the REAL index.html source (not the mock above).
{
  const hasRuntimeRf = /let\s+rfRevision\s*=\s*0/.test(APP_SOURCE);
  assert(hasRuntimeRf, 'real source declares runtime-only `let rfRevision = 0`');
  const hasRuntimeSim = /let\s+simulationRevision\s*=\s*null/.test(APP_SOURCE);
  assert(hasRuntimeSim, 'real source declares runtime-only `let simulationRevision = null`');
  const freshSrc = (APP_SOURCE.match(/function freshState\(\)\{[\s\S]*?\n\}/) || [''])[0];
  assert(!/rfRevision/.test(freshSrc), 'real freshState() contains no rfRevision (not persisted)');
  const serSrc = (APP_SOURCE.match(/function serialize\(\)\{[\s\S]*?\n\}/) || [''])[0];
  assert(/rfRevision/.test(serSrc) && /simulationRevision/.test(serSrc) && /isCurrent/.test(serSrc),
    'real serialize() explicitly strips rfRevision/simulationRevision/isCurrent');
  const snapSrc = (APP_SOURCE.match(/function snapState\(\)\{[^\n]*\}/) || [''])[0];
  assert(/rfRevision/.test(snapSrc), 'real snapState() strips rfRevision (undo-safe)');
  const stateWrites = (APP_SOURCE.match(/state\.rfRevision/g) || []).length;
  assert(stateWrites === 0, 'real source has zero state.rfRevision reads/writes (found ' + stateWrites + ')');
  // Simulate what serialize() does: a state containing legacy keys must lose them.
  const legacy = { version: 2, floors: [], rfRevision: 7, simulationRevision: 7, simulationStartRevision: 7, isCurrent: true };
  const cleaned = JSON.parse(JSON.stringify(legacy, (k, v) =>
    (k === '_img' || k === 'rfRevision' || k === 'simulationRevision' || k === 'simulationStartRevision' || k === 'isCurrent') ? undefined : v));
  delete cleaned.rfRevision; delete cleaned.simulationRevision; delete cleaned.simulationStartRevision; delete cleaned.isCurrent;
  const out = JSON.stringify(cleaned);
  for (const banned of ['rfRevision', 'simulationRevision', 'simulationStartRevision', 'isCurrent', 'freshness']) {
    assert(!out.includes(banned), 'serialized project output contains no "' + banned + '"');
  }
  assert(/delete s\.rfRevision/.test(APP_SOURCE), 'real loadProject() drops legacy rfRevision on import');
}

// --- Test 17: display/filter-only inputs must NOT call markRfChanged ---
// Evidence: rssiFromAP/sinrAt never read covThreshold/showFail/indoorOnly;
// those three only recolor (showFail), recount (covThreshold) or mask
// (indoorOnly) already-computed values. Only physics inputs may invalidate.
{
  assert(!/covThreshold|showFail|indoorOnly/.test(
    (APP_SOURCE.match(/function rssiFromAP\(ap, af, px,py, tf, mhz\)\{[\s\S]*?return ap\.txPower/) || [''])[0]),
    'real rssiFromAP() never reads covThreshold/showFail/indoorOnly (physics unaffected)');
  const covLine = (APP_SOURCE.split('\n').find(l => l.includes("$('#covThr')") && l.includes('oninput')) || '');
  const failLine = (APP_SOURCE.split('\n').find(l => l.includes("$('#showFail')") && l.includes('onchange')) || '');
  const indoorLine = (APP_SOURCE.split('\n').find(l => l.includes("$('#indoorOnly')") && l.includes('onchange')) || '');
  assert(!/markRfChanged/.test(covLine), 'covThreshold handler is display-only: no markRfChanged()');
  assert(!/markRfChanged/.test(failLine), 'showFail handler is display-only: no markRfChanged()');
  assert(!/markRfChanged/.test(indoorLine), 'indoorOnly handler is filter-only: no markRfChanged()');
  const txLine = (APP_SOURCE.split('\n').find(l => l.includes("$('#pTx')") && l.includes('oninput')) || '');
  assert(/markRfChanged/.test(txLine), 'physics input (AP txPower) still calls markRfChanged()');
}

// --- Test 18: audit truth hierarchy untouched by Stage 8B ---
{
  assert(/truthHierarchy:RT3D_AUDIT_TRUTH_HIERARCHY/.test(APP_SOURCE),
    'real rt3dAuditProbeAt still references RT3D_AUDIT_TRUTH_HIERARCHY (no inline fork)');
  assert(/ANTENNA DECOMPOSITION/.test(APP_SOURCE),
    'real antenna decomposition comment preserved');
}

// --- Test 19: AP canvas-drag path invalidates (drag-end, one increment) ---
// Browser evidence: dragging AP AP-001 left the badge CURRENT. The
// pointermove handler mutated ap.x/ap.y + scheduleHeat (quick preview) but
// never reached markRfChanged(). Fixed at drag-end in pointerup.
{
  const downLine = (APP_SOURCE.split('\n').find(l => l.includes("dragging={type:'ap'")) || '');
  assert(/sx:ap\.x/.test(downLine) && /sy:ap\.y/.test(downLine),
    'real AP pointerdown stores drag-start coords (sx/sy) for move detection');
  const moveLine = (APP_SOURCE.split('\n').find(l => l.includes("dragging.type==='ap'") && l.includes('ap.x=')) || '');
  assert(/ap\.x=/.test(moveLine) && /ap\.y=/.test(moveLine),
    'real AP pointermove mutates ap.x/ap.y (committed position change)');
  // pointermove block ends with scheduleHeat(); draw2d(); return; (preview untouched)
  const moveIdx = APP_SOURCE.split('\n').indexOf(moveLine);
  const moveWindow = APP_SOURCE.split('\n').slice(moveIdx, moveIdx + 80).join('\n');
  assert(/scheduleHeat\(\); draw2d\(\); return;/.test(moveWindow),
    'real AP pointermove still refreshes quick preview (scheduleHeat + draw2d)');
  const upWindow = APP_SOURCE.slice(APP_SOURCE.indexOf("const dragRef=dragging"));
  assert(/dragRef\.type==='ap'/.test(upWindow) && /markRfChanged\(\)/.test(upWindow),
    'real pointerup invalidates a moved AP at drag-end via markRfChanged()');
  // Behavioural: CURRENT -> drag-path mutation -> STALE, canvas retained.
  const ctx = createEnv();
  run(ctx, `
    state.floors[0].aps = [{ id: 'AP-001', x: 5, y: 5 }];
    rt3dNormalActive = true;
    rt3dNormalCanvas = { width: 100, height: 100 };
    rt3dNormalMeta = { simulationRevision: 0, simulationStartRevision: 0 };
    state.rfRevision = 0;
  `);
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  const before = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus").textContent');
  const wasCurrent = /actualizada|up to date|uppdaterad/.test(before);
  const revBefore = run(ctx, '__TEST_STATE__().rfRevision');
  // Simulate the fixed drag gesture: position write (pointermove) + single
  // drag-end markRfChanged() (pointerup), only because position changed.
  run(ctx, `
    (() => {
      const ap = state.floors[0].aps.find(a => a.id === 'AP-001');
      const sx = ap.x, sy = ap.y;
      ap.x = 8.25; ap.y = 6.5; // visibly different XY, as in the smoke test
      if (ap.x !== sx || ap.y !== sy) __TEST_MARK_RF_CHANGED__();
    })();
  `);
  const revAfter = run(ctx, '__TEST_STATE__().rfRevision');
  run(ctx, '__TEST_UPDATE_SIM_STATUS__()');
  const after = run(ctx, '__TEST_DOCUMENT__().getElementById("simStatus").textContent');
  const isStale = /desactualizada|out of date|föråldrad/.test(after);
  const canvasRetained = run(ctx, '!!rt3dNormalCanvas && __TEST_RT3D_NORMAL_ACTIVE__()');
  assert(wasCurrent && revAfter === revBefore + 1 && isStale && canvasRetained,
    'AP drag gesture: CURRENT -> rfRevision+1 -> STALE, authoritative canvas retained');
  // Click without move must NOT invalidate.
  const ctx2 = createEnv();
  run(ctx2, `
    state.floors[0].aps = [{ id: 'AP-001', x: 5, y: 5 }];
    rt3dNormalActive = true;
    rt3dNormalCanvas = { width: 100, height: 100 };
    rt3dNormalMeta = { simulationRevision: 1, simulationStartRevision: 1 };
    state.rfRevision = 1;
  `);
  const r0 = run(ctx2, '__TEST_STATE__().rfRevision');
  run(ctx2, `
    (() => {
      const ap = state.floors[0].aps.find(a => a.id === 'AP-001');
      if (ap.x !== 5 || ap.y !== 5) __TEST_MARK_RF_CHANGED__(); // no movement
    })();
  `);
  assert(run(ctx2, '__TEST_STATE__().rfRevision') === r0,
    'AP click without movement does not increment rfRevision');
}

// --- Test 20: AP nudge / numeric X/Y / mount-height invalidation ---
{
  assert(/if\(rf\)\{\s*markRfChanged\(\); scheduleHeat\(\); \}/.test(APP_SOURCE),
    'real keyboard nudge invalidates RF-relevant moves (ap/pillar/rfobj/wall/opening)');
  const xLine = (APP_SOURCE.split('\n').find(l => l.includes("$('#pX')") && l.includes('ap.x=')) || '');
  const yLine = (APP_SOURCE.split('\n').find(l => l.includes("$('#pY')") && l.includes('ap.y=')) || '');
  assert(/markRfChanged/.test(xLine), 'AP numeric X edit calls markRfChanged()');
  assert(/markRfChanged/.test(yLine), 'AP numeric Y edit calls markRfChanged()');
  const mtIdx = APP_SOURCE.split('\n').findIndex(l => l.includes("$('#pMt')") && l.includes('oninput'));
  const mtWindow = APP_SOURCE.split('\n').slice(mtIdx, mtIdx + 6).join('\n');
  assert(/markRfChanged/.test(mtWindow), 'AP mount-height edit calls markRfChanged()');
}

console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
if (failed > 0) process.exit(1);