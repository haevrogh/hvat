import { ARMS, calculateRecords } from './workout-model.js';
import { createProgression, defaultArm, validateConfig, allocatePeriods, clone, currentSlot, skipSlot, pairKey, keyPair, addDays, localToday, validDate } from './progression-model.js';
import { saveProgression } from './workout-db.js';
import { esc, button, armForm, programView, planView, displayDate } from './progression-view.js';
import { showSection } from './navigation.js';

export function initProgressionUI(bridge) {
  const root = document.getElementById('progressionRoot'), dialog = document.getElementById('progressionDialog');
  let selected = null, wizard = null, busy = false;
  const state = () => bridge.getState();
  const program = () => state().progressions.find(p => p.id === selected) || state().progressions.find(p => p.status === 'active') || state().progressions[0];
  function error(e) { document.getElementById('progressionMessage').textContent = e.message || String(e); }
  async function persist(p) {
    await saveProgression(p, state().progressions.find(x => x.id === p.id)?.revision);
    selected = p.id; await bridge.reload(); render();
  }
  function render() {
    const p = program(); if (p) selected = p.id;
    root.innerHTML = p ? programView(p, state().active, state().progressions, state().workouts)
      : `<div class="training-heading"><h1>Прогрессия</h1></div><section class="training-panel"><h2>Подготовка к выбранной дате</h2><p>Выносливость → сила → быстрота → пик силы.</p><p>От 4 до 52 недель, три тренировки в неделю. Нагрузки рассчитываются отдельно для каждой руки.</p>${button('create', 'Создать программу', '', true)}</section>`;
    const next = state().progressions.find(x => x.status === 'active'), card = document.getElementById('nextProgression');
    card.classList.toggle('hidden', !next);
    if (next) card.innerHTML = `<div><strong>${esc(next.name)}</strong><small>Пик ${displayDate(next.config.targetDate)} · ${currentSlot(next) ? `неделя ${currentSlot(next).week}` : 'период завершён'}</small></div>${button('open', 'Открыть прогрессию', '', true)}`;
  }
  function startWizard() {
    wizard = { step: 0, settings: { name: 'Моя подготовка', weeks: 12, targetDate: addDays(localToday(), 83), arms: { right: defaultArm(), left: defaultArm() } } };
    const best = calculateRecords(state().workouts, state().manualRecords).best;
    for (const a of ARMS) if (best[a][1]) Object.assign(wizard.settings.arms[a], { base: best[a][1].kg, pair: keyPair(best[a][1]), recordAt: best[a][1].at });
    renderWizard(); dialog.showModal();
  }
  function scheduleForm(s) {
    return `<h2>Дата и длительность</h2><label class="field">Название<input name="name" value="${esc(s.name)}" maxlength="100" required></label>
      <label class="field">Дата выхода на пик<input name="targetDate" type="date" value="${s.targetDate}" required></label>
      <label class="field">Длительность, недель<input name="weeks" type="number" min="4" max="52" step="1" value="${s.weeks}" required></label>
      <div class="schedule-options">${[4, 12, 26, 52].map(n => button('weeks-preset', `${n} нед.`, `data-weeks="${n}" aria-pressed="${s.weeks === n}"`)).join('')}</div>
      <p id="scheduleStart" class="prog-note">${scheduleDescription(s)}</p><p>Три занятия в неделю, обычно через день. Последняя неделя заканчивается проверкой результата в выбранную дату.</p>`;
  }
  function scheduleDescription(s) {
    try { allocatePeriods(s.weeks); return `Начало: ${displayDate(addDays(s.targetDate, 1 - s.weeks * 7))}. ${s.weeks * 3} занятий.`; }
    catch { return 'Выбери дату и длительность от 4 до 52 недель.'; }
  }
  function renderWizard() {
    const s = wizard.settings, step = wizard.step;
    const content = step === 0 ? scheduleForm(s) : step === 1 ? `<h2>Исходные максимумы</h2><p>Укажи актуальное полное закрытие на один повтор для каждой руки.</p>${ARMS.map(a => armForm(s.arms[a], a)).join('')}`
      : `<h2>План тренировок</h2><p>${s.weeks * 3} занятий · начало ${displayDate(wizard.preview.config.start)} · пик ${displayDate(s.targetDate)}</p><p>Все назначения рассчитаны заранее. Пропуски и недоборы сохраняются в журнале и не сдвигают план.</p>${planView(wizard.preview)}`;
    dialog.innerHTML = `<form id="progressionForm"><div class="dialog-heading"><p class="eyebrow">${step + 1} / 3 · НОВАЯ ПРОГРАММА</p>${button('close-dialog', 'Закрыть')}</div>${content}<p id="wizardError" class="form-error" role="alert"></p><div class="dialog-actions">${step ? button('wizard-back', 'Назад') : ''}${step === 2 ? button('save-draft', 'Сохранить черновик') : ''}<button class="button button--primary" type="submit">${step === 2 ? 'Запустить программу' : 'Далее'}</button></div></form>`;
    dialog.scrollTop = 0; const heading = dialog.querySelector('h2'); heading.tabIndex = -1; heading.focus();
  }
  function readStep(validate = true) {
    const f = new FormData(dialog.querySelector('form')), s = wizard.settings;
    if (wizard.step === 0) {
      s.name = String(f.get('name')).trim(); s.targetDate = f.get('targetDate'); s.weeks = Number(f.get('weeks'));
      if (validate) { allocatePeriods(s.weeks); if (!s.name) throw new Error('Укажи название.'); if (!validDate(s.targetDate)) throw new Error('Укажи корректную дату.'); }
    } else if (wizard.step === 1) for (const a of ARMS) {
      const c = s.arms[a]; c.inputMode = f.get(`${a}-mode`); c.pair = f.get(`${a}-pair`);
      c.base = c.inputMode === 'pair' ? pairKey(c.pair).kg : Number(f.get(`${a}-base`));
      c.baseConfirmed = f.has(`${a}-confirmed`); if (validate) validateConfig(c);
    }
  }
  async function saveWizard(draft = false) {
    const p = wizard.preview; p.status = draft ? 'draft' : 'active';
    await persist(p); dialog.close(); wizard = null; showSection('Progression');
  }
  async function action(target) {
    const { prog: action, id } = target.dataset;
    if (action === 'close-dialog') { dialog.close(); return; }
    if (action === 'create') { startWizard(); return; }
    if (action === 'open') { showSection('Progression'); render(); return; }
    if (action === 'resume') { bridge.resume(); return; }
    if (action === 'weeks-preset') { readStep(false); wizard.settings.weeks = Number(target.dataset.weeks); renderWizard(); return; }
    if (action === 'wizard-back') { readStep(false); wizard.step--; renderWizard(); return; }
    if (action === 'save-draft') { await saveWizard(true); return; }
    let p = clone(program()); if (!p) return;
    if (action === 'start') { await bridge.start(p, p.slots.find(s => s.id === id)); return; }
    if (action === 'history') { bridge.history(p.id); return; }
    if (action === 'current') {
      const el = document.getElementById(`slot-${currentSlot(p)?.id}`);
      if (el) { el.closest('details.prog-week').open = true; el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      return;
    }
    if (action === 'skip') p = skipSlot(p, id);
    else {
      if (action === 'activate') p.status = 'active';
      else if (action === 'pause') p.status = 'paused';
      else if (action === 'finish') { p.status = 'completed'; p.completionReason = 'user'; }
      else if (action === 'archive') p.status = 'archived';
      else return;
      p.revision++;
    }
    await persist(p);
  }
  function events(container) {
    container.addEventListener('click', async e => {
      const target = e.target.closest('[data-prog]'); if (!target || busy) return;
      busy = true; try { await action(target); } catch (e) { if (dialog.open) dialog.querySelector('#wizardError').textContent = e.message; else error(e); } finally { busy = false; }
    });
  }
  events(root); events(dialog); events(document.getElementById('nextProgression'));
  root.addEventListener('change', e => { if (e.target.id === 'programSelect') { selected = e.target.value; render(); } });
  dialog.addEventListener('change', e => {
    if (!wizard) return;
    if (e.target.dataset.baseMode) {
      const arm = e.target.dataset.baseMode, mode = e.target.value;
      dialog.querySelector(`[data-base-field="${arm}-kg"]`).hidden = mode !== 'kg';
      dialog.querySelector(`[data-base-field="${arm}-pair"]`).hidden = mode !== 'pair';
      dialog.querySelector(`[name="${arm}-base"]`).required = mode === 'kg';
    }
    if (wizard.step === 0) { readStep(false); dialog.querySelector('#scheduleStart').textContent = scheduleDescription(wizard.settings); }
  });
  dialog.addEventListener('submit', async e => {
    if (e.target.id !== 'progressionForm') return; e.preventDefault(); if (busy) return;
    busy = true;
    try { if (wizard.step === 2) await saveWizard(); else { readStep(); if (wizard.step === 1) wizard.preview = createProgression(wizard.settings); wizard.step++; renderWizard(); } }
    catch (e) { dialog.querySelector('#wizardError').textContent = e.message; } finally { busy = false; }
  });
  dialog.addEventListener('close', () => { document.getElementById('sectionProgressionButton').focus(); });
  document.getElementById('sectionProgressionButton').addEventListener('click', () => { showSection('Progression'); render(); });
  return { render, open(id) { selected = id; showSection('Progression'); render(); } };
}
