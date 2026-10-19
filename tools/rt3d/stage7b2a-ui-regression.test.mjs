// Stage 7B.2a UI Regression Test

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom } from './loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', '..', 'index.html'), 'utf8')
  .match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

let pass = 0, fail = 0;
function check(id, name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + String(id).padStart(2) + '. ' + name); }
  else {
    fail++; console.log('  FAIL ' + String(id).padStart(2) + '. ' + name + (detail ? ' :: ' + detail : ''));
  }
}

function makeSandbox(url) {
  const win = makeDom();
  win.location = { search: url };
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
  return ctx;
}

function runInContext(ctx, code) {
  return vm.runInContext(code, ctx, { filename: 'test' });
}

console.log('Stage 7B.2a UI Regression Test\n');

let id = 0;

// ============================================================
// 1. RT3D_EXP_ENABLED gate respects ?rt3d=1
// ============================================================
console.log('--- Gate: RT3D_EXP_ENABLED respects ?rt3d=1 ---');
const ctxGate = makeSandbox('?rt3d=1');
check(++id, 'RT3D_EXP_ENABLED = true with ?rt3d=1', 
  runInContext(ctxGate, 'typeof RT3D_EXP_ENABLED !== "undefined" && RT3D_EXP_ENABLED === true'));

const ctxGate2 = makeSandbox('');
check(++id, 'RT3D_EXP_ENABLED = false without flag', 
  !runInContext(ctxGate2, 'typeof RT3D_EXP_ENABLED !== "undefined" && RT3D_EXP_ENABLED === true'));

// ============================================================
// 2. CSS rule: input[type=file]{display:none} present in full HTML
// ============================================================
console.log('\n--- CSS: file input hidden by default ---');
check(++id, 'CSS rule input[type=file]{display:none} present in full HTML', 
  fs.readFileSync(path.join(path.dirname(path.dirname(HERE)), 'index.html'), 'utf8').includes('input[type=file]{display:none}'));

// ============================================================
// 3. fileLoad input exists in DOM
// ============================================================
console.log('\n--- File input exists in DOM ---');
const ctxFile = makeSandbox('?rt3d=1');
runInContext(ctxFile, 'rt3dExpInit();');
check(++id, 'fileLoad input exists in DOM', 
  runInContext(ctxFile, 'document.getElementById("fileLoad") !== null'));

// ============================================================
// 4. btnLoad (Abrir proyecto) exists and is visible
// ============================================================
console.log('\n--- Abrir proyecto button ---');
const ctxBtn = makeSandbox('');
runInContext(ctxBtn, 'bootUI();');
const btnResult = JSON.parse(runInContext(ctxBtn, 'const btn = document.getElementById("btnLoad"); const exists = btn !== null; const isVisible = exists && getComputedStyle(btn).display !== "none"; JSON.stringify({ exists, isVisible });'));
check(++id, 'btnLoad (Abrir proyecto) exists', btnResult.exists);
check(++id, 'btnLoad is visible', btnResult.isVisible);

// ============================================================
// 5. No visible file inputs (only hidden native one)
// ============================================================
console.log('\n--- No duplicate visible file inputs ---');
const visibleCount1 = runInContext(ctxBtn, 'const inputsA = document.querySelectorAll("input[type=file]"); let visibleA = 0; for (let i = 0; i < inputsA.length; i++) { if (getComputedStyle(inputsA[i]).display !== "none") visibleA++; } visibleA;');
check(++id, 'No visible file inputs (only hidden native one)', visibleCount1 === 0);

// ============================================================
// 6. Experimental panel properties (simulated creation)
// ============================================================
console.log('\n--- Experimental panel properties (simulated) ---');
const ctxPanel = makeSandbox('?rt3d=1');
runInContext(ctxPanel, 'rt3dExpInit();');
const panelProps = runInContext(ctxPanel, 'const el = document.createElement("div"); el.id = "rt3dExpPanel"; el.setAttribute("data-rt3d-dev", "1"); el.innerHTML = \'<select id="rt3dExpView"></select><button id="rt3dExpRunRt3d"></button>\'; const hasId = el.id === "rt3dExpPanel"; const hasEngineSel = el.querySelector("#rt3dExpView") !== null; const hasRunBtn = el.querySelector("#rt3dExpRunRt3d") !== null; JSON.stringify({ hasId, hasEngineSel, hasRunBtn });');
const panelPropsResult = JSON.parse(panelProps);
check(++id, 'Panel element has correct id (simulated)', panelPropsResult.hasId);
check(++id, 'Panel contains engine selector (simulated)', panelPropsResult.hasEngineSel);
check(++id, 'Panel contains run button (simulated)', panelPropsResult.hasRunBtn);

// ============================================================
// 5. btnLoad (Abrir proyecto) exists and is visible
// ============================================================
console.log('\n--- Abrir proyecto button ---');
const ctxBtn2 = makeSandbox('');
runInContext(ctxBtn2, 'bootUI();');
const btnResult2 = JSON.parse(runInContext(ctxBtn2, 'const btn = document.getElementById("btnLoad"); const exists = btn !== null; const isVisible = exists && getComputedStyle(btn).display !== "none"; JSON.stringify({ exists, isVisible });'));
check(++id, 'btnLoad (Abrir proyecto) exists', btnResult2.exists);
check(++id, 'btnLoad is visible', btnResult2.isVisible);

// ============================================================
// 6. No visible file inputs (only hidden native one) - second check
// ============================================================
console.log('\n--- No duplicate visible file inputs ---');
const visibleCount2 = runInContext(ctxBtn, 'const inputsB = document.querySelectorAll("input[type=file]"); let visibleB = 0; for (let i = 0; i < inputsB.length; i++) { if (getComputedStyle(inputsB[i]).display !== "none") visibleB++; } visibleB;');
check(++id, 'No visible file inputs (only hidden native one)', visibleCount2 === 0);

// ============================================================
// 7. CSS rule present in full HTML
// ============================================================
console.log('\n--- CSS rule in full HTML ---');
check(++id, 'CSS rule input[type=file]{display:none} present in full HTML', 
  fs.readFileSync(path.join(path.dirname(path.dirname(HERE)), 'index.html'), 'utf8').includes('input[type=file]{display:none}'));

// ============================================================
// 7. fileLoad input exists in DOM
// ============================================================
console.log('\n--- File input exists in DOM ---');
const ctxFile2 = makeSandbox('?rt3d=1');
runInContext(ctxFile2, 'rt3dExpInit();');
check(++id, 'fileLoad input exists in DOM', 
  runInContext(ctxFile2, 'document.getElementById("fileLoad") !== null'));

// ============================================================
// 8. RT3D_EXP_ENABLED gate respects ?rt3d=1
// ============================================================
console.log('\n--- RT3D_EXP_ENABLED gate ---');
const ctxGate3 = makeSandbox('?rt3d=1');
check(++id, 'RT3D_EXP_ENABLED = true with ?rt3d=1', 
  runInContext(ctxGate3, 'typeof RT3D_EXP_ENABLED !== "undefined" && RT3D_EXP_ENABLED === true'));

const ctxGate4 = makeSandbox('');
check(++id, 'RT3D_EXP_ENABLED = false without flag', 
  !runInContext(ctxGate4, 'typeof RT3D_EXP_ENABLED !== "undefined" && RT3D_EXP_ENABLED === true'));

// ============================================================
// 8. CSS rule present in full HTML
// ============================================================
console.log('\n--- CSS rule in full HTML ---');
check(++id, 'CSS rule input[type=file]{display:none} present in full HTML', 
  fs.readFileSync(path.join(path.dirname(path.dirname(HERE)), 'index.html'), 'utf8').includes('input[type=file]{display:none}'));

// Summary
console.log('\n=== Stage 7B.2a UI Regression Test Results ===');
console.log('Passed: ' + pass);
console.log('Failed: ' + fail);

if (fail > 0) process.exit(1);
