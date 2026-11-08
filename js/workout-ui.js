import {
  ARMS, ARM_LABELS, BACKUP_FORMAT, BACKUP_VERSION, PAIRS,
  calculateRecords, completedSets, copyPlan, createPlan, makeSet, newId,
  nextPending, pairFor, repeatFromHistory, validateBackup,
} from './workout-model.js';
import { finishWorkout, mergeBackup, put, readAll, remove, setMeta, setRestUntil, setDraftReps, startWorkout, cancelWorkout, deleteWorkout, restoreImportedWorkout } from './workout-db.js';
import { initProgressionUI } from './progression-ui.js';
import { clone, stopControlAttempts } from './progression-model.js';
import { validateProgressions } from './progression-backup.js';
import { showSection } from './navigation.js';
import { initBlockUI } from './block-ui.js';
import { initCycleUI } from './cycle-ui.js';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const formatDate = (date) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(date));
const pairValue = (set) => `${set.i}-${set.j}`;
const pairOptions = (selected) => PAIRS.map((pair) =>
  `<option value="${pair.i}-${pair.j}" ${selected === `${pair.i}-${pair.j}` ? 'selected' : ''}>${pair.kg.toFixed(1)} кг · ${pair.i} / ${pair.j}</option>`).join('');
const doneCount = (sets) => ARMS.reduce((sum, arm) => sum + sets[arm].filter((set) => set.status === 'done').length, 0);
const totalCount = (sets) => ARMS.reduce((sum, arm) => sum + sets[arm].length, 0);
const decimalWeight = value => Number(value).toLocaleString('ru-RU', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const pluralRu = new Intl.PluralRules('ru-RU');
const repetitionWord = value => ({one: 'повторение', few: 'повторения', many: 'повторений', other: 'повторения'})[pluralRu.select(value)];
const setWord = value => ({one: 'подход', few: 'подхода', many: 'подходов', other: 'подхода'})[pluralRu.select(value)];
const restTime = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const springDescription = set => `Пружина I — положение ${set.i}; пружина II — положение ${set.j}`;
const springPair = set => `<span class="spring-pair" role="img" aria-label="${springDescription(set)}"><span><small>I</small><strong>${set.i}</strong></span><span class="spring-divider" aria-hidden="true">/</span><span><small>II</small><strong>${set.j}</strong></span></span>`;
const stateLabels = {current: 'Текущий подход', done: 'Подход выполнен', skipped: 'Подход пропущен', pending: 'Предстоящий подход'};
function setMarker(status) {
  const shapes = {
    current: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/>',
    done: '<path d="m3 8 3.2 3.2L13 4.5"/>',
    skipped: '<path d="M3 8h10"/>',
    pending: '<circle cx="8" cy="8" r="3.25"/>',
  };
  return `<svg viewBox="0 0 16 16" aria-hidden="true">${shapes[status]}</svg>`;
}
const clockIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.5V8l2 1.5"/></svg>';

export async function initTrainingUI() {
  const sectionCalc = $('sectionCalc');
  const sectionTraining = $('sectionTraining');
  let state;
  try {
    state = await readAll();
  } catch (error) {
    $('sectionCycleButton').addEventListener('click',()=>{
      showSection('Cycle');
      $('cycleRoot').innerHTML='<div class="training-panel"><h1>Цикл недоступен</h1><p>Разрешите хранение данных для этого сайта и перезапустите приложение.</p></div>';
    });
    $('sectionBlockButton').addEventListener('click',()=>{
      showSection('Block');
      $('blockRoot').innerHTML='<div class="training-panel"><h1>План блока недоступен</h1><p>Разрешите хранение данных для этого сайта и перезапустите приложение.</p></div>';
    });
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
  let observedRestUntil = null;
  let restCollapsed = false;
  let restSave = Promise.resolve();
  let sessionFieldSave = Promise.resolve();
  let sessionOpenedFor = null;
  let editedSetId = null;
  let toastTimeout;
  let historyFilter = 'all';
  let saving = false;
  let finishPromptedFor = null;
  let progression;
  let blockPlanner;
  let endlessCycle;
  const reload = async () => { state = await readAll(); render(); };
  progression = initProgressionUI({getState:()=>state,reload,
    resume(){switchSection(true);},
    history(id){historyFilter=id;switchSection(true);view='home';render();$('historyFilter').scrollIntoView();},
    async start(program,slot){
      if(state.active){switchSection(true);return;}
      if(!slot)throw new Error('Нет следующего занятия.');
      await startSession({title:`${program.name.slice(0,70)} · неделя ${slot.week}`,restSec:0,sets:slot.plan,sourceTemplateId:null,
        progressionId:program.id,plannedSessionId:slot.id,slotRevision:slot.revision,
        progressionContext:{name:program.name,week:slot.week,arms:clone(slot.arms)}});
      showSection('Training');
    }});
  blockPlanner = initBlockUI({getState:()=>state,reload,async start(options){
    if(state.active){switchSection(true);return;}
    await startSession(options);showSection('Training');
  }});
  endlessCycle = initCycleUI({getState:()=>state,reload,resume(){switchSection(true);},async start(options){
    if(state.active){switchSection(true);return;}
    await startSession(options);showSection('Training');
  }});

  function message(text, error = false) {
    const box = $('trainingMessage');
    box.textContent = text;
    box.classList.toggle('error', error);
    box.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => box.classList.add('hidden'), 5500);
  }

  function switchSection(training) {
    showSection(training?'Training':'Calc');
    sectionCalc.classList.toggle('hidden', training);
    sectionTraining.classList.toggle('hidden', !training);
    document.body.classList.toggle('training-active', training);
    $('sectionCalcButton').classList.toggle('active', !training);
    $('sectionTrainingButton').classList.toggle('active', training);
    $('sectionCalcButton').setAttribute('aria-pressed', String(!training));
    $('sectionTrainingButton').setAttribute('aria-pressed', String(training));
    if (training) {
      view = state.active ? 'session' : 'home';
      finishPromptedFor = null;
      render();
    }
  }

  function render() {
    $('trainingHome').classList.toggle('hidden', view !== 'home');
    $('trainingSession').classList.toggle('hidden', view !== 'session' || !state.active);
    syncSessionShell();
    renderHome();
    if (state.active) renderSession();
    renderRest();
    promptFinishSession();
  }

  function renderHome() {
    progression?.render();
    blockPlanner?.refresh(state.blockWorkspace,state.workouts);
    endlessCycle?.refresh();
    const resume = $('resumeCard');
    const waiting=[...state.pendingImports,...state.progressions.filter(p=>p.suspendedWorkout).map(p=>p.suspendedWorkout)];
    resume.classList.toggle('hidden', !state.active&&!waiting.length);
    if (state.active) {
      resume.innerHTML = `<div><strong>Тренировка продолжается</strong><small>${esc(state.active.title)} · ${doneCount(state.active.sets)} из ${totalCount(state.active.sets)} подходов</small></div><button class="button" type="button" data-action="resume">Продолжить</button>`;
    }
    else resume.innerHTML='';
    if(waiting.length)resume.innerHTML+=waiting.map(w=>`<div><strong>Сохранённое импортированное занятие</strong><small>${esc(w.title)}</small><button class="button" type="button" data-action="restore-import" data-id="${esc(w.id)}">Продолжить после текущего</button></div>`).join('');
    $('templateCount').textContent = state.templates.length;
    $('templateList').innerHTML = state.templates.length
      ? [...state.templates].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((template) => `
        <div class="training-item"><div class="training-item__main"><strong>${esc(template.name)}</strong>
          <small>Правая ${template.sets.right.length} · левая ${template.sets.left.length} · отдых ${template.restSec} с</small></div>
          <div class="training-item__actions"><button class="button button--primary" data-action="start-template" data-id="${esc(template.id)}" type="button">Начать</button>
          <button class="button" data-action="edit-template" data-id="${esc(template.id)}" type="button">Изменить</button>
          <button class="button button--danger" data-action="delete-template" data-id="${esc(template.id)}" type="button">Удалить</button></div></div>`).join('')
      : '<div class="empty-state">Пока нет шаблонов. Создай первый план для правой и левой руки.</div>';

    $('historyFilter').innerHTML = '<option value="all">Все тренировки</option><option value="standalone">Самостоятельные</option>'+state.progressions.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    $('historyFilter').value=historyFilter;
    const history = [...state.workouts].filter(w=>historyFilter==='all'||(historyFilter==='standalone'?!w.progressionId:w.progressionId===historyFilter)).sort((a, b) => b.endedAt.localeCompare(a.endedAt));
    $('historyCount').textContent = history.length;
    $('historyList').innerHTML = history.length
      ? history.slice(0, historyLimit).map((workout) => `
        <div class="training-item"><div class="training-item__main"><strong>${esc(workout.title)}</strong>
          <small>${formatDate(workout.endedAt)} · ${workout.partial ? 'частично · ' : ''}правая ${workout.sets.right.length}, левая ${workout.sets.left.length}</small>
          ${workout.progressionContext?`<small>${esc(workout.progressionContext.name)} · неделя ${workout.progressionContext.week}</small>`:''}
          <details class="history-details"><summary>План и факт</summary>${ARMS.map((arm) => `<div><b>${ARM_LABELS[arm]}</b><p>План: ${workout.initialPlan[arm].map(s=>`${s.kg} кг × ${s.reps}`).join(' · ')||'—'}</p><p>Факт: ${workout.sets[arm].map((set) => `${set.kg.toFixed(1)} кг × ${set.status==='skipped'?'пропуск':set.actualReps}`).join(' · ') || '—'}</p>${workout.feedback?.[arm]?`<small>Техника: ${workout.feedback[arm].technique===true?'подтверждена':workout.feedback[arm].technique===false?'нарушена':'не оценена'} · боль: ${workout.feedback[arm].pain===true?'да':workout.feedback[arm].pain===false?'нет':'не оценена'}</small>`:''}</div>`).join('')}</details></div>
          <div class="training-item__actions"><button class="button" data-action="repeat-history" data-id="${esc(workout.id)}" type="button">Повторить</button>
          ${workout.progressionId?`<button class="button" data-action="open-progression" data-id="${esc(workout.progressionId)}" type="button">Открыть прогрессию</button>`:''}
          <button class="button button--danger" data-action="delete-history" data-id="${esc(workout.id)}" type="button">Удалить</button></div></div>`).join('')
      : '<div class="empty-state">Завершённые тренировки появятся здесь.</div>';
    $('showMoreHistory').classList.toggle('hidden', history.length <= historyLimit);
    renderRecords();
  }

  function renderRecords() {
    const { best, events } = calculateRecords(state.workouts, state.manualRecords);
    $('recordsOverview').innerHTML = '<div>Повторы</div><div>Правая</div><div>Левая</div>'
      + [...new Set([...Array.from({length:10},(_,i)=>i+1),...events.map(e=>e.reps)])].sort((a,b)=>a-b).map(n => {
        return `<div>${n}ПМ</div><div>${best.right[n] ? `${best.right[n].kg.toFixed(1)} кг` : '—'}</div><div>${best.left[n] ? `${best.left[n].kg.toFixed(1)} кг` : '—'}</div>`;
      }).join('');
    $('recordHistory').classList.toggle('hidden', !recordHistoryOpen);
    const timeline = events.length ? events.map((event) => `
      <div class="record-event"><span><b>${ARM_LABELS[event.arm]}, ${event.reps}ПМ</b> · ${event.kg.toFixed(1)} кг <small>(${event.i} / ${event.j})</small></span>
      <span>${formatDate(event.at)}</span></div>`).join('')
      : '<div class="empty-state">Рекордов пока нет.</div>';
    const manual = state.manualRecords.length ? `<h3>Ручные записи</h3>${[...state.manualRecords]
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).map((record) => `
      <div class="record-event"><span>${ARM_LABELS[record.arm]} · ${record.reps ?? 1}ПМ · ${record.kg.toFixed(1)} кг · ${formatDate(record.recordedAt)}</span>
      <button class="button button--danger" type="button" data-action="delete-manual" data-id="${esc(record.id)}" aria-label="Удалить ручную запись">Удалить</button></div>`).join('')}` : '';
    $('recordHistory').innerHTML = timeline + manual;
  }

  function syncSessionShell() {
    const visible = !!state.active && view === 'session' && !sectionTraining.classList.contains('hidden');
    const entering = visible && !document.body.classList.contains('workout-active');
    document.body.classList.toggle('workout-active', visible);
    if (visible && sessionOpenedFor !== state.active.id) {
      sessionOpenedFor = state.active.id;
      $('sessionPlan').open = true;
    }
    if (entering) window.scrollTo({top: 0, behavior: 'instant'});
    if (!visible) {
      for (const id of ['sessionActionsDialog', 'sessionSetDialog', 'finishSessionDialog']) {
        if ($(id).open) $(id).close();
      }
    }
  }

  function renderSession() {
    syncSessionShell();
    const active = state.active;
    if (!active) return;
    const list = ARMS.flatMap(arm => active.sets[arm]);
    const total = list.length;
    const current = nextPending(active.sets);
    const position = current ? list.findIndex(set => set.id === current.set.id) : total;
    const processed = list.filter(set => set.status !== 'pending').length;
    if (current) finishPromptedFor = null;
    $('sessionTitle').textContent = active.cycleId ? `Неделя ${active.cycleWeek} · ${active.cycleDay === 1 ? 'Сила' : 'Объём'}`
      : active.progressionContext ? `Неделя ${active.progressionContext.week}`
      : active.blockContext?.name || active.title;
    $('sessionTitle').title = active.title;
    $('backToTraining').textContent = active.cycleId ? '‹ К циклу' : active.blockId ? '‹ К плану' : active.progressionId ? '‹ К программе' : '‹ К списку';
    $('sessionContext').classList.remove('hidden');
    $('sessionContext').innerHTML = `<strong>${esc(active.title)}</strong>`;
    if (active.progressionContext) $('sessionContext').innerHTML += `<p>Неделя ${active.progressionContext.week}</p><button id="openSessionProgression" class="button" type="button">Открыть прогрессию</button>`;
    else if (active.blockContext) $('sessionContext').innerHTML += `<p>План: ${esc(active.blockContext.plannedDate)}</p>`;
    else if (active.cycleContext) $('sessionContext').innerHTML += `<p>${esc(active.cycleContext.label)}</p>`;
    $('sessionProgress').textContent = current ? `Подход ${position + 1} из ${total}` : `Пройдено ${total} из ${total}`;
    $('sessionProgressBar').max = total || 1;
    $('sessionProgressBar').value = processed;
    $('sessionProgressBar').setAttribute('aria-valuetext', `Пройдено ${processed} из ${total}; выполнено ${doneCount(active.sets)}`);
    $('sessionPlanCount').textContent = `${total} ${setWord(total)}`;
    $('toggleSound').textContent = `Звук: ${state.settings.sound ? 'вкл' : 'выкл'}`;
    $('toggleSound').setAttribute('aria-pressed', String(state.settings.sound));
    if (current) {
      const pair = pairFor(current.set.i, current.set.j);
      $('sessionHero').innerHTML = `<div class="session-hero__current"><h1>${ARM_LABELS[current.arm]} рука</h1>
        <div class="session-hero__weight"><span class="session-weight-number">${decimalWeight(pair.kg)}</span><span class="session-weight-unit">кг</span></div>
        <p class="session-target">По плану — ${current.set.reps} ${repetitionWord(current.set.reps)}</p>
        <div class="session-springs session-hero__springs"><span class="session-springs-label">Пружины</span>${springPair(pair)}</div>
        <div class="session-entry"><label class="session-entry-label" for="sessionActualReps">Выполнено повторений</label>
        <div class="session-stepper"><button id="decreaseSessionReps" type="button" aria-label="Уменьшить число повторений на один">−</button><input id="sessionActualReps" type="number" min="0" max="999" step="1" inputmode="numeric" autocomplete="off" value="${esc(current.set.draftReps ?? current.set.reps)}" aria-label="Фактические повторы" /><button id="increaseSessionReps" type="button" aria-label="Увеличить число повторений на один">+</button></div></div>
        ${current.set.capped ? '<p class="session-equipment-note">Предел веса: добавлены повторения. Результат учитывается на фактически выполненное число повторений.</p>' : ''}</div>`;
    } else $('sessionHero').innerHTML = '<h1>Подходы закончились</h1><p class="session-target">Можно проверить план и завершить тренировку.</p>';
    $('completeSet').textContent = current ? 'Подход выполнен' : 'Завершить тренировку';
    $('completeSet').disabled = saving || !!(active.restUntil && active.restUntil > Date.now());
    $('openSessionActions').disabled = saving;
    $('backToTraining').disabled = saving;
    $('skipSet').disabled = saving || !current;
    $('editCurrentSet').disabled = saving || !current;
    $('undoSet').disabled = saving || !list.some(set => set.status !== 'pending' && !set.autoStopped);
    $('finishTraining').disabled = saving || !processed;
    $('sessionQueue').innerHTML = ARMS.filter(arm => active.sets[arm].length).map(arm => `<section class="session-plan-arm"><h3>${ARM_LABELS[arm]} рука</h3><ol class="session-plan-list">${active.sets[arm].map(set => {
      const status = current?.set.id === set.id ? 'current' : set.status;
      const differs = status === 'done' && set.actualReps !== set.reps;
      const note = status === 'current' ? 'Сейчас' : differs ? `Факт ${set.actualReps}` : '';
      const rest = active.restOverride ?? set.restSec ?? active.restSec;
      const index = list.indexOf(set) + 1;
      const actual = status === 'done' ? ` Выполнено ${set.actualReps} повторений, запланировано ${set.reps}.` : '';
      return `<li class="session-plan-row${status === 'current' ? ' is-current' : ''}" data-state="${status}"${status === 'current' ? ' aria-current="step"' : ''}><span class="session-set-state" aria-hidden="true">${setMarker(status)}</span><div class="session-plan-values"><span class="session-sr-only">Подход ${index}. ${stateLabels[status]}.${actual} </span><p class="session-plan-load">${decimalWeight(set.kg)} кг × ${set.reps}</p><p class="session-plan-springs"><span class="session-sr-only">${springDescription(set)}.</span><span aria-hidden="true">I <strong>${set.i}</strong></span><span aria-hidden="true">/</span><span aria-hidden="true">II <strong>${set.j}</strong></span></p></div><div class="session-plan-side"><span class="session-plan-rest" aria-label="Отдых после подхода: ${rest} секунд">${clockIcon}<span aria-hidden="true">${restTime(rest)}</span></span>${note ? `<span class="session-plan-note">${note}</span>` : ''}</div></li>`;
    }).join('')}</ol></section>`).join('');
    updateSessionStepper();
    renderRest();
  }

  function isPartialSession(active) {
    return ARMS.some(arm => active.initialPlan[arm].some(planned =>
      !active.sets[arm].some(actual => actual.plannedSetId === (planned.plannedSetId || planned.id) && actual.status === 'done')));
  }

  function promptFinishSession() {
    const active = state.active;
    if (!active || saving || view !== 'session' || sectionTraining.classList.contains('hidden')
      || nextPending(active.sets) || finishPromptedFor === active.id) return;
    if (!ARMS.some(arm => active.sets[arm].some(set => set.status !== 'pending'))) return;
    finishPromptedFor = active.id;
    $('finishSessionSummary').textContent = isPartialSession(active)
      ? `Выполнено ${doneCount(active.sets)} из ${totalCount(active.sets)} подходов. Тренировка будет сохранена частично. Завершить тренировку?`
      : 'Все подходы выполнены. Завершить и сохранить тренировку?';
    $('finishSessionError').textContent = '';
    if (!$('finishSessionDialog').open) $('finishSessionDialog').showModal();
  }

  function returnToSession() {
    if (saving) return;
    $('finishSessionDialog').close();
    $('sessionHero').focus({ preventScroll: true });
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
    } catch { /* Sound is optional on this device. */ }
    try {
      if (second <= 3) navigator.vibrate?.(second === 0 ? 240 : 55);
    } catch { /* Vibration is optional on this device. */ }
  }

  function renderRest({ silent = false } = {}) {
    const panel = $('restPanel');
    const dialog = $('restDialog');
    const active = state.active;
    if (!active || !active.restUntil) {
      observedRestUntil = null;
      panel.classList.add('hidden');
      $('restNext').textContent = '';
      $('restSprings').textContent = '';
      if (dialog.open) dialog.close();
      return;
    }
    const remaining = Math.max(0, Math.ceil((active.restUntil - Date.now()) / 1000));
    const observed = observedRestUntil === active.restUntil;
    if (remaining > 0) observedRestUntil = active.restUntil;
    // An expired timer restored on launch must not produce a late "go" signal.
    if (!silent && remaining <= 5 && (remaining > 0 || observed)) signal(remaining);
    if (remaining === 0) {
      active.restUntil = null;
      persistRest().catch(restError);
      $('completeSet').disabled = saving || !nextPending(active.sets);
      const wasOpen = dialog.open;
      renderRest();
      if (wasOpen && !document.hidden) $('completeSet').focus({ preventScroll: true });
      return;
    }
    const visible = view === 'session' && !sectionTraining.classList.contains('hidden');
    panel.classList.toggle('hidden', !visible || !restCollapsed);
    const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
    const seconds = String(remaining % 60).padStart(2, '0');
    document.querySelectorAll('[data-rest-time]').forEach(el => {
      const value = `${minutes}:${seconds}`;
      if (el.textContent !== value) el.textContent = value;
    });
    const next = nextPending(active.sets);
    $('restNext').textContent = next ? `${ARM_LABELS[next.arm]} рука · ${next.set.kg.toFixed(1)} кг × ${next.set.reps}` : '';
    $('restSprings').innerHTML = next ? `<span class="session-springs-label">Пружины</span>${springPair(next.set)}` : '';
    if (next) $('restSprings').setAttribute('aria-label', springDescription(next.set));
    else $('restSprings').removeAttribute('aria-label');
    if (visible && !restCollapsed && !dialog.open) dialog.showModal();
    else if ((!visible || restCollapsed) && dialog.open) dialog.close();
  }

  function persistRest() {
    const {id, restUntil} = state.active;
    // Serialize adjustments so rapid taps cannot persist an older deadline last.
    restSave = restSave.catch(() => {}).then(() => setRestUntil(id, restUntil));
    return restSave;
  }

  function restError(error) {
    if ($('restDialog').open) $('restError').textContent = 'Не удалось сохранить время отдыха.';
    else message('Не удалось сохранить время отдыха.', true);
    console.error(error);
  }

  async function restAction(event) {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!state.active?.restUntil || !action) return;
    if (action === 'collapse-rest' || action === 'expand-rest') {
      restCollapsed = action === 'collapse-rest';
      renderRest();
      if (restCollapsed) panelExpandFocus();
      return;
    }
    if (!['skip-rest', 'add-rest', 'subtract-rest'].includes(action)) return;
    const wasOpen = $('restDialog').open;
    const now = Date.now();
    if (state.active.restUntil <= now) { renderRest({ silent: true }); return; }
    state.active.restUntil = action === 'skip-rest' ? null : Math.max(now, state.active.restUntil + (action === 'add-rest' ? 30000 : -30000));
    if (state.active.restUntil === now) state.active.restUntil = null;
    lastSignal = '';
    $('restError').textContent = '';
    renderRest();
    $('completeSet').disabled = saving || !nextPending(state.active.sets) || !!state.active.restUntil;
    if (!state.active.restUntil && wasOpen) $('completeSet').focus({ preventScroll: true });
    await persistRest();
  }

  function panelExpandFocus() {
    $('restPanel').querySelector('button').focus();
  }

  function openEditor(purpose, source = null) {
    let sets; let name; let restSec;
    if (purpose === 'create') { sets = createPlan(); name = ''; restSec = 90; }
    if (purpose === 'edit') { sets = copyPlan(source.sets); name = source.name; restSec = source.restSec; }
    if (purpose === 'repeat') { sets = repeatFromHistory(source); name = `Повтор: ${source.title}`; restSec = source.restSec; }
    if (purpose === 'session') {
      sets = Object.fromEntries(ARMS.map((arm) => [arm, state.active.sets[arm]
        .filter((set) => set.status === 'pending').map((set) => ({ ...set }))]));
      name = state.active.title; restSec = state.active.restOverride ?? nextPending(state.active.sets)?.set.restSec ?? state.active.restSec;
    }
    if (!sets) { message('Невозможно повторить эту запись.', true); return; }
    const allowedArms = purpose==='session'?ARMS.filter(a=>state.active.initialPlan[a].length):purpose==='repeat'?ARMS.filter(a=>source.initialPlan[a].length):ARMS;
    editor = { purpose, source, sets, allowedArms };
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
    $('planArms').innerHTML = editor.allowedArms.map((arm) => {
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
    if (action === 'duplicate-set') list.splice(index + 1, 0, { ...list[index], id: newId(), plannedSetId: newId(), generatedBy: undefined });
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
      : editor.allowedArms.some((arm) => completed[arm].length + editor.sets[arm].length < 1) ? 'Нужен хотя бы один подход для каждой выбранной руки.'
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
      message(original ? 'Шаблон обновлён.' : 'Шаблон сохранён.');
    } else if (editor.purpose === 'repeat') {
      await startSession({ title: name, restSec, sets: editor.sets, sourceTemplateId: null });
    } else if (editor.purpose === 'session') {
      state.active.title = name;
      state.active.restSec = restSec;
      state.active.sets = Object.fromEntries(ARMS.map((arm) => [arm, [...state.active.sets[arm].filter(s=>s.status!=='pending'), ...editor.sets[arm]]]));
      state.active.restOverride = restSec;
      await setMeta('active', state.active);
      message('План занятия обновлён.');
    }
    editor = null;
    $('planDialog').close();
    render();
  }

  async function startSession({ title, restSec, sets, sourceTemplateId, ...context }) {
    if (state.active) { message('Сначала заверши или отмени текущую тренировку.', true); return; }
    const now = new Date().toISOString();
    const linked=context.progressionId||context.blockId||context.cycleId;
    const active = { id: newId(), title, sourceTemplateId, sourceType:context.progressionId?'progression':context.blockId?'block':context.cycleId?'cycle':'standalone',...context,startedAt: now, restSec,
      initialPlan: linked?clone(sets):copyPlan(sets), sets: linked?clone(sets):copyPlan(sets), restUntil: null };
    if(!linked)for(const arm of ARMS)active.sets[arm].forEach((s,i)=>{s.plannedSetId=active.initialPlan[arm][i].id;active.initialPlan[arm][i].plannedSetId=s.plannedSetId;});
    await startWorkout(active);
    state=await readAll();
    view = 'session';
    ensureAudio();
    render();
  }

  async function completeSet() {
    const active = state.active;
    if (!active || saving || (active.restUntil && active.restUntil > Date.now())) return;
    const current = nextPending(active.sets);
    if (!current) { finishPromptedFor = null; promptFinishSession(); return; }
    const actualReps = Number($('sessionActualReps').value);
    if ($('sessionActualReps').value==='' || !Number.isInteger(actualReps) || actualReps < 0 || actualReps > 999) {
      message('Укажи фактические повторы от 0 до 999.', true); return;
    }
    const previous = clone(active);
    saving = true;
    renderSession();
    try {
    await sessionFieldSave.catch(() => {});
    ensureAudio();
    current.set.status = 'done';
    current.set.actualReps = actualReps;
    current.set.completedAt = new Date().toISOString();
    delete current.set.quality;
    if(active.progressionId)stopControlAttempts(active,current.arm);
    const rest=active.restOverride??current.set.restSec??active.restSec;
    active.restUntil = nextPending(active.sets) && rest > 0 ? Date.now() + rest * 1000 : null;
    restCollapsed = false;
    $('restError').textContent = '';
    lastSignal = '';
    await restSave.catch(() => {});
    await setMeta('active', active);
    } catch (error) {
      state.active = previous;
      message('Не удалось сохранить подход. Попробуй ещё раз.', true);
      throw error;
    } finally { saving = false; renderSession(); }
    promptFinishSession();
  }

  async function skipSet() {
    const active = state.active;
    const current = active && nextPending(active.sets);
    if (!current || saving) return;
    const previous = clone(active);
    saving = true;
    renderSession();
    try {
      await sessionFieldSave.catch(() => {});
      current.set.status = 'skipped';
      current.set.completedAt = new Date().toISOString();
      active.restUntil = null;
      await restSave.catch(() => {});
      await setMeta('active', active);
    } catch (error) {
      state.active = previous;
      message('Не удалось сохранить пропуск. Попробуй ещё раз.', true);
      throw error;
    } finally { saving = false; renderSession(); }
    promptFinishSession();
  }

  async function undoSet() {
    const active = state.active;
    if (!active || saving) return;
    const list = [...active.sets.right, ...active.sets.left].filter((set) => set.status !== 'pending' && !set.autoStopped);
    const last = list.at(-1);
    if (!last) return;
    const previous = clone(active);
    saving = true;
    renderSession();
    try {
    await sessionFieldSave.catch(() => {});
    const arm=ARMS.find(a=>active.sets[a].includes(last));
    active.sets[arm].forEach(s=>{if(s.autoStopped){s.status='pending';delete s.autoStopped;}});
    last.status = 'pending';
    delete last.actualReps;
    delete last.completedAt;
    active.restUntil = null;
    await restSave.catch(() => {});
    await setMeta('active', active);
    } catch (error) {
      state.active = previous;
      message('Не удалось отменить подход. Попробуй ещё раз.', true);
      throw error;
    } finally { saving = false; renderSession(); }
  }

  async function finishSession() {
    const active = state.active;
    if (!active || !ARMS.some(a=>active.sets[a].some(s=>s.status!=='pending')) || saving) return;
    saving=true;
    const dialog = $('finishSessionDialog');
    $('confirmFinishSession').disabled = true;
    $('returnToSession').disabled = true;
    $('finishTraining').disabled = true;
    $('finishSessionError').textContent = '';
    dialog.setAttribute('aria-busy', 'true');
    try {
    const now = new Date().toISOString();
    const sets = Object.fromEntries(ARMS.map(a=>[a,active.sets[a].filter(s=>s.status!=='pending')]));
    const workout = { id: active.id, title: active.title, sourceTemplateId: active.sourceTemplateId,
      sourceType:active.sourceType,progressionId:active.progressionId||null,plannedSessionId:active.plannedSessionId||null,progressionContext:active.progressionContext,
      blockId:active.blockId||null,blockSessionId:active.blockSessionId||null,blockContext:active.blockContext,
      cycleId:active.cycleId||null,cycleWeek:active.cycleWeek,cycleDay:active.cycleDay,cycleRevision:active.cycleRevision,cycleContext:active.cycleContext,
      startedAt: active.startedAt, endedAt: now, restSec: active.restSec, initialPlan: active.initialPlan,
      sets, partial: isPartialSession(active) };
    await sessionFieldSave.catch(() => {});
    await restSave.catch(() => {});
    await finishWorkout(workout);
    state=await readAll();
    if (dialog.open) dialog.close();
    view = 'home';
    render();
    message(workout.partial ? 'Частичная тренировка сохранена.' : 'Тренировка сохранена.');
    const template = state.templates.find((item) => item.id === workout.sourceTemplateId);
    if (!workout.progressionId && template && sets.right.length && sets.left.length) {
      pendingTemplateUpdate = { template, workout };
      const describe = (rows, actual = false) => rows.map((set) =>
        `${pairFor(set.i, set.j).kg.toFixed(1)} кг × ${actual ? set.actualReps : set.reps}`).join(' · ');
      $('updateTemplateSummary').textContent = `«${template.name}»\nБыло — правая: ${describe(template.sets.right)}\nСтанет — правая: ${describe(sets.right, true)}\n\nБыло — левая: ${describe(template.sets.left)}\nСтанет — левая: ${describe(sets.left, true)}\n\nОтдых: ${template.restSec} → ${workout.restSec} с`;
      $('updateTemplateDialog').showModal();
    }
    } catch (error) {
      if (dialog.open) $('finishSessionError').textContent = 'Не удалось сохранить тренировку. Попробуй ещё раз.';
      else message('Не удалось сохранить тренировку. Попробуй ещё раз.', true);
      console.error(error);
    } finally {
      saving = false;
      $('confirmFinishSession').disabled = false;
      $('returnToSession').disabled = false;
      dialog.removeAttribute('aria-busy');
      if (state.active) renderSession();
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
    message('Шаблон обновлён.');
  }

  async function homeAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if(action==='open-progression'){progression.open(id);return;}
    if(action==='restore-import'){await restoreImportedWorkout(id);state=await readAll();view='session';render();return;}
    if (action === 'resume') { view = 'session'; finishPromptedFor = null; render(); return; }
    const template = state.templates.find((item) => item.id === id);
    const workout = state.workouts.find((item) => item.id === id);
    if (action === 'start-template' && template) await startSession({ title: template.name, restSec: template.restSec, sets: template.sets, sourceTemplateId: template.id });
    if (action === 'edit-template' && template) openEditor('edit', template);
    if (action === 'repeat-history' && workout) openEditor('repeat', workout);
    if (action === 'delete-template' && template && confirm(`Удалить шаблон «${template.name}»? История останется.`)) {
      await remove('templates', id); state.templates = state.templates.filter((item) => item.id !== id); renderHome();
    }
    if (action === 'delete-history' && workout && confirm(workout.progressionId?'Удалить тренировку? Зачёт программы и рекорды будут пересчитаны; выполненное будущее останется.':'Удалить тренировку из истории? Рекорды будут пересчитаны.')) {
      await deleteWorkout(id); await reload();
    }
    if (action === 'delete-manual' && confirm('Удалить запись ПМ?')) {
      await remove('manualRecords', id); state.manualRecords = state.manualRecords.filter((item) => item.id !== id); renderHome();
    }
  }

  function actualRepsValue() {
    const input = $('sessionActualReps');
    const value = input?.value;
    const number = Number(value);
    return value !== undefined && value !== '' && Number.isInteger(number) && number >= 0 && number <= 999 ? number : null;
  }

  function updateSessionStepper() {
    const current = state.active && nextPending(state.active.sets);
    const value = actualRepsValue();
    if ($('decreaseSessionReps')) $('decreaseSessionReps').disabled = saving || !current || value === 0;
    if ($('increaseSessionReps')) $('increaseSessionReps').disabled = saving || !current || value === 999;
    if ($('sessionActualReps')) $('sessionActualReps').disabled = saving;
  }

  async function sessionFieldChanged(event) {
    const current = state.active && nextPending(state.active.sets);
    if (!current || saving || event.target.id !== 'sessionActualReps') return;
    const value = actualRepsValue();
    if (value === null) delete current.set.draftReps;
    else current.set.draftReps = value;
    updateSessionStepper();
    const id = state.active.id;
    const setId = current.set.id;
    sessionFieldSave = sessionFieldSave.catch(() => {}).then(() => setDraftReps(id, setId, value));
    await sessionFieldSave;
  }

  function stepSessionReps(delta) {
    if (saving || !$('sessionActualReps')) return;
    $('sessionActualReps').value = Math.min(999, Math.max(0, (actualRepsValue() ?? 0) + delta));
    $('sessionActualReps').dispatchEvent(new Event('input', {bubbles: true}));
  }

  function closeSessionActions() {
    if ($('sessionActionsDialog').open) $('sessionActionsDialog').close();
  }

  function openCurrentSet() {
    const active = state.active;
    const current = active && nextPending(active.sets);
    if (!current || saving) return;
    closeSessionActions();
    editedSetId = `${active.id}:${current.set.id}`;
    $('sessionWeight').innerHTML = pairOptions(pairValue(current.set));
    $('sessionPlannedReps').value = current.set.reps;
    $('sessionSetError').textContent = '';
    $('sessionSetDialog').showModal();
  }

  async function saveCurrentSet(event) {
    event.preventDefault();
    const active = state.active;
    const current = active && nextPending(active.sets);
    if (!current || saving) return;
    if (editedSetId !== `${active.id}:${current.set.id}`) {
      $('sessionSetError').textContent = 'Текущий подход изменился. Открой его заново.';
      return;
    }
    const [i, j] = $('sessionWeight').value.split('-').map(Number);
    const pair = pairFor(i, j);
    const reps = Number($('sessionPlannedReps').value);
    if (!pair || !Number.isInteger(reps) || reps < 1 || reps > 999) {
      $('sessionSetError').textContent = 'Укажи вес и целое число повторений от 1 до 999.';
      return;
    }
    const previous = clone(active);
    saving = true;
    $('saveCurrentSet').disabled = true;
    $('closeSessionSet').disabled = true;
    $('sessionSetError').textContent = '';
    try {
      await sessionFieldSave.catch(() => {});
      const actual = current.set.draftReps;
      const nextActual = actual === undefined || actual === current.set.reps ? reps : actual;
      Object.assign(current.set, pair, {reps, draftReps: nextActual});
      await restSave.catch(() => {});
      await setMeta('active', active);
      $('sessionSetDialog').close();
      $('sessionHero').focus({preventScroll: true});
    } catch (error) {
      state.active = previous;
      $('sessionSetError').textContent = 'Не удалось сохранить изменения. Попробуй ещё раз.';
      console.error(error);
    } finally {
      saving = false;
      $('saveCurrentSet').disabled = false;
      $('closeSessionSet').disabled = false;
      renderSession();
    }
  }

  function leaveSession() {
    if (saving) return;
    const active = state.active;
    view = 'home';
    render();
    if (active?.cycleId) { showSection('Cycle'); endlessCycle.refresh(); }
    else if (active?.blockId) { showSection('Block'); blockPlanner.refresh(state.blockWorkspace, state.workouts); }
    else if (active?.progressionId) progression.open(active.progressionId);
    else showSection('Training');
    window.scrollTo({top: 0, behavior: 'instant'});
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
      const data = validateProgressions(validateBackup(JSON.parse(await file.text())));
      const choices={};
      for(const p of data.progressions){const old=state.progressions.find(x=>x.id===p.id);if(old&&JSON.stringify(old)!==JSON.stringify(p))choices[p.id]=confirm(`Программа «${p.name}» отличается от локальной. ОК — импортировать отдельной копией; Отмена — сохранить локальную целиком.`)?'copy':'keep';}
      if(data.active&&state.active){alert('Локальная тренировка останется активной. Входящее занятие сохранится для последующего продолжения.');choices.active='keep';}
      if(data.progressions.some(p=>p.status==='active')&&state.progressions.some(p=>p.status==='active'))alert('Локальная программа останется активной. Импортируемые программы будут приостановлены.');
      const counts = await mergeBackup(data,choices);
      state = await readAll();
      view = state.active ? 'session' : 'home';
      render();
      message(`Импорт: ${counts.progressions} программ, ${counts.templates} шаблонов, ${counts.workouts} тренировок, ${counts.manualRecords} записей ПМ${counts.active ? ', активная тренировка' : ''}.`);
    } catch (error) {
      message(`Не удалось импортировать: ${error.message}`, true);
    } finally { $('importTraining').value = ''; }
  }

  $('sectionCalcButton').addEventListener('click', () => switchSection(false));
  $('sectionTrainingButton').addEventListener('click', () => switchSection(true));
  $('createTemplate').addEventListener('click', () => openEditor('create'));
  $('trainingHome').addEventListener('click', (event) => homeAction(event).catch(console.error));
  $('restPanel').addEventListener('click', event => restAction(event).catch(restError));
  $('restDialog').addEventListener('click', event => restAction(event).catch(restError));
  $('restDialog').addEventListener('cancel', event => { event.preventDefault(); restCollapsed = true; renderRest(); panelExpandFocus(); });
  $('restDialog').addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const buttons = [...$('restDialog').querySelectorAll('button:not([disabled])')];
    const target = event.shiftKey && document.activeElement === buttons[0] ? buttons.at(-1)
      : !event.shiftKey && document.activeElement === buttons.at(-1) ? buttons[0] : null;
    if (target) { event.preventDefault(); target.focus(); }
  });
  document.addEventListener('hvat-section-change', () => { syncSessionShell(); renderRest(); });
  $('backToTraining').addEventListener('click', leaveSession);
  $('completeSet').addEventListener('click', () => completeSet().catch(console.error));
  $('historyFilter').addEventListener('change',e=>{historyFilter=e.target.value;renderHome();});
  $('sessionContext').addEventListener('click', e => {
    if (e.target.id === 'openSessionProgression') { closeSessionActions(); leaveSession(); }
  });
  $('openSessionActions').addEventListener('click', () => { if (state.active && !saving) $('sessionActionsDialog').showModal(); });
  $('closeSessionActions').addEventListener('click', closeSessionActions);
  $('skipSet').addEventListener('click', () => { closeSessionActions(); skipSet().catch(console.error); });
  $('sessionHero').addEventListener('input', event => {
    if (event.target.id === 'sessionActualReps') sessionFieldChanged(event).catch(error => {
      message('Не удалось сохранить повторения. Попробуй ещё раз.', true);
      console.error(error);
    });
  });
  $('sessionHero').addEventListener('click', event => {
    if (event.target.closest('#decreaseSessionReps')) stepSessionReps(-1);
    if (event.target.closest('#increaseSessionReps')) stepSessionReps(1);
  });
  $('sessionHero').addEventListener('keydown', event => {
    if (event.target.id === 'sessionActualReps' && event.key === 'Enter') {
      event.preventDefault(); completeSet().catch(console.error);
    }
  });
  $('undoSet').addEventListener('click', () => { closeSessionActions(); undoSet().catch(console.error); });
  $('editCurrentSet').addEventListener('click', openCurrentSet);
  $('sessionSetForm').addEventListener('submit', event => saveCurrentSet(event).catch(console.error));
  $('closeSessionSet').addEventListener('click', () => { if (!saving) $('sessionSetDialog').close(); });
  $('editSessionPlan').addEventListener('click', () => { closeSessionActions(); openEditor('session'); });
  $('showSessionPlan').addEventListener('click', () => {
    closeSessionActions();
    $('sessionPlan').open = true;
    $('sessionPlan').querySelector('summary').focus({preventScroll: true});
    $('sessionPlan').scrollIntoView({block: 'start'});
  });
  for (const id of ['sessionActionsDialog', 'sessionSetDialog']) {
    $(id).addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    $(id).addEventListener('close', () => {
      if (document.body.classList.contains('workout-active') && !document.querySelector('dialog[open]')) {
        (id === 'sessionSetDialog' ? $('sessionHero') : $('openSessionActions')).focus({preventScroll: true});
      }
    });
    $(id).addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...$(id).querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled])')].filter(el => el.getClientRects().length);
      const target = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1)
        : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : null;
      if (target) { event.preventDefault(); target.focus(); }
    });
  }
  $('finishTraining').addEventListener('click', () => { closeSessionActions(); finishSession().catch(console.error); });
  $('confirmFinishSession').addEventListener('click', () => finishSession().catch(console.error));
  $('returnToSession').addEventListener('click', returnToSession);
  $('finishSessionDialog').addEventListener('cancel', event => {
    event.preventDefault();
    returnToSession();
  });
  $('finishSessionDialog').addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const buttons = [...$('finishSessionDialog').querySelectorAll('button:not([disabled])')];
    const target = event.shiftKey && document.activeElement === buttons[0] ? buttons.at(-1)
      : !event.shiftKey && document.activeElement === buttons.at(-1) ? buttons[0] : null;
    if (target) { event.preventDefault(); target.focus(); }
  });
  $('cancelTraining').addEventListener('click', async () => {
    if (!state.active || saving) return;
    closeSessionActions();
    if (confirm('Отменить тренировку? Все выполненные подходы этого занятия будут удалены.')) {
      await sessionFieldSave.catch(() => {});
      await restSave.catch(() => {});
      await cancelWorkout(state.active.id); state=await readAll(); view = 'home'; render(); message('Тренировка отменена.');
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
  $('manualReps').innerHTML = Array.from({length:10},(_,i)=>`<option value="${i+1}">${i+1}ПМ</option>`).join('');
  $('addManualRecord').addEventListener('click', () => {
    const today = new Date();
    $('manualDate').value = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    $('manualRecordError').textContent = '';
    $('manualRecordDialog').showModal();
  });
  $('closeManualRecord').addEventListener('click', () => $('manualRecordDialog').close());
  $('cancelManualRecord').addEventListener('click', () => $('manualRecordDialog').close());
  $('manualRecordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.target.querySelector('button[type=submit]');
    if (submit.disabled) return;
    const [i, j] = $('manualWeight').value.split('-').map(Number);
    const pair = pairFor(i, j);
    const date = $('manualDate').value;
    const reps = Number($('manualReps').value);
    if (!pair || !date || !Number.isInteger(reps) || reps < 1 || reps > 10 || !ARMS.includes($('manualArm').value)) return;
    submit.disabled = true;
    try {
    const record = { id: newId(), arm: $('manualArm').value, reps, i, j, kg: pair.kg,
      recordedAt: new Date(`${date}T12:00:00`).toISOString() };
    await put('manualRecords', record);
    state.manualRecords.push(record);
    $('manualRecordDialog').close();
    renderRecords();
    message(`${reps}ПМ сохранён.`);
    } catch(error) {
      $('manualRecordError').textContent = 'Не удалось сохранить ПМ. Попробуй ещё раз.';
      console.error(error);
    } finally { submit.disabled = false; }
  });
  $('exportTraining').addEventListener('click', () => exportData().catch((error) => message(error.message, true)));
  $('importTrainingButton').addEventListener('click', () => $('importTraining').click());
  $('importTraining').addEventListener('change', (event) => importData(event.target.files[0]));

  const dockObserver = new ResizeObserver(entries => {
    const height = entries[0].target.getBoundingClientRect().height;
    if (height > 0) document.documentElement.style.setProperty('--session-dock-height', `${Math.ceil(height)}px`);
  });
  dockObserver.observe(document.querySelector('.session-dock'));
  render();
  setInterval(() => { if (state.active?.restUntil) renderRest(); }, 250);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.active) renderRest({ silent: true });
  });
  navigator.storage?.persist?.().catch(() => {});
}
