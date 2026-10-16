import { ARMS, newId, pairFor, validActiveWorkout } from './workout-model.js';
import { clone, validateConfig, allocatePeriods, generateCalendar, validDate, addDays } from './progression-model.js';
import { PRESET_VERSION, PERIODS } from './progression-presets.js';

const id = v => typeof v === 'string' && /^[a-zA-Z0-9:_-]{1,120}$/.test(v);
const finite = v => Number.isFinite(v) && v > 0;
function validRows(rows) {
  return Array.isArray(rows) && new Set(rows.map(s => s.id)).size === rows.length && rows.every(s => id(s.id) && s.plannedSetId === s.id
    && pairFor(s.i, s.j) && finite(s.kg) && Number.isInteger(s.reps) && s.reps >= 1 && s.reps <= 999 && s.status === 'pending'
    && ['warmup', 'main', 'test'].includes(s.role) && Number.isInteger(s.restSec) && s.restSec >= 0 && s.restSec <= 3600);
}
function validAssignment(a, rows, period) {
  return a && a.period === period && finite(a.baseKg) && typeof a.label === 'string' && typeof a.phase === 'string' && typeof a.cue === 'string'
    && typeof a.unavailable === 'boolean' && a.ideal && finite(a.ideal.kg) && finite(a.ideal.baseKg) && finite(a.ideal.percent)
    && Number.isInteger(a.ideal.sets) && a.ideal.sets >= 1 && a.ideal.sets <= 6 && Number.isInteger(a.ideal.reps) && a.ideal.reps >= 1
    && Array.isArray(a.groups) && a.groups.length > 0 && a.groups.every(g => g.ideal && finite(g.ideal.kg) && (g.unavailable === true ||
      (pairFor(...String(g.pair).split('-')) && finite(g.kg) && finite(g.intensity) && Array.isArray(g.reps) && g.reps.length > 0 && g.reps.every(n => Number.isInteger(n) && n >= 1 && n <= 999))))
    && JSON.stringify(a.sets) === JSON.stringify(rows) && (a.unavailable ? rows.length === 0 : rows.some(s => s.role !== 'warmup'));
}
export function validateProgressions(data) {
  if (!Array.isArray(data.progressions) || !Array.isArray(data.workouts)) throw new Error('Повреждён список программ.');
  const ids = new Set();
  for (const p of data.progressions) {
    if (!id(p.id) || ids.has(p.id) || p.presetVersion !== PRESET_VERSION || !['draft', 'active', 'paused', 'completed', 'archived'].includes(p.status)
      || !p.config || !p.arms || !Array.isArray(p.slots) || !Array.isArray(p.decisions) || !Array.isArray(p.blocks) || !Number.isInteger(p.revision)
      || p.revision < 1 || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100 || !validDate(p.config.targetDate)) throw new Error('Повреждена программа.');
    ids.add(p.id);
    const lengths = allocatePeriods(p.config.weeks), calendar = generateCalendar(p.config.targetDate, p.config.weeks);
    ARMS.forEach(a => validateConfig(p.config.arms?.[a]));
    if (p.slots.length !== calendar.length || p.config.start !== calendar[0].date || p.blocks.length !== 4) throw new Error('Повреждено расписание программы.');
    let startWeek = 1;
    p.blocks.forEach((b, i) => {
      if (!id(b.id) || b.key !== PERIODS[i].key || b.weeks !== lengths[i] || b.startWeek !== startWeek
        || b.startDate !== addDays(p.config.start, (startWeek - 1) * 7)
        || b.endDate !== addDays(p.config.start, (startWeek + b.weeks - 1) * 7 - 1)) throw new Error('Повреждены периоды программы.');
      startWeek += b.weeks;
    });
    const slotIds = new Set();
    p.slots.forEach((s, i) => {
      const b = p.blocks.find(b => calendar[i].week >= b.startWeek && calendar[i].week < b.startWeek + b.weeks);
      if (!id(s.id) || slotIds.has(s.id) || s.index !== i || s.date !== calendar[i].date || s.week !== calendar[i].week || s.day !== calendar[i].day
        || s.period !== b.key || s.blockId !== b.id || s.periodWeek !== s.week - b.startWeek + 1 || s.periodWeeks !== b.weeks
        || !s.plan || !s.arms || !ARMS.every(a => validRows(s.plan[a]) && validAssignment(s.arms[a], s.plan[a], s.period))
        || !Array.isArray(s.attempts) || new Set(s.attempts).size !== s.attempts.length || !s.evaluations || typeof s.closed !== 'boolean'
        || !Number.isInteger(s.revision) || s.revision < 1 || !['planned', 'active', 'completed', 'modified', 'partial', 'skipped'].includes(s.status)) throw new Error('Повреждено занятие программы.');
      slotIds.add(s.id);
      for (const attempt of s.attempts) if (!data.workouts.some(w => w.id === attempt && w.progressionId === p.id && w.plannedSessionId === s.id)) throw new Error('Нарушены связи истории программы.');
      if (s.credited && !s.attempts.includes(s.credited)) throw new Error('Зачтённая попытка отсутствует.');
    });
    if (p.suspendedWorkout && !validActiveWorkout(p.suspendedWorkout)) throw new Error('Повреждено отложенное занятие программы.');
  }
  const linked = [...data.workouts, ...(data.active ? [data.active] : []), ...(data.pendingImports || []), ...data.progressions.filter(p => p.suspendedWorkout).map(p => p.suspendedWorkout)];
  for (const w of linked) if (w.progressionId) {
    const p = data.progressions.find(p => p.id === w.progressionId);
    if (!p?.slots.some(s => s.id === w.plannedSessionId)) throw new Error('Тренировка ссылается на отсутствующее занятие программы.');
  }
  return data;
}
// Conflicts copy the whole graph, preserving the frozen assignments and links.
export function copyProgressionGraph(program, workouts, active, pendingImports = []) {
  const graph = clone({ program, workouts, active, pendingImports }), map = new Map();
  function collect(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.id === 'string' && !map.has(value.id)) map.set(value.id, newId());
    for (const v of Object.values(value)) collect(v);
  }
  collect(graph);
  function remap(value) {
    if (typeof value === 'string') return map.get(value) || value;
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [map.get(k) || k, remap(v)]));
    return value;
  }
  const result = remap(graph);
  result.program.name = `${program.name.slice(0, 88)} (копия)`; result.program.status = 'paused';
  return result;
}
