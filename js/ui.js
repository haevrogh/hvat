import {
  doubleForce,
  isValidDouble,
  isValidSingle,
  springForce,
} from './formulas.js';
import { findByWeightDouble, findByWeightSingle } from './finders.js';
import { initLogbook } from './logbook.js';

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
  const tabLog = document.getElementById('tabLog');
  const viewCalc = document.getElementById('viewCalc');
  const viewPick = document.getElementById('viewPick');
  const viewLog = document.getElementById('viewLog');

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

  const logForm = document.getElementById('logForm');
  const logStatus = document.getElementById('logStatus');
  const logEmpty = document.getElementById('logEmpty');
  const logList = document.getElementById('logList');
  const logWarning = document.getElementById('logConfigWarning');
  const logDate = document.getElementById('logDate');

  function switchTab(which) {
    const map = {
      calc: { tab: tabCalc, view: viewCalc },
      pick: { tab: tabPick, view: viewPick },
      log: { tab: tabLog, view: viewLog },
    };
    Object.entries(map).forEach(([key, pair]) => {
      const isActive = key === which;
      pair.tab?.classList.toggle('active', isActive);
      pair.view?.classList.toggle('hidden', !isActive);
    });
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

  function setLogStatus(message, tone = 'muted', persist = false) {
    if (!logStatus) return;
    logStatus.textContent = message;
    logStatus.className = `log-status ${tone}`.trim();
    if (message) {
      logStatus.classList.add('active');
    } else {
      logStatus.classList.remove('active');
    }
    if (!persist && message) {
      window.setTimeout(() => {
        if (logStatus.textContent === message) {
          logStatus.textContent = '';
          logStatus.classList.remove('active');
        }
      }, 4000);
    }
  }

  function setLogFormDisabled(flag) {
    if (!logForm) return;
    const elements = Array.from(logForm.elements || []);
    elements.forEach((el) => {
      el.disabled = flag;
    });
    logForm.classList.toggle('is-disabled', Boolean(flag));
  }

  function setLogDateDefault() {
    if (!logDate) return;
    const now = new Date();
    const iso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
    if (!logDate.value) logDate.value = iso;
    logDate.max = iso;
  }

  function renderLogEntries(entries) {
    if (!logList || !logEmpty) return;
    if (!entries || entries.length === 0) {
      logEmpty.classList.remove('hidden');
      logList.innerHTML = '';
      return;
    }

    logEmpty.classList.add('hidden');
    logList.innerHTML = '';

    entries.forEach((entry) => {
      const item = document.createElement('article');
      item.className = 'log-entry';

      const top = document.createElement('div');
      top.className = 'log-entry__top';

      const left = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'log-entry__title';
      title.textContent = entry.movement || 'Подход';
      left.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'log-entry__meta';
      const parts = [];
      if (entry.sessionDate) {
        const d = new Date(entry.sessionDate);
        parts.push(
          Number.isNaN(d.getTime())
            ? entry.sessionDate
            : d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }),
        );
      }
      if (entry.band) parts.push(entry.band);
      if (typeof entry.tension === 'number') parts.push(`${entry.tension.toFixed(1)} кг`);
      if (parts.length > 0) {
        meta.textContent = parts.join(' · ');
        left.appendChild(meta);
      }

      top.appendChild(left);

      const volume = document.createElement('div');
      volume.className = 'log-entry__volume';
      const volParts = [];
      if (typeof entry.sets === 'number' && typeof entry.reps === 'number') {
        volParts.push(`${entry.sets}×${entry.reps}`);
      } else if (typeof entry.sets === 'number') {
        volParts.push(`${entry.sets} подход`);
      }
      if (typeof entry.rpe === 'number') {
        volParts.push(`RPE ${entry.rpe}`);
      }
      volume.textContent = volParts.join(' · ');
      if (volume.textContent) {
        top.appendChild(volume);
      }

      item.appendChild(top);

      if (entry.notes) {
        const notes = document.createElement('p');
        notes.className = 'log-entry__notes';
        notes.textContent = entry.notes;
        item.appendChild(notes);
      }

      const stamp = document.createElement('div');
      stamp.className = 'log-entry__stamp';
      if (entry.loggedAt instanceof Date) {
        stamp.textContent = `Добавлено ${entry.loggedAt.toLocaleString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
          day: '2-digit',
          month: 'short',
        })}`;
      } else {
        stamp.textContent = 'Добавлено';
      }
      item.appendChild(stamp);

      logList.appendChild(item);
    });
  }

  safeOn(tabCalc, 'click', () => switchTab('calc'));
  safeOn(tabPick, 'click', () => switchTab('pick'));
  safeOn(tabLog, 'click', () => switchTab('log'));

  safeOn(posI, 'input', renderPair);
  safeOn(posII, 'input', renderPair);
  modeInputs.forEach((input) => safeOn(input, 'change', renderPair));

  safeOn(targetKg, 'input', renderOptions);
  modePickInputs.forEach((input) => safeOn(input, 'change', renderOptions));

  if (logEmpty) logEmpty.classList.add('hidden');

  const firebaseConfig = window.HVAT_CLOUD?.firebaseConfig ?? null;
  let logReadyShown = false;
  const logbook = initLogbook(firebaseConfig, {
    onStatusChange(status) {
      switch (status.kind) {
        case 'missing-config':
          if (logWarning) logWarning.classList.remove('hidden');
          setLogStatus('Добавь конфигурацию Firebase, чтобы включить журнал.', 'error', true);
          setLogFormDisabled(true);
          break;
        case 'connecting':
          if (logWarning) logWarning.classList.add('hidden');
          setLogFormDisabled(true);
          setLogStatus('Подключаем облачную базу…', 'muted', true);
          break;
        case 'ready':
          if (logWarning) logWarning.classList.add('hidden');
          setLogFormDisabled(false);
          if (!logReadyShown) {
            setLogStatus('Готово! Можно сохранять подходы.', 'success');
            logReadyShown = true;
          } else {
            setLogStatus('', 'muted', true);
          }
          break;
        case 'error':
          setLogFormDisabled(false);
          setLogStatus(`Ошибка журнала: ${status.error?.message || status.error || 'неизвестно'}`, 'error', true);
          break;
        default:
          break;
      }
    },
    onEntries(entries) {
      renderLogEntries(entries);
    },
  });

  setLogDateDefault();

  safeOn(logForm, 'submit', async (event) => {
    event.preventDefault();
    if (!logForm) return;
    if (!firebaseConfig) {
      setLogStatus('Журнал недоступен без настроенной Firebase-конфигурации.', 'error', true);
      return;
    }
    const form = new FormData(logForm);
    const entry = {
      sessionDate: form.get('sessionDate') || '',
      movement: form.get('movement') || '',
      band: form.get('band') || '',
      tension: form.get('tension') || '',
      sets: form.get('sets') || '',
      reps: form.get('reps') || '',
      rpe: form.get('rpe') || '',
      notes: form.get('notes') || '',
    };
    try {
      setLogFormDisabled(true);
      setLogStatus('Сохраняем…', 'muted', true);
      await logbook.addEntry(entry);
      logForm.reset();
      setLogDateDefault();
      setLogStatus('Подход сохранён!', 'success');
    } catch (error) {
      setLogStatus(`Не удалось сохранить: ${error?.message || error}`, 'error', true);
    } finally {
      setLogFormDisabled(false);
    }
  });

  makeTicks(ticksI);
  makeTicks(ticksII);
  renderPair();
  renderOptions();
}
