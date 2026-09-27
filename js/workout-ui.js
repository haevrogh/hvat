import {
  ARMS, ARM_LABELS, BACKUP_FORMAT, BACKUP_VERSION, PAIRS,
  calculateRecords, completedSets, copyPlan, createPlan, makeSet, newId,
  nextPending, pairFor, repeatFromHistory, validateBackup,
} from './workout-model.js';
import { finishWorkout, mergeBackup, put, readAll, remove, setMeta } from './workout-db.js';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const formatDate = (date) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(date));
const weightLabel = (set) => `${pairFor(set.i, set.j).kg.toFixed(1)} кг · I ${set.i} / II ${set.j}`;
const pairValue = (set) => `${set.i}-${set.j}`;
const pairOptions = (selected) => PAIRS.map((pair) =>
  `<option value="${pair.i}-${pair.j}" ${selected === `${pair.i}-${pair.j}` ? 'selected' : ''}>${pair.kg.toFixed(1)} кг · ${pair.i} / ${pair.j}</option>`).join('');
const doneCount = (sets) => ARMS.reduce((sum, arm) => sum + sets[arm].filter((set) => set.status === 'done').length, 0);
const totalCount = (sets) => ARMS.reduce((sum, arm) => sum + sets[arm].length, 0);

export async function initTrainingUI() {
  const sectionCalc = $('sectionCalc');
  const sectionTraining = $('sectionTraining');
  let state;
  try {
    state = await readAll();
  } catch (error) {
    $('sectionTrainingButton').addEventListener('click', () => {
      sectionCalc.classList.add('hidden');
      sectionTraining.classList.remove('hidden');
      document.body.classList.add('training-active');
      $('trainingHome').innerHTML = '<div class="training-panel"><h1>Не удалось открыть тренировки</h1><p>Проверь, разрешено ли хранение данных для этого сайта в браузере, и перезапусти приложение.</p></div>';
    });
    $('sectionCalcButton').addEventListener('click', () => {
      sectionCalc.classList.remove('hidden');
      sectionTraining.classList.add('hidden');
      document.body.classList.remove('training-active');
    });
    console.error('Training storage unavailable', error);
    return;
  }
  let view = 'home';
  let editor = null;
  let pendingTemplateUpdate = null;
  let historyLimit = 10;
  let recordHistoryOpen = false;
  let audioContext = null;
  let lastSignal = '';
  let restDoneUntil = 0;
  let toastTimeout;

  function message(text, error = false) {
    const box = $('trainingMessage');
    box.textContent = text;
    box.classList.toggle('error', error);
    box.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => box.classList.add('hidden'), 5500);
  }

  function switchSection(training) {
    sectionCalc.classList.toggle('hidden', training);
    sectionTraining.classList.toggle('hidden', !training);
    document.body.classList.toggle('training-active', training);
    $('sectionCalcButton').classList.toggle('active', !training);
    $('sectionTrainingButton').classList.toggle('active', training);
    $('sectionCalcButton').setAttribute('aria-pressed', String(!training));
    $('sectionTrainingButton').setAttribute('aria-pressed', String(training));
    if (training) {
      view = state.active ? 'session' : 'home';
      render();
    }
  }

  function render() {
    $('trainingHome').classList.toggle('hidden', view !== 'home');
    $('trainingSession').classList.toggle('hidden', view !== 'session' || !state.active);
    renderHome();
    if (state.active) renderSession();
  }

  function renderHome() {
    const resume = $('resumeCard');
    resume.classList.toggle('hidden', !state.active);
    if (state.active) {
      resume.innerHTML = `<div><strong>Тренировка продолжается</strong><small>${esc(state.active.title)} · ${doneCount(state.active.sets)} из ${totalCount(state.active.sets)} подходов</small></div><button class="button" type="button" data-action="resume">Продолжить</button>`;
    }
    $('templateCount').textContent = state.templates.length;
    $('templateList').innerHTML = state.templates.length
      ? [...state.templates].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((template) => `
        <div class="training-item"><div class="training-item__main"><strong>${esc(template.name)}</strong>
          <small>Правая ${template.sets.right.length} · левая ${template.sets.left.length} · отдых ${template.restSec} с</small></div>
          <div class="training-item__actions"><button class="button button--primary" data-action="start-template" data-id="${esc(template.id)}" type="button">Начать</button>
          <button class="button" data-action="edit-template" data-id="${esc(template.id)}" type="button">Изменить</button>
          <button class="button button--danger" data-action="delete-template" data-id="${esc(template.id)}" type="button">Удалить</button></div></div>`).join('')
      : '<div class="empty-state">Пока нет шаблонов. Создай первый план для правой и левой руки.</div>';

    const history = [...state.workouts].sort((a, b) => b.endedAt.localeCompare(a.endedAt));
    $('historyCount').textContent = history.length;
    $('historyList').innerHTML = history.length
      ? history.slice(0, historyLimit).map((workout) => `
        <div class="training-item"><div class="training-item__main"><strong>${esc(workout.title)}</strong>
          <small>${formatDate(workout.endedAt)} · ${workout.partial ? 'частично · ' : ''}правая ${workout.sets.right.length}, левая ${workout.sets.left.length}</small>
          <details class="history-details"><summary>Подходы</summary>${ARMS.map((arm) => `<div><b>${ARM_LABELS[arm]}</b> ${workout.sets[arm].map((set) => `${set.kg.toFixed(1)} кг × ${set.actualReps}`).join(' · ') || '—'}</div>`).join('')}</details></div>
          <div class="training-item__actions"><button class="button" data-action="repeat-history" data-id="${esc(workout.id)}" type="button">Повторить</button>
          <button class="button button--danger" data-action="delete-history" data-id="${esc(workout.id)}" type="button">Удалить</button></div></div>`).join('')
      : '<div class="empty-state">Завершённые тренировки появятся здесь.</div>';
    $('showMoreHistory').classList.toggle('hidden', history.length <= historyLimit);
    renderRecords();
  }

  function renderRecords() {
    const { best, events } = calculateRecords(state.workouts, state.manualRecords);
    $('recordsOverview').innerHTML = '<div>Повторы</div><div>Правая</div><div>Левая</div>'
      + Array.from({ length: 10 }, (_, index) => {
        const n = index + 1;
        return `<div>${n}ПМ</div><div>${best.right[n] ? `${best.right[n].kg.toFixed(1)} кг` : '—'}</div><div>${best.left[n] ? `${best.left[n].kg.toFixed(1)} кг` : '—'}</div>`;
      }).join('');
    $('recordHistory').classList.toggle('hidden', !recordHistoryOpen);
    const timeline = events.length ? events.map((event) => `
      <div class="record-event"><span><b>${ARM_LABELS[event.arm]}, ${event.reps}ПМ</b> · ${event.kg.toFixed(1)} кг <small>(${event.i} / ${event.j})</small></span>
      <span>${formatDate(event.at)}</span></div>`).join('')
      : '<div class="empty-state">Рекорды появятся после тренировки или ручного ввода 1ПМ.</div>';
    const manual = state.manualRecords.length ? `<h3>Ручные записи 1ПМ</h3>${[...state.manualRecords]
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).map((record) => `
      <div class="record-event"><span>${ARM_LABELS[record.arm]} · ${record.kg.toFixed(1)} кг · ${formatDate(record.recordedAt)}</span>
      <button class="button button--danger" type="button" data-action="delete-manual" data-id="${esc(record.id)}" aria-label="Удалить ручную запись">Удалить</button></div>`).join('')}` : '';
    $('recordHistory').innerHTML = timeline + manual;
  }

  function renderSession() {
    const active = state.active;
    if (!active) return;
    const completed = doneCount(active.sets);
    const total = totalCount(active.sets);
    const current = nextPending(active.sets);
    $('sessionProgress').textContent = `${completed} / ${total} подходов`;
    $('toggleSound').textContent = `Звук: ${state.settings.sound ? 'вкл' : 'выкл'}`;
    $('toggleSound').setAttribute('aria-pressed', String(state.settings.sound));
    if (current) {
      const pair = pairFor(current.set.i, current.set.j);
      $('sessionHero').innerHTML = `<div class="session-hero__top"><p class="eyebrow">ПОДХОД ${completed + 1} ИЗ ${total}</p><span>${ARM_LABELS[current.arm]}</span></div>
        <h1>${ARM_LABELS[current.arm]} рука</h1><div class="session-hero__weight">${pair.kg.toFixed(1)}<span>кг</span></div>
        <div class="session-hero__springs">Пружина I — ${pair.i} · Пружина II — ${pair.j}</div>
        <div class="session-fields"><label>Вес и позиции<select id="sessionWeight" aria-label="Вес и позиции пружин">${pairOptions(pairValue(current.set))}</select></label>
          <label>План<input id="sessionPlannedReps" type="number" min="1" max="999" step="1" value="${current.set.reps}" aria-label="Плановые повторы" /></label>
          <label>Факт<input id="sessionActualReps" type="number" min="1" max="999" step="1" value="${current.set.reps}" aria-label="Фактические повторы" /></label></div>`;
    } else {
      $('sessionHero').innerHTML = `<p class="eyebrow">ПЛАН ВЫПОЛНЕН</p><h1>Все подходы готовы</h1><p>Заверши тренировку, чтобы сохранить её в истории и обновить рекорды.</p>`;
    }
    $('completeSet').disabled = !current || !!(active.restUntil && active.restUntil > Date.now());
    $('finishTraining').disabled = completed === 0;
    $('sessionQueue').innerHTML = ARMS.map((arm) => `<div class="session-queue-arm"><h3>${ARM_LABELS[arm]} рука</h3>
      ${active.sets[arm].map((set) => `<div class="session-queue-row ${set.status === 'done' ? 'done' : current?.set.id === set.id ? 'current' : ''}"><span>${set.status === 'done' ? '✓' : '○'} ${weightLabel(set)}</span><span>${set.status === 'done' ? set.actualReps : set.reps} повт.</span></div>`).join('')}</div>`).join('')
      + (completed ? '<button id="undoSet" class="button button--quiet" type="button">Отменить последний подход</button>' : '');
    renderRest();
  }

  function ensureAudio() {
    if (!state.settings.sound) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    } catch { /* Audio is optional on this device. */ }
  }

  function signal(second) {
    if (document.hidden || !state.active) return;
    const key = `${state.active.restUntil}:${second}`;
    if (lastSignal === key) return;
    lastSignal = key;
    try {
      if (state.settings.sound && audioContext?.state === 'running') {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = second === 0 ? 880 : 650;
        gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.14, audioContext.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + (second === 0 ? 0.3 : 0.12));
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + (second === 0 ? 0.31 : 0.13));
      }
      navigator.vibrate?.(second === 0 ? [160, 70, 160] : 55);
    } catch { /* Sound and vibration are best effort. */ }
  }

  function renderRest() {
    const panel = $('restPanel');
    const active = state.active;
    if (!active || !active.restUntil) {
      if (active && restDoneUntil > Date.now()) {
        panel.innerHTML = '<div><strong>Отдых завершён</strong><small>Следующий подход готов</small></div>';
        panel.classList.remove('hidden');
        return;
      }
      panel.classList.add('hidden');
      return;
    }
    const remaining = Math.max(0, Math.ceil((active.restUntil - Date.now()) / 1000));
    if (remaining <= 5 && remaining >= 0) signal(remaining);
    if (remaining === 0) {
      active.restUntil = null;
      restDoneUntil = Date.now() + 3500;
      setMeta('active', active).catch(console.error);
      $('completeSet').disabled = !nextPending(active.sets);
      renderRest();
      return;
    }
    panel.classList.remove('hidden');
    const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
    const seconds = String(remaining % 60).padStart(2, '0');
    panel.innerHTML = `<div><small>Отдых · следующий подход</small><strong>${minutes}:${seconds}</strong></div><button class="button" type="button" data-action="skip-rest">Пропустить</button>`;
  }

  function openEditor(purpose, source = null) {
    let sets; let name; let restSec;
    if (purpose === 'create') { sets = createPlan(); name = ''; restSec = 90; }
    if (purpose === 'edit') { sets = copyPlan(source.sets); name = source.name; restSec = source.restSec; }
    if (purpose === 'repeat') { sets = repeatFromHistory(source); name = `Повтор: ${source.title}`; restSec = source.restSec; }
    if (purpose === 'session') {
      sets = Object.fromEntries(ARMS.map((arm) => [arm, state.active.sets[arm]
        .filter((set) => set.status === 'pending').map((set) => ({ ...set }))]));
      name = state.active.title; restSec = state.active.restSec;
    }
    if (!sets) { message('Невозможно повторить эту запись.', true); return; }
    editor = { purpose, source, sets };
    $('planDialogTitle').textContent = ({ create: 'Новый шаблон', edit: 'Изменить шаблон', repeat: 'Повторить тренировку', session: 'Изменить план занятия' })[purpose];
    $('savePlan').textContent = purpose === 'repeat' ? 'Начать' : 'Сохранить';
    $('planName').value = name;
    $('planRest').value = restSec;
    $('planError').classList.add('hidden');
    renderPlanArms();
    $('planDialog').showModal();
  }

  function renderPlanArms() {
    if (!editor) return;
    const leftStarted = editor.purpose === 'session' && state.active.sets.left.some((set) => set.status === 'done');
    $('planArms').innerHTML = ARMS.map((arm) => {
      const completed = editor.purpose === 'session' ? state.active.sets[arm].filter((set) => set.status === 'done').length : 0;
      const locked = arm === 'right' && leftStarted;
      return `<div class="arm-editor" data-arm="${arm}"><div class="arm-editor__heading"><h3>${ARM_LABELS[arm]} рука</h3>
        <button class="button button--quiet" type="button" data-action="add-set" data-arm="${arm}" ${locked ? 'disabled' : ''}>+ Подход</button></div>
        ${completed ? `<p class="muted">Уже выполнено: ${completed}</p>` : ''}
        ${editor.sets[arm].map((set, index) => `<div class="set-row" data-arm="${arm}" data-index="${index}">
          <select aria-label="Вес подхода ${index + 1}, ${ARM_LABELS[arm]} рука" data-field="weight" ${locked ? 'disabled' : ''}>${pairOptions(pairValue(set))}</select>
          <label class="set-row__reps">Повторы<input type="number" min="1" max="999" step="1" value="${set.reps}" aria-label="Повторы подхода ${index + 1}, ${ARM_LABELS[arm]} рука" data-field="reps" ${locked ? 'disabled' : ''} /></label>
          <span class="set-row__actions"><button class="icon-button" type="button" data-action="duplicate-set" aria-label="Дублировать подход" ${locked ? 'disabled' : ''}>＋</button>
          <button class="icon-button" type="button" data-action="move-up" aria-label="Выше" ${locked || index === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-button" type="button" data-action="move-down" aria-label="Ниже" ${locked || index === editor.sets[arm].length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon-button" type="button" data-action="delete-set" aria-label="Удалить подход" ${locked || (editor.sets[arm].length === 1 && !completed) ? 'disabled' : ''}>×</button></span></div>`).join('')}
        ${!editor.sets[arm].length ? '<p class="muted">Новых подходов нет.</p>' : ''}</div>`;
    }).join('');
  }

  function editorChanged(event) {
    const row = event.target.closest('.set-row');
    if (!row || !editor) return;
    const { arm, index } = row.dataset;
    const set = editor.sets[arm][Number(index)];
    if (event.target.dataset.field === 'weight') {
      const [i, j] = event.target.value.split('-').map(Number);
      const pair = pairFor(i, j);
      Object.assign(set, { i: pair.i, j: pair.j, kg: pair.kg });
    }
    if (event.target.dataset.field === 'reps') set.reps = Number(event.target.value);
  }

  function editorAction(event) {
    if (!editor) return;
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const arm = button.dataset.arm || button.closest('.set-row')?.dataset.arm;
    if (!arm) return;
    const list = editor.sets[arm];
    const index = Number(button.closest('.set-row')?.dataset.index);
    if (action === 'add-set') list.push(makeSet(list.at(-1) ? pairFor(list.at(-1).i, list.at(-1).j) : undefined, list.at(-1)?.reps || 5));
    if (action === 'duplicate-set') list.splice(index + 1, 0, { ...list[index], id: newId() });
    if (action === 'delete-set') list.splice(index, 1);
    if (action === 'move-up' && index > 0) [list[index - 1], list[index]] = [list[index], list[index - 1]];
    if (action === 'move-down' && index < list.length - 1) [list[index + 1], list[index]] = [list[index], list[index + 1]];
    renderPlanArms();
  }

  async function saveEditor(event) {
    event.preventDefault();
    if (!editor) return;
    const name = $('planName').value.trim();
    const restSec = Number($('planRest').value);
    const completed = editor.purpose === 'session' ? completedSets(state.active.sets) : { right: [], left: [] };
    const error = !name ? 'Укажи название.'
      : !Number.isInteger(restSec) || restSec < 0 || restSec > 3600 ? 'Отдых должен быть от 0 до 3600 секунд.'
      : ARMS.some((arm) => completed[arm].length + editor.sets[arm].length < 1) ? 'Нужен хотя бы один подход для каждой руки.'
      : ARMS.some((arm) => editor.sets[arm].some((set) => !Number.isInteger(set.reps) || set.reps < 1 || set.reps > 999)) ? 'Повторы должны быть целым числом от 1 до 999.'
      : null;
    if (error) { $('planError').textContent = error; $('planError').classList.remove('hidden'); return; }
    const now = new Date().toISOString();
    if (editor.purpose === 'create' || editor.purpose === 'edit') {
      const original = editor.purpose === 'edit' ? editor.source : null;
      const template = { id: original?.id || newId(), name, restSec,
        sets: editor.sets, createdAt: original?.createdAt || now, updatedAt: now };
      await put('templates', template);
      state.templates = state.templates.filter((item) => item.id !== template.id).concat(template);
      message(original ? 'Шаблон обновлён.' : 'Шаблон сохранён. Можно начинать.');
    } else if (editor.purpose === 'repeat') {
      await startSession({ title: name, restSec, sets: editor.sets, sourceTemplateId: null });
    } else if (editor.purpose === 'session') {
      state.active.title = name;
      state.active.restSec = restSec;
      state.active.sets = Object.fromEntries(ARMS.map((arm) => [arm, [...completed[arm], ...editor.sets[arm]]]));
      await setMeta('active', state.active);
      message('План занятия обновлён.');
    }
    editor = null;
    $('planDialog').close();
    render();
  }

  async function startSession({ title, restSec, sets, sourceTemplateId }) {
    if (state.active) { message('Сначала заверши или отмени текущую тренировку.', true); return; }
    const now = new Date().toISOString();
    state.active = { id: newId(), title, sourceTemplateId, startedAt: now, restSec,
      initialPlan: copyPlan(sets), sets: copyPlan(sets), restUntil: null };
    await setMeta('active', state.active);
    view = 'session';
    ensureAudio();
    render();
  }

  async function completeSet() {
    const active = state.active;
    if (!active || (active.restUntil && active.restUntil > Date.now())) return;
    const current = nextPending(active.sets);
    if (!current) return;
    const actualReps = Number($('sessionActualReps').value);
    if (!Number.isInteger(actualReps) || actualReps < 1 || actualReps > 999) {
      message('Укажи фактические повторы от 1 до 999.', true); return;
    }
    ensureAudio();
    current.set.status = 'done';
    current.set.actualReps = actualReps;
    current.set.completedAt = new Date().toISOString();
    active.restUntil = nextPending(active.sets) && active.restSec > 0 ? Date.now() + active.restSec * 1000 : null;
    lastSignal = '';
    await setMeta('active', active);
    renderSession();
  }

  async function undoSet() {
    const active = state.active;
    if (!active) return;
    const list = [...active.sets.right, ...active.sets.left].filter((set) => set.status === 'done');
    const last = list.at(-1);
    if (!last) return;
    last.status = 'pending';
    delete last.actualReps;
    delete last.completedAt;
    active.restUntil = null;
    await setMeta('active', active);
    renderSession();
  }

  async function finishSession() {
    const active = state.active;
    if (!active || !doneCount(active.sets)) return;
    const now = new Date().toISOString();
    const sets = completedSets(active.sets);
    const workout = { id: active.id, title: active.title, sourceTemplateId: active.sourceTemplateId,
      startedAt: active.startedAt, endedAt: now, restSec: active.restSec, initialPlan: active.initialPlan,
      sets, partial: doneCount(active.sets) < totalCount(active.sets) };
    await finishWorkout(workout);
    state.workouts.push(workout);
    state.active = null;
    view = 'home';
    render();
    message(workout.partial ? 'Частичная тренировка сохранена.' : 'Тренировка сохранена.');
    const template = state.templates.find((item) => item.id === workout.sourceTemplateId);
    if (template && sets.right.length && sets.left.length) {
      pendingTemplateUpdate = { template, workout };
      const describe = (rows, actual = false) => rows.map((set) =>
        `${pairFor(set.i, set.j).kg.toFixed(1)} кг × ${actual ? set.actualReps : set.reps}`).join(' · ');
      $('updateTemplateSummary').textContent = `«${template.name}»\nБыло — правая: ${describe(template.sets.right)}\nСтанет — правая: ${describe(sets.right, true)}\n\nБыло — левая: ${describe(template.sets.left)}\nСтанет — левая: ${describe(sets.left, true)}\n\nОтдых: ${template.restSec} → ${workout.restSec} с`;
      $('updateTemplateDialog').showModal();
    }
  }

  async function replaceTemplate() {
    if (!pendingTemplateUpdate) return;
    const { template, workout } = pendingTemplateUpdate;
    template.sets = copyPlan(workout.sets, true);
    template.restSec = workout.restSec;
    template.updatedAt = new Date().toISOString();
    await put('templates', template);
    pendingTemplateUpdate = null;
    $('updateTemplateDialog').close();
    renderHome();
    message('Шаблон обновлён по выполненной тренировке.');
  }

  async function homeAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'resume') { view = 'session'; render(); return; }
    if (action === 'skip-rest') { state.active.restUntil = null; await setMeta('active', state.active); renderSession(); return; }
    const template = state.templates.find((item) => item.id === id);
    const workout = state.workouts.find((item) => item.id === id);
    if (action === 'start-template' && template) await startSession({ title: template.name, restSec: template.restSec, sets: template.sets, sourceTemplateId: template.id });
    if (action === 'edit-template' && template) openEditor('edit', template);
    if (action === 'repeat-history' && workout) openEditor('repeat', workout);
    if (action === 'delete-template' && template && confirm(`Удалить шаблон «${template.name}»? История останется.`)) {
      await remove('templates', id); state.templates = state.templates.filter((item) => item.id !== id); renderHome();
    }
    if (action === 'delete-history' && workout && confirm('Удалить тренировку из истории? Рекорды будут пересчитаны.')) {
      await remove('workouts', id); state.workouts = state.workouts.filter((item) => item.id !== id); renderHome();
    }
    if (action === 'delete-manual' && confirm('Удалить ручной 1ПМ?')) {
      await remove('manualRecords', id); state.manualRecords = state.manualRecords.filter((item) => item.id !== id); renderHome();
    }
  }

  async function sessionFieldChanged(event) {
    const current = state.active && nextPending(state.active.sets);
    if (!current) return;
    const previousPlanned = current.set.reps;
    const previousActual = Number($('sessionActualReps')?.value);
    let nextActual = previousActual;
    if (event.target.id === 'sessionWeight') {
      const [i, j] = event.target.value.split('-').map(Number);
      const pair = pairFor(i, j);
      Object.assign(current.set, { i: pair.i, j: pair.j, kg: pair.kg });
    } else if (event.target.id === 'sessionPlannedReps') {
      const reps = Number(event.target.value);
      if (!Number.isInteger(reps) || reps < 1 || reps > 999) { message('Плановые повторы: от 1 до 999.', true); renderSession(); return; }
      current.set.reps = reps;
      if (previousActual === previousPlanned) nextActual = reps;
    } else return;
    await setMeta('active', state.active);
    renderSession();
    if (Number.isInteger(nextActual) && nextActual >= 1 && nextActual <= 999) {
      $('sessionActualReps').value = nextActual;
    }
  }

  async function exportData() {
    const data = await readAll();
    const backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(), data };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `hvat-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message('Резервная копия сохранена в загрузках.');
  }

  async function importData(file) {
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Файл слишком большой (более 20 МБ).');
      const data = validateBackup(JSON.parse(await file.text()));
      const counts = await mergeBackup(data);
      state = await readAll();
      view = state.active ? 'session' : 'home';
      render();
      message(`Импорт: ${counts.templates} шаблонов, ${counts.workouts} тренировок, ${counts.manualRecords} ручных 1ПМ${counts.active ? ', активная тренировка' : ''}.`);
    } catch (error) {
      message(`Не удалось импортировать: ${error.message}`, true);
    } finally { $('importTraining').value = ''; }
  }

  $('sectionCalcButton').addEventListener('click', () => switchSection(false));
  $('sectionTrainingButton').addEventListener('click', () => switchSection(true));
  $('createTemplate').addEventListener('click', () => openEditor('create'));
  $('trainingHome').addEventListener('click', (event) => homeAction(event).catch(console.error));
  $('restPanel').addEventListener('click', (event) => homeAction(event).catch(console.error));
  $('backToTraining').addEventListener('click', () => { view = 'home'; render(); });
  $('completeSet').addEventListener('click', () => completeSet().catch(console.error));
  $('sessionHero').addEventListener('change', (event) => sessionFieldChanged(event).catch(console.error));
  $('sessionQueue').addEventListener('click', (event) => { if (event.target.id === 'undoSet') undoSet().catch(console.error); });
  $('editSessionPlan').addEventListener('click', () => openEditor('session'));
  $('finishTraining').addEventListener('click', () => finishSession().catch(console.error));
  $('cancelTraining').addEventListener('click', async () => {
    if (confirm('Отменить тренировку? Все выполненные подходы этого занятия будут удалены.')) {
      await setMeta('active', null); state.active = null; view = 'home'; render(); message('Тренировка отменена.');
    }
  });
  $('toggleSound').addEventListener('click', async () => {
    state.settings.sound = !state.settings.sound;
    await setMeta('settings', state.settings);
    if (state.settings.sound) ensureAudio();
    renderSession();
  });
  $('planArms').addEventListener('change', editorChanged);
  $('planArms').addEventListener('click', editorAction);
  $('planForm').addEventListener('submit', (event) => saveEditor(event).catch((error) => message(error.message, true)));
  $('closePlanDialog').addEventListener('click', () => $('planDialog').close());
  $('cancelPlan').addEventListener('click', () => $('planDialog').close());
  $('keepTemplate').addEventListener('click', () => { pendingTemplateUpdate = null; $('updateTemplateDialog').close(); });
  $('replaceTemplate').addEventListener('click', () => replaceTemplate().catch(console.error));
  $('showMoreHistory').addEventListener('click', () => { historyLimit += 10; renderHome(); });
  $('showRecordHistory').addEventListener('click', () => { recordHistoryOpen = !recordHistoryOpen; renderRecords(); });
  $('manualWeight').innerHTML = pairOptions(pairValue(PAIRS[Math.floor(PAIRS.length / 2)]));
  $('addManualRecord').addEventListener('click', () => {
    const today = new Date();
    $('manualDate').value = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    $('manualRecordDialog').showModal();
  });
  $('closeManualRecord').addEventListener('click', () => $('manualRecordDialog').close());
  $('cancelManualRecord').addEventListener('click', () => $('manualRecordDialog').close());
  $('manualRecordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const [i, j] = $('manualWeight').value.split('-').map(Number);
    const pair = pairFor(i, j);
    const date = $('manualDate').value;
    if (!pair || !date) return;
    const record = { id: newId(), arm: $('manualArm').value, i, j, kg: pair.kg,
      recordedAt: new Date(`${date}T12:00:00`).toISOString() };
    await put('manualRecords', record);
    state.manualRecords.push(record);
    $('manualRecordDialog').close();
    renderRecords();
    message('1ПМ сохранён.');
  });
  $('exportTraining').addEventListener('click', () => exportData().catch((error) => message(error.message, true)));
  $('importTrainingButton').addEventListener('click', () => $('importTraining').click());
  $('importTraining').addEventListener('change', (event) => importData(event.target.files[0]));

  render();
  setInterval(() => { if (state.active && view === 'session') renderRest(); }, 250);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.active) renderRest(); });
  navigator.storage?.persist?.().catch(() => {});
}
