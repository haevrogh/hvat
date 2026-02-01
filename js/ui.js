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
  const tabSimple = document.getElementById('tabSimple');
  const viewCalc = document.getElementById('viewCalc');
  const viewPick = document.getElementById('viewPick');
  const viewSimple = document.getElementById('viewSimple');

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
  const comboTable = document.getElementById('comboTable');
  const comboSelection = document.getElementById('comboSelection');

  const modeInputs = Array.from(document.querySelectorAll('input[name="mode"]'));
  const modePickInputs = Array.from(
    document.querySelectorAll('input[name="modePick"]'),
  );

  function switchTab(which) {
    const calcActive = which === 'calc';
    const pickActive = which === 'pick';
    const simpleActive = which === 'simple';
    tabCalc?.classList.toggle('active', calcActive);
    tabPick?.classList.toggle('active', pickActive);
    tabSimple?.classList.toggle('active', simpleActive);
    viewCalc?.classList.toggle('hidden', !calcActive);
    viewPick?.classList.toggle('hidden', !pickActive);
    viewSimple?.classList.toggle('hidden', !simpleActive);
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

  function renderComboTable() {
    if (!comboTable || !comboSelection) return;
    const combos = [];

    for (let i = 1; i <= 12; i += 1) {
      for (let j = i + 1; j <= 12; j += 1) {
        if (!isValidDouble(i, j)) continue;
        combos.push({ i, j, f: doubleForce(i, j) });
      }
    }

    combos.sort((a, b) => a.f - b.f || a.i - b.i || a.j - b.j);
    comboTable.innerHTML = '';

    combos.forEach((combo, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'combo-tile';
      row.dataset.i = combo.i.toString();
      row.dataset.j = combo.j.toString();
      row.dataset.f = combo.f.toFixed(1);
      row.dataset.index = index.toString();
      row.innerHTML = `
        <span class="combo-weight">${combo.f.toFixed(1)}</span>
        <span class="combo-note" aria-hidden="true"></span>
      `;
      comboTable.appendChild(row);
    });

    comboSelection.textContent = 'Выбор не сделан.';
  }

  function clearComboNotes() {
    if (!comboTable) return;
    comboTable.querySelectorAll('.combo-note').forEach((note) => {
      note.textContent = '';
      note.classList.remove('combo-note--up', 'combo-note--down');
      note.closest('.combo-tile')?.classList.remove('has-note');
    });
  }

  function setComboNote(tile, percent) {
    if (!tile) return;
    const note = tile.querySelector('.combo-note');
    if (!note) return;
    const sign = percent > 0 ? '+' : '';
    note.textContent = `${sign}${percent.toFixed(1)}%`;
    note.classList.add(percent > 0 ? 'combo-note--up' : 'combo-note--down');
    tile.classList.add('has-note');
  }

  function updateComboNotes(selectedTile) {
    if (!comboTable || !selectedTile) return;
    clearComboNotes();
    const tiles = Array.from(comboTable.querySelectorAll('.combo-tile'));
    const tileMap = [];
    tiles.forEach((tile) => {
      const index = Number.parseInt(tile.dataset.index || '', 10);
      if (Number.isFinite(index)) {
        tileMap[index] = tile;
      }
    });
    const selectedIndex = Number.parseInt(selectedTile.dataset.index || '', 10);
    const selectedValue = Number.parseFloat(selectedTile.dataset.f || '');
    if (!Number.isFinite(selectedIndex) || !Number.isFinite(selectedValue) || !selectedValue) {
      return;
    }
    for (let offset = -3; offset <= 3; offset += 1) {
      if (offset === 0) continue;
      const neighbor = tileMap[selectedIndex + offset];
      if (!neighbor) continue;
      const neighborValue = Number.parseFloat(neighbor.dataset.f || '');
      if (!Number.isFinite(neighborValue)) continue;
      const percent = ((neighborValue - selectedValue) / selectedValue) * 100;
      if (Math.abs(percent) < 0.05) continue;
      setComboNote(neighbor, percent);
    }
  }

  function selectCombo(row) {
    if (!comboSelection || !row) return;
    comboTable?.querySelectorAll('.combo-tile.selected').forEach((el) => {
      el.classList.remove('selected');
    });
    row.classList.add('selected');
    updateComboNotes(row);
    const i = row.dataset.i || '—';
    const j = row.dataset.j || '—';
    const f = row.dataset.f || '—';
    comboSelection.textContent = `Выбрано: ${f} кг · Пружины I: ${i}, II: ${j}`;
  }

  safeOn(tabCalc, 'click', () => switchTab('calc'));
  safeOn(tabPick, 'click', () => switchTab('pick'));
  safeOn(tabSimple, 'click', () => switchTab('simple'));

  safeOn(posI, 'input', renderPair);
  safeOn(posII, 'input', renderPair);
  modeInputs.forEach((input) => safeOn(input, 'change', renderPair));

  safeOn(targetKg, 'input', renderOptions);
  modePickInputs.forEach((input) => safeOn(input, 'change', renderOptions));
  safeOn(comboTable, 'click', (event) => {
    const row = event.target.closest('.combo-tile');
    if (!row) return;
    selectCombo(row);
  });

  makeTicks(ticksI);
  makeTicks(ticksII);
  renderPair();
  renderOptions();
  renderComboTable();
}
