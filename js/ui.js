import {
  doubleForce,
  isValidDouble,
  isValidSingle,
  springForce,
} from './formulas.js';
import { findByWeightDouble, findByWeightSingle } from './finders.js';

function safeOn(el, evt, fn) {
  if (el && el.addEventListener) {
    el.addEventListener(evt, fn);
  }
}

function makeTicks(el) {
  if (!el) return;
  el.innerHTML = '';
  for (let n = 1; n <= 12; n += 1) {
    const span = document.createElement('span');
    span.textContent = n;
    el.appendChild(span);
  }
}

export function initUI() {
  const tabCalc = document.getElementById('tabCalc');
  const tabPick = document.getElementById('tabPick');
  const viewCalc = document.getElementById('viewCalc');
  const viewPick = document.getElementById('viewPick');

  const posI = document.getElementById('posI');
  const posII = document.getElementById('posII');
  const posILabel = document.getElementById('posI_label');
  const posIILabel = document.getElementById('posII_label');
  const controlII = document.getElementById('controlII');
  const ticksI = document.getElementById('ticksI');
  const ticksII = document.getElementById('ticksII');

  const valueEl = document.getElementById('value');
  const reading = document.getElementById('reading');
  const hint = document.getElementById('hint');

  const targetKg = document.getElementById('targetKg');
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');

  const modeInputs = Array.from(document.querySelectorAll('input[name="mode"]'));
  const modePickInputs = Array.from(
    document.querySelectorAll('input[name="modePick"]'),
  );

  function switchTab(which) {
    const calcActive = which === 'calc';
    tabCalc?.classList.toggle('active', calcActive);
    tabPick?.classList.toggle('active', !calcActive);
    viewCalc?.classList.toggle('hidden', !calcActive);
    viewPick?.classList.toggle('hidden', calcActive);
  }

  function currentMode() {
    const selected = modeInputs.find((input) => input?.checked);
    return selected ? selected.value : 'double';
  }

  function currentPickMode() {
    const selected = modePickInputs.find((input) => input?.checked);
    return selected ? selected.value : 'double';
  }

  function renderPair() {
    if (!posI || !posILabel || !valueEl) return;
    const mode = currentMode();
    const i = parseInt(posI.value || '0', 10);
    posILabel.textContent = Number.isFinite(i) ? i : '—';

    if (mode === 'single') {
      if (controlII) controlII.style.display = 'none';
      if (!isValidSingle(i)) {
        valueEl.textContent = '—';
        if (hint)
          hint.innerHTML = '<span class="warn">Недопустимо</span>: позиция 1–12.';
        return;
      }
      const f = springForce(i).toFixed(1);
      valueEl.textContent = f;
      if (hint) hint.textContent = 'Режим: 1 пружина';
      if (reading) {
        reading.classList.remove('fade');
        void reading.offsetWidth;
        reading.classList.add('fade');
      }
      return;
    }

    if (controlII) controlII.style.display = '';
    const j = parseInt((posII && posII.value) || '0', 10);
    if (posIILabel) posIILabel.textContent = Number.isFinite(j) ? j : '—';
    if (!isValidDouble(i, j)) {
      valueEl.textContent = '—';
      if (hint)
        hint.innerHTML =
          'Недопустимо для 2 пружин: позиции различны и |i−j| ≥ 2, диапазон 1–12.';
      return;
    }
    const f = doubleForce(i, j).toFixed(1);
    valueEl.textContent = f;
    if (hint) hint.textContent = 'Режим: 2 пружины';
    if (reading) {
      reading.classList.remove('fade');
      void reading.offsetWidth;
      reading.classList.add('fade');
    }
  }

  function renderOptions() {
    if (!grid || !empty) return;
    const value = parseFloat((targetKg && targetKg.value) || '');
    const pickMode = currentPickMode();

    if (!Number.isFinite(value)) {
      grid.style.display = 'none';
      empty.style.display = 'block';
      grid.innerHTML = '';
      return;
    }

    const rows = pickMode === 'single'
      ? findByWeightSingle(value)
      : findByWeightDouble(value);

    empty.style.display = 'none';
    grid.style.display = 'grid';
    grid.innerHTML = '';

    rows.forEach((row) => {
      const el = document.createElement('div');
      el.className = 'option';
      if (row.mode === 'single') {
        el.innerHTML = `
          <div>
            <div style="font-weight:600; margin-bottom:4px">${row.f.toFixed(1)} кг</div>
            <div class="muted">Позиция: ${row.i} · 1 пружина</div>
          </div>
          <div class="pill">Δ ${row.diff.toFixed(1)} кг</div>
        `;
      } else {
        el.innerHTML = `
          <div>
            <div style="font-weight:600; margin-bottom:4px">${row.f.toFixed(1)} кг</div>
            <div class="muted">I: ${row.i} · II: ${row.j} · 2 пружины</div>
          </div>
          <div class="pill">Δ ${row.diff.toFixed(1)} кг</div>
        `;
      }
      grid.appendChild(el);
    });
  }

  safeOn(tabCalc, 'click', () => switchTab('calc'));
  safeOn(tabPick, 'click', () => switchTab('pick'));

  safeOn(posI, 'input', renderPair);
  safeOn(posII, 'input', renderPair);
  modeInputs.forEach((input) => safeOn(input, 'change', renderPair));

  safeOn(targetKg, 'input', renderOptions);
  modePickInputs.forEach((input) => safeOn(input, 'change', renderOptions));

  makeTicks(ticksI);
  makeTicks(ticksII);
  renderPair();
  renderOptions();
}
