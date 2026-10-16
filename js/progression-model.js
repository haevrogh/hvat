import { ARMS, PAIRS, newId, pairFor } from './workout-model.js';
import { PERIODS, DAYS, BASE_LOADS, PRESET_VERSION, INTENSITY_WAVE, SET_WAVE } from './progression-presets.js';

export const CALC_VERSION = 'spring-0.3008-1.8637-2.98';
export const clone = value => structuredClone(value);
export const keyPair = p => `${p.i}-${p.j}`;
export const pairKey = key => { const [i, j] = String(key).split('-').map(Number); return pairFor(i, j); };
export const MAX_WEIGHT = PAIRS.at(-1).kg;
export const kg10 = kg => Math.round(kg * 10);
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date;
}
export function addDays(date, count) {
  if (!validDate(date)) throw new Error('Укажи корректную дату выхода на пик.');
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
export const defaultArm = () => ({ base: 100, baseConfirmed: false, inputMode: 'kg', pair: '7-12' });
export function validateConfig(c) {
  if (!c || !Number.isFinite(c.base) || c.base < .1 || c.base > MAX_WEIGHT) throw new Error(`Исходный 1ПМ: от 0,1 до ${MAX_WEIGHT} кг.`);
  if (!c.baseConfirmed) throw new Error('Подтверди исходный 1ПМ каждой руки.');
  if (!['kg', 'pair'].includes(c.inputMode) || !pairKey(c.pair)) throw new Error('Проверь способ ввода 1ПМ и пару пружин.');
  if (c.inputMode === 'pair' && c.base !== pairKey(c.pair).kg) throw new Error('1ПМ должен соответствовать выбранной паре.');
}
export function allocatePeriods(weeks) {
  if (!Number.isInteger(weeks) || weeks < 4 || weeks > 52) throw new Error('Длительность: от 4 до 52 недель.');
  const low = weeks < 26 ? [1, 1, 1, 1] : PERIODS.map(p => p.min);
  const high = PERIODS.map(p => weeks < 26 ? p.min : p.max);
  const extra = weeks - low.reduce((a, b) => a + b, 0);
  const spans = high.map((v, i) => v - low[i]), denominator = spans.reduce((a, b) => a + b, 0);
  const result = low.map((v, i) => v + Math.floor(extra * spans[i] / denominator));
  const order = spans.map((v, i) => ({ i, remainder: extra * v % denominator }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  const remaining = weeks - result.reduce((a, b) => a + b, 0);
  for (const { i } of order.slice(0, remaining)) result[i]++;
  return result;
}
export function generateCalendar(targetDate, weeks) {
  allocatePeriods(weeks);
  const start = addDays(targetDate, 1 - weeks * 7);
  return Array.from({ length: weeks }, (_, w) => (w === weeks - 1 ? [0, 2, 6] : [0, 2, 4])
    .map((offset, day) => ({ week: w + 1, day, date: addDays(start, w * 7 + offset) }))).flat();
}
export const weeklyBase = (base, week) => base * 1.01 ** (week - 1);
const balancedReps = (total, count) => Array.from({ length: count }, (_, i) => Math.floor(total / count) + (i < total % count ? 1 : 0));
const relative = (actual, ideal) => Math.abs(actual - ideal) / ideal;
export function fitLoad(ideal, period, optimize = true) {
  const { kg, sets, reps, baseKg } = ideal;
  if (![kg, baseKg].every(v => Number.isFinite(v) && v > 0) || !Number.isInteger(sets) || sets < 1 || sets > 6 || !Number.isInteger(reps) || reps < 1) throw new Error('Некорректное назначение нагрузки.');
  const targetQ = sets * reps, targetT = kg * targetQ;
  if (kg > MAX_WEIGHT) {
    const total = Math.ceil(targetT / MAX_WEIGHT);
    if (Math.ceil(total / sets) > 999) throw new Error('Назначение превышает предел повторений.');
    return { pair: PAIRS.at(-1), reps: balancedReps(total, sets), capped: true, fallback: false };
  }
  const lower = PAIRS.filter(p => p.kg <= kg + 1e-9).at(-1);
  if (!lower) return { pair: null, reps: [], capped: false, fallback: false, unavailable: true };
  if (!optimize || !['endurance', 'strength'].includes(period)) return { pair: lower, reps: Array(sets).fill(reps), capped: false, fallback: false };
  const range = PERIODS.find(p => p.key === period).reps;
  const candidates = [];
  for (const pair of PAIRS.filter(p => Math.abs(p.kg / baseKg - kg / baseKg) <= .05 + 1e-9)) {
    for (let count = Math.max(1, sets - 1); count <= Math.min(6, sets + 1); count++) {
      for (let q = count * range[0]; q <= count * range[1]; q++) {
        const score = 4 * relative(pair.kg, kg) + 2 * relative(pair.kg * q, targetT)
          + relative(q, targetQ) + .25 * relative(count, sets);
        candidates.push({ pair, reps: balancedReps(q, count), score, setDiff: Math.abs(count - sets) });
      }
    }
  }
  candidates.sort((a, b) => Math.abs(a.score - b.score) > 1e-12 ? a.score - b.score
    : a.pair.kg - b.pair.kg || a.setDiff - b.setDiff || a.pair.i - b.pair.i || a.pair.j - b.pair.j);
  const best = candidates[0];
  return best ? { ...best, capped: false, fallback: false } : { pair: lower, reps: Array(sets).fill(reps), capped: false, fallback: true };
}
function makeSet(pair, reps, role, restSec, extra = {}) {
  const id = newId();
  return { id, plannedSetId: id, ...pair, reps, role, restSec, status: 'pending', calcVersion: CALC_VERSION, ...extra };
}
export function loadStats(rows, baseKg, actual = false) {
  const counted = actual ? rows.filter(s => s.status === 'done') : rows;
  const repetitions = counted.reduce((n, s) => n + (actual ? s.actualReps : s.reps), 0);
  const tonnage = counted.reduce((n, s) => n + s.kg * (actual ? s.actualReps : s.reps), 0);
  return { repetitions, tonnage, sets: counted.length, intensity: repetitions ? tonnage / repetitions / baseKg * 100 : 0 };
}
export function idealLoad(period, periodWeek, periodWeeks, day, baseKg) {
  let percent, sets, reps, deload = false, control = false;
  const taper = period === 'peak' && periodWeek === periodWeeks;
  if (taper) {
    [percent, sets, reps] = [[.85, 2, 1], [.40, 2, 3], [1, 1, 1]][day];
    control = day === 2;
  } else if (period === 'peak') {
    const t = periodWeeks <= 2 ? 0 : (periodWeek - 1) / (periodWeeks - 2);
    [percent, sets, reps] = day === 0 ? [.75 + .15 * t, Math.round(4 - 2 * t), Math.round(3 - 2 * t)]
      : day === 1 ? [.40, 2, 4] : [.60 + .10 * t, 3, 3];
    deload = periodWeek % 4 === 0;
    if (deload) sets = Math.max(1, Math.round(sets / 2));
  } else {
    [percent, sets, reps] = BASE_LOADS[period][day];
    const wave = (periodWeek - 1) % 4;
    percent *= INTENSITY_WAVE[wave];
    sets = Math.min(6, Math.max(1, Math.round(sets * SET_WAVE[wave])));
    deload = wave === 3;
  }
  return { kg: baseKg * percent, baseKg, percent: percent * 100, sets, reps,
    restSec: control || (period === 'peak' && day === 0) ? 300 : day === 1 ? 120 : PERIODS.find(p => p.key === period).rest,
    deload, taper, control };
}
function warmups(firstKg, baseKg, period, restSec, workReps) {
  const seen = new Set(), rows = [];
  const counts = period === 'endurance' ? [8, 8, 8] : [6, Math.max(4, workReps), workReps];
  [.30, .50, .65].forEach((fraction, i) => {
    const pair = PAIRS.filter(p => p.kg <= baseKg * fraction + 1e-9 && p.kg < firstKg).at(-1);
    if (!pair || seen.has(keyPair(pair))) return;
    seen.add(keyPair(pair)); rows.push(makeSet(pair, counts[i], 'warmup', restSec));
  });
  return rows;
}
export function assignment(config, context) {
  const baseKg = weeklyBase(config.base, context.week);
  const ideal = idealLoad(context.period, context.periodWeek, context.periodWeeks, context.day, baseKg);
  const definition = PERIODS.find(p => p.key === context.period);
  const result = { period: context.period, periodWeek: context.periodWeek, baseKg, ideal,
    label: ideal.control ? 'Контроль результата' : DAYS[context.day],
    phase: ideal.taper ? 'Подводка' : ideal.deload ? 'Разгрузка' : definition.label,
    cue: definition.cue, sets: [], groups: [], unavailable: false };
  const ideals = ideal.control ? [.9, .95, 1].map(f => ({ ...ideal, kg: baseKg * f, percent: f * 100 })) : [ideal];
  for (const target of ideals) {
    const fitted = fitLoad(target, context.period, !ideal.taper);
    if (!fitted.pair) { result.unavailable = true; result.groups.push({ ideal: target, unavailable: true }); continue; }
    const group = { ideal: target, kg: fitted.pair.kg, pair: keyPair(fitted.pair), reps: fitted.reps,
      capped: fitted.capped, fallback: fitted.fallback, intensity: fitted.pair.kg / baseKg * 100 };
    if (ideal.control) {
      const duplicate = result.groups.findIndex(g => g.pair === group.pair && g.reps.join(',') === group.reps.join(','));
      if (duplicate !== -1) { result.groups[duplicate] = group; continue; }
    }
    result.groups.push(group);
  }
  if (ideal.control && ideal.kg > MAX_WEIGHT) {
    const final = result.groups.at(-1);
    result.groups = result.groups.filter(g => !g.capped || g === final);
  }
  const first = result.groups.find(g => !g.unavailable);
  if (first && !result.unavailable) {
    result.sets = warmups(first.kg, baseKg, context.period, ideal.restSec, Math.max(...first.reps));
    result.groups.forEach((group, index) => group.reps.forEach(reps => result.sets.push(makeSet(pairKey(group.pair), reps,
      ideal.control ? 'test' : 'main', ideal.restSec, { group: index, capped: group.capped, control: ideal.control }))));
  }
  result.stats = loadStats(result.sets, baseKg);
  return result;
}
export function createProgression(settings) {
  if (!settings?.name?.trim() || settings.name.length > 100) throw new Error('Название: от 1 до 100 символов.');
  const lengths = allocatePeriods(settings.weeks);
  if (!validDate(settings.targetDate)) throw new Error('Укажи корректную дату выхода на пик.');
  ARMS.forEach(a => validateConfig(settings.arms?.[a]));
  const config = clone(settings), calendar = generateCalendar(config.targetDate, config.weeks);
  config.start = calendar[0].date;
  const now = new Date().toISOString();
  const p = { id: newId(), name: config.name.trim(), status: 'draft', presetVersion: PRESET_VERSION,
    config, revision: 1, createdAt: now, updatedAt: now, arms: clone(config.arms), blocks: [], slots: [], decisions: [], position: 0 };
  let startWeek = 1;
  PERIODS.forEach((period, i) => {
    p.blocks.push({ id: newId(), key: period.key, label: period.label, weeks: lengths[i], startWeek,
      startDate: addDays(config.start, (startWeek - 1) * 7), endDate: addDays(config.start, (startWeek + lengths[i] - 1) * 7 - 1) });
    startWeek += lengths[i];
  });
  calendar.forEach((date, index) => {
    const block = p.blocks.find(b => date.week >= b.startWeek && date.week < b.startWeek + b.weeks);
    const context = { ...date, period: block.key, periodWeek: date.week - block.startWeek + 1, periodWeeks: block.weeks };
    const arms = Object.fromEntries(ARMS.map(a => [a, assignment(config.arms[a], context)]));
    p.slots.push({ id: newId(), ...context, index, blockId: block.id, status: 'planned', closed: false, attempts: [], revision: 1,
      arms, plan: Object.fromEntries(ARMS.map(a => [a, arms[a].sets])), evaluations: {}, credited: null });
  });
  return p;
}
export const currentSlot = p => p.slots.find(s => !s.closed) || null;
export function progress(p) {
  const done = p.slots.filter(s => s.credited).length;
  return { done, total: p.slots.length, percent: Math.round(done / p.slots.length * 100),
    partial: p.slots.filter(s => s.status === 'partial').length, skipped: p.slots.filter(s => s.status === 'skipped').length };
}
export function evaluateArm(plan, actual) {
  const work = plan.filter(s => s.role !== 'warmup');
  const byId = new Map(actual.map(s => [s.plannedSetId || s.id, s]));
  const complete = work.length > 0 && work.every(s => ['done', 'skipped'].includes(byId.get(s.plannedSetId || s.id)?.status));
  const success = complete && work.every(s => {
    const a = byId.get(s.plannedSetId || s.id);
    return a.status === 'done' && a.actualReps >= s.reps && kg10(a.kg) >= kg10(s.kg) && !['invalid', 'assisted'].includes(a.quality);
  });
  return { complete, success, reason: success ? 'План выполнен.' : complete ? 'Есть недобор или пропущенные подходы.' : 'Занятие выполнено частично.' };
}
export function applyWorkout(program, workout) {
  const p = clone(program), slot = p.slots.find(s => s.id === workout.plannedSessionId);
  if (!slot) throw new Error('Занятие программы не найдено.');
  if (slot.attempts.includes(workout.id)) return p;
  slot.attempts.push(workout.id);
  slot.evaluations = Object.fromEntries(ARMS.map(a => [a, evaluateArm(slot.plan[a], workout.sets[a])]));
  const complete = ARMS.every(a => slot.plan[a].every(s => workout.sets[a].some(row => (row.plannedSetId || row.id) === s.plannedSetId && ['done', 'skipped'].includes(row.status))));
  if (complete) {
    slot.credited ||= workout.id;
    slot.closed = true;
    slot.status = ARMS.every(a => slot.evaluations[a].success) ? 'completed' : 'modified';
  } else if (!slot.credited) { slot.status = 'partial'; }
  p.position = currentSlot(p)?.index ?? p.slots.length;
  if (!currentSlot(p)) { p.status = 'completed'; p.completionReason = 'period'; }
  p.revision++; p.updatedAt = workout.endedAt;
  return p;
}
export function skipSlot(program, slotId) {
  const p = clone(program), slot = p.slots.find(s => s.id === slotId);
  if (!slot || slot.status === 'active' || slot.closed) throw new Error('Занятие нельзя пропустить.');
  slot.closed = true; slot.status = 'skipped';
  p.position = currentSlot(p)?.index ?? p.slots.length;
  if (!currentSlot(p)) { p.status = 'completed'; p.completionReason = 'period'; }
  p.revision++;
  return p;
}
export function stopControlAttempts(active, arm) {
  const plan = new Map(active.initialPlan[arm].map(s => [s.plannedSetId, s]));
  const failed = active.sets[arm].find(s => s.control && s.status === 'done' &&
    (s.actualReps < plan.get(s.plannedSetId).reps || kg10(s.kg) < kg10(plan.get(s.plannedSetId).kg)));
  if (!failed) return;
  const index = active.sets[arm].indexOf(failed);
  active.sets[arm].slice(index + 1).forEach(s => { if (s.control && s.status === 'pending') { s.status = 'skipped'; s.autoStopped = true; } });
}
