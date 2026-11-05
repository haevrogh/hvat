import { ARMS, PAIRS, newId } from './workout-model.js';

// These are HVAT's explicit example rules, not a measured strength forecast.
// PAIRS is read only at runtime because backup validation imports this module.
const GROWTH = .005;
const TYPES = ['advance', 'skip', 'pause', 'resume', 'return', 'maxima'];
const RULES = [
  { label: '5×5', sets: 5, reps: 5, percent: .75, backoff: 1 },
  { label: '4×4', sets: 4, reps: 4, percent: .80, backoff: 2 },
  { label: '3×3', sets: 3, reps: 3, percent: .85, backoff: 2 },
  { label: '2×2', sets: 2, reps: 2, percent: .90, backoff: 2 },
  { label: 'Лёгкая неделя', sets: 2, reps: 5, percent: .60, backoff: 0 },
];
const integer = value => Number.isSafeInteger(value) && value >= 1;
const cursorValid = value => value && integer(value.week) && [1, 2].includes(value.day);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,120}$/.test(value);
const timestampValid = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const maximaValid = value => value && typeof value === 'object' && !Array.isArray(value)
  && ARMS.every(arm => Number.isFinite(value[arm]) && value[arm] > 0 && value[arm] <= PAIRS.at(-1).kg);
const cursor = value => ({ week: value.week, day: value.day });

export function createCycle(initialMaxima, at = new Date().toISOString()) {
  if (!maximaValid(initialMaxima)) throw new Error('Укажи исходный максимум обеих рук: больше 0 и не выше 120,4 кг.');
  if (!timestampValid(at)) throw new Error('Некорректное время создания цикла.');
  return { version: 1, id: newId(), initialMaxima: { right: initialMaxima.right, left: initialMaxima.left },
    week: 1, day: 1, status: 'active', revision: 0, createdAt: at, updatedAt: at, events: [] };
}

export function validateCycle(raw) {
  const fail = () => { throw new Error('Повреждены данные бесконечного цикла.'); };
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || !validId(raw.id) || !maximaValid(raw.initialMaxima)
    || !cursorValid(raw) || !['active', 'paused'].includes(raw.status) || !Number.isSafeInteger(raw.revision) || raw.revision < 0
    || !timestampValid(raw.createdAt) || !timestampValid(raw.updatedAt) || !Array.isArray(raw.events)
    || raw.events.length > 100000 || raw.revision !== raw.events.length) fail();
  let previous = { week: 1, day: 1 };
  for (const event of raw.events) {
    if (!event || !TYPES.includes(event.type) || !timestampValid(event.at) || !cursorValid(event.from) || !cursorValid(event.to)
      || event.from.week !== previous.week || event.from.day !== previous.day) fail();
    const { from, to, type } = event;
    if (['advance', 'skip'].includes(type)) {
      if (to.week !== from.week + (from.day === 2 ? 1 : 0) || to.day !== (from.day === 2 ? 1 : 2)) fail();
    } else if (type === 'return') {
      if (!(to.week === from.week && to.day === from.day) && !(to.day === 1 && to.week <= from.week)) fail();
    } else if (to.week !== from.week || to.day !== from.day) fail();
    previous = to;
  }
  if (previous.week !== raw.week || previous.day !== raw.day) fail();
  try {
    const serialized = JSON.stringify(raw);
    if (serialized.length > 20000000) fail();
    return structuredClone(raw);
  } catch { fail(); }
}

function weekInfo(cycle, week) {
  if (!integer(week)) throw new Error('Номер тренировочной недели должен быть положительным целым числом.');
  const phase = (week - 1) % 5;
  const maxima = Object.fromEntries(ARMS.map(arm => [arm, cycle.initialMaxima[arm] * (1 + GROWTH) ** (week - 1)]));
  // No calendar cap: beyond JavaScript's numeric range we fail explicitly rather
  // than fabricate a finite maximum. This requires millennia of training weeks.
  if (!ARMS.every(arm => Number.isFinite(maxima[arm]) && maxima[arm] > 0)) throw new Error('Расчётная база превышает числовой предел. Уточни исходные максимумы или вернись к прежней неделе.');
  return { week, phase, light: phase === 4, label: RULES[phase].label, maxima };
}
function group(role, sets, reps, percent, restSec, maximum) {
  const targetKg = maximum * percent;
  // Strict floor of the original target, with no rounding or tolerance first.
  const found = PAIRS.filter(pair => pair.kg <= targetKg).at(-1);
  const pair = found ? { ...found } : null;
  const above = targetKg > PAIRS.at(-1).kg;
  const warning = !pair ? 'Цель ниже минимального сопротивления эспандера.'
    : above ? 'Цель выше предела эспандера: выбрана максимальная пара без добавления повторов.' : '';
  return { role, sets, reps, percent, restSec, targetKg, pair, available: !!pair, ...(warning ? { warning } : {}) };
}
function sessionFromInfo(info, day) {
  if (![1, 2].includes(day)) throw new Error('День цикла: 1 или 2.');
  const { week, phase, light, maxima } = info, rule = RULES[phase];
  const arms = Object.fromEntries(ARMS.map(arm => {
    const maximum = maxima[arm], groups = [];
    if (day === 1) {
      groups.push(group('main', rule.sets, rule.reps, rule.percent, light ? 120 : 240, maximum));
      if (!light) groups.push(group('backoff', rule.backoff, 10, .70, 120, maximum));
    } else {
      groups.push(group('main', light ? 2 : 4, 10, light ? .55 : .65, light ? 120 : 150, maximum));
    }
    return [arm, groups];
  }));
  const warnings = ARMS.flatMap(arm => arms[arm].filter(value => value.warning)
    .map(value => `${arm === 'right' ? 'Правая' : 'Левая'} рука: ${value.warning}`));
  return { week, day, phase, light, label: day === 1 ? light ? 'Лёгкий день 1' : `${rule.label} + добор` : light ? 'Лёгкий день 2' : 'Объёмный день',
    maxima: { ...maxima }, arms, available: ARMS.every(arm => arms[arm].every(value => value.available)), warnings: [...new Set(warnings)] };
}
function fullWeek(cycle, week) {
  const info = weekInfo(cycle, week);
  return { ...info, sessions: [sessionFromInfo(info, 1), sessionFromInfo(info, 2)] };
}
export function getCycleWeek(cycle, week = cycle.week) {
  return fullWeek(validateCycle(cycle), week);
}
export function getCycleWeeks(cycle, weeks) {
  const valid = validateCycle(cycle);
  return weeks.map(week => fullWeek(valid, week));
}
export function getCycleSession(cycle, week = cycle.week, day = cycle.day) {
  return sessionFromInfo(weekInfo(validateCycle(cycle), week), day);
}

export function transitionCycle(cycle, action, at = new Date().toISOString()) {
  const next = validateCycle(cycle);
  if (!action || !TYPES.includes(action.type)) throw new Error('Неизвестное действие цикла.');
  if (!timestampValid(at)) throw new Error('Некорректное время действия.');
  const from = cursor(next);
  if (['advance', 'skip'].includes(action.type)) {
    if (next.status !== 'active') throw new Error('Цикл приостановлен. Сначала продолжи его.');
    if (next.day === 1) next.day = 2;
    else { if (next.week === Number.MAX_SAFE_INTEGER) throw new Error('Номер недели превышает числовой предел.'); next.week++; next.day = 1; }
  } else if (action.type === 'pause') next.status = 'paused';
  else if (action.type === 'resume') next.status = 'active';
  else if (action.type === 'return') {
    if (!Number.isSafeInteger(action.weeksBack) || action.weeksBack < 0) throw new Error('Число недель возврата должно быть целым и неотрицательным.');
    if (action.weeksBack > 0) { next.week = Math.max(1, next.week - action.weeksBack); next.day = 1; }
    next.status = 'active';
  } else if (action.type === 'maxima') {
    if (!maximaValid(action)) throw new Error('Проверь исходные максимумы обеих рук.');
    next.initialMaxima = { right: action.right, left: action.left };
  }
  next.revision++; next.updatedAt = at;
  next.events.push({ type: action.type, at, from, to: cursor(next) });
  return validateCycle(next);
}

export function cyclePlan(cycle) {
  if (cycle.status !== 'active') throw new Error('Цикл приостановлен.');
  const session = getCycleSession(cycle);
  if (!session.available) throw new Error('Не все нагрузки доступны на эспандере. Проверь исходные максимумы.');
  return Object.fromEntries(ARMS.map(arm => [arm, session.arms[arm].flatMap((value, cycleGroup) =>
    Array.from({ length: value.sets }, () => {
      const id = newId();
      return { id, plannedSetId: id, ...value.pair, reps: value.reps, role: 'main',
        restSec: value.restSec, status: 'pending', calcVersion: 'spring-0.3008-1.8637-2.98',
        cycleRole: value.role, cycleMaxKg: session.maxima[arm], cyclePercent: value.percent, cycleGroup,
        cycleId: cycle.id, cycleWeek: session.week, cycleDay: session.day, cycleRevision: cycle.revision };
    }))]));
}
