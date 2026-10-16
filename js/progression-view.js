import { ARMS, ARM_LABELS, PAIRS } from './workout-model.js';
import { PERIODS, ROLES } from './progression-presets.js';
import { keyPair, currentSlot, progress, loadStats, localToday, MAX_WEIGHT } from './progression-model.js';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const button = (action, label, extra = '', primary = false) => `<button type="button" class="button${primary ? ' button--primary' : ''}" data-prog="${action}" ${extra}>${label}</button>`;
export const displayDate = value => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
const number = n => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
export const options = selected => PAIRS.map(p => `<option value="${keyPair(p)}" ${selected === keyPair(p) ? 'selected' : ''}>${number(p.kg)} кг · ${p.i} / ${p.j}</option>`).join('');
const statuses = { draft: 'Черновик', active: 'Активна', paused: 'Приостановлена', completed: 'Завершена', archived: 'В архиве', planned: 'По плану', partial: 'Частично', skipped: 'Пропущено', modified: 'Завершено с отклонениями' };
export function armForm(config, arm) {
  return `<fieldset class="schedule-fieldset"><legend>${ARM_LABELS[arm]} рука · исходный 1ПМ</legend>
    <label class="field">Способ ввода<select name="${arm}-mode" data-base-mode="${arm}"><option value="kg" ${config.inputMode === 'kg' ? 'selected' : ''}>Известный 1ПМ в кг</option><option value="pair" ${config.inputMode === 'pair' ? 'selected' : ''}>Закрываемая пара пружин</option></select></label>
    <label class="field" ${config.inputMode !== 'kg' ? 'hidden' : ''} data-base-field="${arm}-kg">1ПМ, кг<input name="${arm}-base" type="number" min="0.1" max="${MAX_WEIGHT}" step="0.1" value="${config.base}" ${config.inputMode === 'kg' ? 'required' : ''}></label>
    <label class="field" ${config.inputMode !== 'pair' ? 'hidden' : ''} data-base-field="${arm}-pair">Пара пружин<select name="${arm}-pair">${options(config.pair)}</select></label>
    ${config.recordAt ? `<p class="prog-note">Подставлен подтверждённый рекорд: ${number(config.base)} кг. Проверь, актуален ли он.</p>` : ''}
    <label class="prog-check"><input name="${arm}-confirmed" type="checkbox" ${config.baseConfirmed ? 'checked' : ''} required>Подтверждаю исходный 1ПМ ${arm === 'right' ? 'правой' : 'левой'} руки</label>
  </fieldset>`;
}
export function periodStrip(p) {
  const current = currentSlot(p);
  return `<ol class="period-strip" aria-label="Периоды подготовки">${p.blocks.map(b => `<li class="period-item${current?.blockId === b.id ? ' is-current' : ''}"><strong>${b.label}</strong><span>${b.weeks} нед.</span><small>${displayDate(b.startDate)} — ${displayDate(b.endDate)}</small>${current?.blockId === b.id ? '<span class="period-current">Текущий период</span>' : ''}</li>`).join('')}</ol>`;
}
function calculation(assignment) {
  return `<details class="load-explanation"><summary>Как подобрана нагрузка</summary><p>Расчётная база: ${number(assignment.baseKg)} кг. Это ориентир для назначения нагрузки.</p>
    ${assignment.groups.map(g => `<div class="load-calculation"><p>Цель: ${number(g.ideal.kg)} кг (${number(g.ideal.percent)}%) · ${g.ideal.sets}×${g.ideal.reps}.</p>
      ${g.unavailable ? '<p class="form-error">Нет достаточно лёгкой пары пружин для этого назначения.</p>' : `<p>План: ${number(g.kg)} кг (${number(g.intensity)}%) · ${g.reps.join(' + ')} повторений.</p><p>Объём: ${number(g.ideal.kg * g.ideal.sets * g.ideal.reps)} → ${number(g.kg * g.reps.reduce((a, b) => a + b, 0))} кг.</p>
      ${g.capped ? '<p>Достигнут предел эспандера. Дополнительные повторения приближают плановый объём; они не подтверждают новый 1ПМ.</p>' : g.fallback ? '<p>Вблизи целевого процента пары нет: взята ближайшая доступная снизу.</p>' : ''}`}</div>`).join('')}
    <p>Статистика занятия включает разминку. Совпадение объёма не означает одинаковое силовое воздействие.</p></details>`;
}
export function slotView(slot, controls = '') {
  return `<article class="prog-slot" id="slot-${slot.id}"><div class="prog-slot-heading"><h3>${displayDate(slot.date)} · ${slot.arms.right.label}</h3><span class="prog-status">${statuses[slot.status] || slot.status}${slot.status === 'planned' && slot.date < localToday() ? ' · дата прошла' : ''}</span></div>
    <p class="prog-note">${PERIODS.find(p => p.key === slot.period).label} · неделя периода ${slot.periodWeek} / ${slot.periodWeeks} · ${slot.arms.right.phase}</p>
    <div class="prog-arms">${ARMS.map(arm => { const a = slot.arms[arm]; return `<section class="prog-arm"><h4>${ARM_LABELS[arm]} рука</h4><p>${esc(a.cue)}</p>
      ${a.unavailable ? '<p class="form-error">Нет подходящей нагрузки: минимальная пара тяжелее задания. Это занятие можно пропустить.</p>' : `<ol class="prog-set-list">${slot.plan[arm].map(s => `<li><span>${ROLES[s.role]} · ${number(s.kg)} кг · ${s.i}/${s.j}</span><strong>${s.reps} повт.</strong></li>`).join('')}</ol><p class="prog-note">Отдых: ${a.ideal.restSec} с${a.groups.some(g => g.capped) ? ' · предел веса компенсирован повторениями' : ''}</p>`}
      ${slot.evaluations?.[arm] ? `<p>${esc(slot.evaluations[arm].reason)}</p>` : ''}${calculation(a)}</section>`; }).join('')}</div>${controls}</article>`;
}
function weekStats(p, week, workouts) {
  const slots = p.slots.filter(s => s.week === week);
  return `<div class="week-statistics">${ARMS.map(arm => {
    const base = slots[0].arms[arm].baseKg, rows = slots.flatMap(s => s.plan[arm]);
    const stats = loadStats(rows, base);
    const actual = loadStats(workouts.filter(w => w.progressionId === p.id && slots.some(s => s.id === w.plannedSessionId)).flatMap(w => w.sets[arm]), base, true);
    return `<p><strong>${ARM_LABELS[arm]}:</strong> база ${number(base)} кг · ${stats.repetitions} повторений · объём ${number(stats.tonnage)} кг · средняя интенсивность ${number(stats.intensity)}%${actual.sets ? `<br>Выполнено: ${actual.repetitions} повторений · ${number(actual.tonnage)} кг · ${number(actual.intensity)}%` : ''}</p>`;
  }).join('')}</div>`;
}
export function planView(p, workouts = [], active = null, interactive = false) {
  const next = currentSlot(p);
  return `${periodStrip(p)}${p.config.weeks < 26 ? '<p class="prog-note">Сокращённая адаптация HVAT: длительность периодов меньше полной схемы LMS.</p>' : ''}
    <div class="prog-weeks">${Array.from({ length: p.config.weeks }, (_, i) => {
      const slots = p.slots.filter(s => s.week === i + 1), block = p.blocks.find(b => b.id === slots[0].blockId);
      return `<details class="prog-week" ${i + 1 === (next?.week || 1) ? 'open' : ''}><summary>Неделя ${i + 1} · ${block.label} · ${displayDate(slots[0].date)}</summary>${weekStats(p, i + 1, workouts)}${slots.map(s => {
        let controls = '';
        if (interactive && s.id === next?.id && p.status === 'active' && !active) controls = `<div class="prog-actions">${!ARMS.some(a => s.arms[a].unavailable) ? button('start', s.status === 'partial' ? 'Повторить занятие' : 'Начать занятие', `data-id="${s.id}"`, true) : ''}${button('skip', 'Пропустить занятие', `data-id="${s.id}"`)}</div>`;
        return slotView(s, controls);
      }).join('')}</details>`;
    }).join('')}</div>`;
}
export function programView(p, active, programs, workouts) {
  const done = progress(p), next = currentSlot(p);
  return `<div class="training-heading"><h1>${esc(p.name)}</h1>${button('create', 'Новая программа')}</div>
    ${programs.length > 1 ? `<label class="field">Программа<select id="programSelect">${programs.map(x => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
    <section class="training-panel"><p class="eyebrow">${statuses[p.status]} · ${p.config.weeks} недель · три тренировки в неделю</p><h2>Пик ${displayDate(p.config.targetDate)}</h2>
      <p>Начало ${displayDate(p.config.start)} · выполнено ${done.done} / ${done.total} занятий (${done.percent}%). Пропущено: ${done.skipped}.</p>
      <p class="prog-note">Расчётная база растёт на 1% в неделю. Фактические рекорды появляются только после выполнения.</p>
      <div class="prog-actions">${active?.progressionId === p.id ? button('resume', 'Продолжить тренировку', '', true) : next && p.status === 'active' ? button('current', 'К ближайшему занятию', '', true) : ''}
      ${p.status === 'active' ? button('pause', 'Приостановить') : ['draft', 'paused'].includes(p.status) ? button('activate', 'Запустить', '', true) : ''}
      ${['active', 'paused'].includes(p.status) ? button('finish', 'Завершить программу') : ''}${p.status !== 'archived' ? button('archive', 'В архив') : ''}${button('history', 'Журнал программы')}</div>
      ${p.status === 'paused' ? '<p>Даты и нагрузки сохраняются во время паузы.</p>' : ''}</section>
    ${planView(p, workouts, active, true)}`;
}
