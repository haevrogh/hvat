import { ARMS, PAIRS, newId } from './workout-model.js';

// A manual plan uses the spring calculator's units, never a barbell equivalent.
// References to PAIRS stay inside functions: backup validation imports this module.
const DAY_MS = 86400000;
const RIR_KEYS = ['unknown', '0', '1', '2', '3', '4'];
const INTENSITY_BINS = [
  { key: 'under50', label: '<50%', min: 0, max: 50 },
  { key: '50to70', label: '50–69%', min: 50, max: 70 },
  { key: '70to85', label: '70–84%', min: 70, max: 85 },
  { key: '85to100', label: '85–99%', min: 85, max: 100 },
  { key: '100plus', label: '≥100%', min: 100, max: Infinity },
];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const validMaximum = value => Number.isFinite(value) && value > 0 && value <= PAIRS.at(-1).kg;
const integer = (value, min, max) => Number.isInteger(value) && finite(value, min, max);
const idValid = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,120}$/.test(value);
const textValid = (value, limit, empty = false) => typeof value === 'string' && value.length <= limit && (empty || value.trim().length > 0);

export function validBlockDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function addBlockDays(date, count) {
  if (!validBlockDate(date) || !Number.isInteger(count)) throw new Error('Некорректная дата блока.');
  return new Date(Date.parse(`${date}T12:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);
}
export function blockEnd(block) { return addBlockDays(block.start, block.weeks * 7 - 1); }
function datesBetween(start, end) {
  const count = dayDifference(start, end) + 1;
  return Array.from({ length: Math.max(0, count) }, (_, index) => addBlockDays(start, index));
}
function dayDifference(start, end) {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / DAY_MS);
}
export function createWorkspace() {
  return { version: 1, profile: { right: { maxKg: null, date: '' }, left: { maxKg: null, date: '' }, sex: '', age: null },
    model: { volumeHalfLife: 2, heavyHalfLife: 5, heavyThreshold: 85 }, blocks: [] };
}
export function createBlock({ name, start, weeks }) {
  if (!textValid(name, 100) || !validBlockDate(start) || !integer(weeks, 1, 52)) throw new Error('Проверь название, дату и длительность блока (1–52 недели).');
  return { id: newId(), name: name.trim(), start, weeks, sessions: [] };
}
export function createSession(date, title = 'Занятие') {
  if (!validBlockDate(date) || !textValid(title, 100)) throw new Error('Проверь дату и название занятия.');
  return { id: newId(), title: title.trim(), date, arms: { right: [], left: [] } };
}
export function createRow(overrides = {}) {
  const row = { id: newId(), role: 'main', sets: 3, reps: 5, mode: 'percent', value: 70, restSec: 180, rir: 'unknown', ...overrides };
  if (!validRow(row)) throw new Error('Проверь подходы, повторения, сопротивление, отдых и RIR.');
  return row;
}
function validRow(row) {
  return object(row) && idValid(row.id) && ['warmup', 'main'].includes(row.role)
    && integer(row.sets, 1, 20) && integer(row.reps, 1, 999) && ['percent', 'kg'].includes(row.mode)
    && finite(row.value, .1, row.mode === 'percent' ? 300 : 500)
    && integer(row.restSec, 0, 3600) && RIR_KEYS.includes(row.rir);
}
export function validateWorkspace(raw) {
  const invalid = message => { throw new Error(`Некорректный план блоков: ${message}.`); };
  let encoded;
  try { encoded = JSON.stringify(raw); } catch { invalid('данные не могут быть сохранены'); }
  if (!encoded || encoded.length > 4000000) invalid('превышен допустимый размер');
  if (!object(raw) || raw.version !== 1 || !object(raw.profile) || !object(raw.model)) invalid('версия или структура');
  for (const arm of ARMS) {
    const value = raw.profile[arm];
    if (!object(value) || !(value.maxKg === null || validMaximum(value.maxKg))
      || !(value.date === '' || validBlockDate(value.date))) invalid('максимум или дата руки');
  }
  if (!['', 'male', 'female', 'other'].includes(raw.profile.sex) || !(raw.profile.age === null || integer(raw.profile.age, 1, 120))) invalid('профиль');
  if (!finite(raw.model.volumeHalfLife, .25, 30) || !finite(raw.model.heavyHalfLife, .25, 30)
    || !finite(raw.model.heavyThreshold, 1, 150)) invalid('параметры сценария');
  if (!Array.isArray(raw.blocks) || raw.blocks.length > 100) invalid('число блоков');
  const ids = new Set();
  let rowCount = 0, sessionCount = 0;
  const useId = id => { if (!idValid(id) || ids.has(id)) invalid('повторяющийся или неверный идентификатор'); ids.add(id); };
  for (const block of raw.blocks) {
    if (!object(block) || !textValid(block.name, 100) || !validBlockDate(block.start) || !integer(block.weeks, 1, 52)
      || !Array.isArray(block.sessions) || block.sessions.length > 1092) invalid('блок');
    useId(block.id);
    const end = blockEnd(block);
    for (const session of block.sessions) {
      if (++sessionCount > 10000) invalid('слишком много занятий');
      if (!object(session) || !textValid(session.title, 100) || !validBlockDate(session.date)
        || session.date < block.start || session.date > end || !object(session.arms)) invalid('дата или структура занятия');
      useId(session.id);
      for (const arm of ARMS) {
        if (!Array.isArray(session.arms[arm]) || session.arms[arm].length > 100) invalid('строки занятия');
        for (const row of session.arms[arm]) {
          if (++rowCount > 30000 || !validRow(row)) invalid('строка нагрузки');
          useId(row.id);
        }
      }
    }
  }
  try { return structuredClone(raw); } catch { invalid('данные не могут быть скопированы'); }
}

export function copyBlockRow(row) { return createRow({ ...structuredClone(row), id: newId() }); }
export function copyBlockSession(session, date = session.date) {
  const copy = createSession(date, session.title);
  for (const arm of ARMS) copy.arms[arm] = session.arms[arm].map(copyBlockRow);
  return copy;
}
export function copyBlock(block, start = block.start) {
  const copy = createBlock({ ...block, start });
  const offset = Math.round((Date.parse(`${start}T12:00:00Z`) - Date.parse(`${block.start}T12:00:00Z`)) / DAY_MS);
  copy.sessions = block.sessions.map(session => copyBlockSession(session, addBlockDays(session.date, offset)));
  return copy;
}

export function resolveRow(row, profileArm) {
  const maxKg = profileArm?.maxKg;
  const hasMax = validMaximum(maxKg);
  const targetKg = row.mode === 'percent' ? hasMax ? maxKg * row.value / 100 : null : row.value;
  const pair = targetKg === null ? null : PAIRS.filter(value => value.kg <= targetKg + 1e-9).at(-1) || null;
  const aboveMax = targetKg !== null && targetKg > PAIRS.at(-1).kg + 1e-9;
  const relative = hasMax && pair ? pair.kg / maxKg : null;
  const relativeKnown = relative !== null && Number.isFinite(relative * 100) && Number.isFinite(relative * row.sets * row.reps);
  const available = hasMax && !!pair && !aboveMax && relativeKnown;
  const reason = !hasMax ? 'Укажи максимум руки.' : !pair ? 'Цель ниже минимального сопротивления.'
    : aboveMax ? 'Цель выше максимального сопротивления.' : !relativeKnown ? 'Максимум слишком мал для расчёта интенсивности.' : '';
  return { ...structuredClone(row), targetKg, actualKg: pair?.kg ?? null, pair: pair ? { ...pair } : null,
    intensity: relativeKnown ? relative * 100 : null, available, reason, totalReps: row.sets * row.reps };
}

function emptyStats() {
  return { sets: 0, repetitions: 0, heavyReps: 0, tonnage: 0, relativeVolume: 0, effort: 0, volume: 0, heavy: 0, meanIntensity: null,
    resolvedRepetitions: 0, unavailableRows: 0, complete: true,
    intensityDistribution: INTENSITY_BINS.map(({ key, label }) => ({ key, label, repetitions: 0 })),
    rirDistribution: RIR_KEYS.map(key => ({ key, label: key === 'unknown' ? 'Неизвестно' : key === '4' ? '4+' : key, sets: 0, repetitions: 0 })) };
}
function addResolved(stats, row, threshold) {
  stats.sets += row.sets;
  stats.repetitions += row.totalReps;
  const rir = stats.rirDistribution.find(value => value.key === row.rir) || stats.rirDistribution[0];
  rir.sets += row.sets; rir.repetitions += row.totalReps;
  // A recorded absolute resistance remains useful when its historical maximum
  // was never saved. Unavailable prescriptions never count as recorded effort.
  if (row.available || (row.actualOnly && finite(row.actualKg, .1, 500))) {
    stats.tonnage += row.actualKg * row.totalReps;
    stats.effort = stats.tonnage;
  }
  if (!row.available) { stats.unavailableRows++; stats.complete = false; return; }
  stats.resolvedRepetitions += row.totalReps;
  stats.relativeVolume += row.intensity / 100 * row.totalReps;
  if (row.intensity >= threshold) stats.heavyReps += row.totalReps;
  stats.effort = stats.tonnage; stats.volume = stats.relativeVolume; stats.heavy = stats.heavyReps;
  const index = INTENSITY_BINS.findIndex(bin => row.intensity >= bin.min && row.intensity < bin.max);
  if (index >= 0) stats.intensityDistribution[index].repetitions += row.totalReps;
  stats.meanIntensity = stats.resolvedRepetitions ? stats.relativeVolume / stats.resolvedRepetitions * 100 : null;
}
function mergeStats(entries) {
  const result = emptyStats();
  for (const entry of entries) {
    for (const key of ['sets', 'repetitions', 'heavyReps', 'tonnage', 'relativeVolume', 'resolvedRepetitions', 'unavailableRows']) result[key] += entry[key];
    result.complete &&= entry.complete;
    result.intensityDistribution.forEach((bin, index) => { bin.repetitions += entry.intensityDistribution[index].repetitions; });
    result.rirDistribution.forEach((bin, index) => { bin.sets += entry.rirDistribution[index].sets; bin.repetitions += entry.rirDistribution[index].repetitions; });
  }
  result.meanIntensity = result.resolvedRepetitions ? result.relativeVolume / result.resolvedRepetitions * 100 : null;
  result.effort = result.tonnage; result.volume = result.relativeVolume; result.heavy = result.heavyReps;
  return result;
}
function statsForRows(rows, threshold) {
  const main = emptyStats(), warmup = emptyStats(), total = emptyStats();
  for (const row of rows) {
    addResolved(row.role === 'warmup' ? warmup : main, row, threshold);
    addResolved(total, row, threshold);
  }
  return { main, warmup, total, rows, unavailableRows: total.unavailableRows };
}
function resolvedSessionRows(session, profile, arm) {
  return (session.arms[arm] || []).map(row => resolveRow(row, profile[arm]));
}
export function sessionStats(session, profile, arm, threshold = 85) {
  return statsForRows(resolvedSessionRows(session, profile, arm), threshold);
}
function localDate(timestamp) {
  if (validBlockDate(timestamp)) return timestamp;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function actualWorkloadEntries(workouts, arm) {
  const entries = [];
  for (const workout of workouts) for (const set of workout.sets?.[arm] || []) {
    if (set.status !== 'done' || !integer(set.actualReps, 0, 999) || !finite(set.kg, .1, 500)) continue;
    const date = validBlockDate(workout.date) ? workout.date : localDate(set.completedAt || workout.endedAt || workout.startedAt);
    if (!date) continue;
    // Stored maxima preserve the denominator used when the set was recorded.
    // Never substitute today's profile for an unknown historical denominator.
    const blockMaximum = set.blockMaxKg ?? workout.blockContext?.maxima?.[arm];
    const cycleMaximum = set.cycleMaxKg ?? workout.cycleContext?.maxima?.[arm];
    const maxKg = blockMaximum ?? cycleMaximum;
    // A cycle's growing calculation base can exceed the equipment ceiling.
    const maximumKnown = blockMaximum !== undefined && blockMaximum !== null
      ? validMaximum(blockMaximum) : Number.isFinite(cycleMaximum) && cycleMaximum > 0;
    const relative = maximumKnown ? set.kg / maxKg : null;
    // Tiny corrupt/legacy denominators can overflow despite being positive.
    // Keep absolute recorded work and expose an unknown relative dose instead.
    const hasMax = relative !== null && Number.isFinite(relative * 100)
      && Number.isFinite(relative * set.actualReps);
    entries.push({ date, at: set.completedAt || workout.endedAt || workout.startedAt || date,
      workoutId: workout.id, setId: set.id, pair: `${Math.min(set.i, set.j)}-${Math.max(set.i, set.j)}`, reps: set.actualReps, kg: set.kg,
      role: set.role === 'warmup' ? 'warmup' : 'main', sets: 1, totalReps: set.actualReps,
      actualKg: set.kg, intensity: hasMax ? relative * 100 : null,
      // A prescription is not a reported result: the existing journal does not ask actual RIR.
      available: hasMax, actualOnly: true, maxKg, rir: RIR_KEYS.includes(set.actualRir) ? set.actualRir : 'unknown' });
  }
  return entries;
}
function aggregateSeries(block, byDate) {
  const start = block.start, end = blockEnd(block);
  const daily = datesBetween(start, end).map(date => ({ date, start: date, end: date, ...mergeStats(byDate.get(date) || []) }));
  const weekly = Array.from({ length: block.weeks }, (_, index) => {
    const rows = daily.slice(index * 7, index * 7 + 7);
    return { week: index + 1, date: rows[0].date, start: rows[0].date, end: rows.at(-1).date, ...mergeStats(rows) };
  });
  // Weekly/totals describe the block. Rolling windows include earlier journal
  // dates whenever they fall inside the full inclusive 7/21-calendar-day range.
  const rolling = count => daily.map(entry => {
    const windowStart = addBlockDays(entry.date, 1 - count);
    const rows = datesBetween(windowStart, entry.date).flatMap(date => byDate.get(date) || []);
    return { date: entry.date, start: windowStart, end: entry.date, ...mergeStats(rows) };
  });
  return { start, end, daily, weekly, rolling7: rolling(7), rolling21: rolling(21), totals: mergeStats(daily) };
}
export function blockAnalytics(block, profile, arm, model, workouts = []) {
  const byDate = new Map(), actualByDate = new Map(), warmupByDate = new Map(), actualWarmupByDate = new Map();
  const add = (map, date, stats) => map.set(date, [...map.get(date) || [], stats]);
  for (const session of block.sessions) {
    const stats = sessionStats(session, profile, arm, model.heavyThreshold);
    add(byDate, session.date, stats.main); add(warmupByDate, session.date, stats.warmup);
  }
  for (const entry of actualWorkloadEntries(workouts, arm)) {
    const stats = statsForRows([entry], model.heavyThreshold);
    add(actualByDate, entry.date, stats.main); add(actualWarmupByDate, entry.date, stats.warmup);
  }
  return { ...aggregateSeries(block, byDate), actual: aggregateSeries(block, actualByDate),
    warmup: aggregateSeries(block, warmupByDate), actualWarmup: aggregateSeries(block, actualWarmupByDate) };
}

export function scenarioSeries(block, profile, arm, model, source = 'combined', workouts = [], includeWarmup = false) {
  if (!['plan', 'actual', 'combined'].includes(source)) throw new Error('Неизвестный источник сценария.');
  const options = object(includeWarmup) ? includeWarmup : { includeWarmup };
  const start = options.start || block.start, end = options.end || addBlockDays(blockEnd(block), 21);
  const linkedIds = new Set(workouts.filter(workout => workout.endedAt || workout.date)
    .map(workout => workout.blockSessionId || workout.blockContext?.sessionId).filter(Boolean));
  const planned = [];
  if (source !== 'actual') for (const session of block.sessions) {
    // An explicitly linked completed session replaces its plan even if every set was skipped.
    if (source === 'combined' && linkedIds.has(session.id)) continue;
    planned.push({ date: session.date, rows: resolvedSessionRows(session, profile, arm) });
  }
  const actual = source === 'plan' ? [] : actualWorkloadEntries(workouts, arm);
  return workloadSeries({ start, end, model, planned, actual, includeWarmup: options.includeWarmup });
}

// Planned rows already carry the selected hardware resistance and intensity.
// Recorded rows come from actualWorkloadEntries and keep their saved denominator.
export function workloadSeries({ start, end, model, planned = [], actual = [], includeWarmup = false }) {
  if (!finite(model.volumeHalfLife, .25, 30) || !finite(model.heavyHalfLife, .25, 30)) throw new Error('Проверь периоды полуспада сценария.');
  if (!validBlockDate(start) || !validBlockDate(end) || end < start || dayDifference(start, end) >= 2000) throw new Error('Проверь диапазон сценария.');
  const inputs = new Map();
  const addInput = (date, stats) => inputs.set(date, mergeStats([...(inputs.has(date) ? [inputs.get(date)] : []), stats]));
  for (const { date, rows } of planned) {
    const stats = statsForRows(rows, model.heavyThreshold);
    addInput(date, includeWarmup ? stats.total : stats.main);
  }
  for (const entry of actual) {
    if (includeWarmup || entry.role === 'main') addInput(entry.date, statsForRows([entry], model.heavyThreshold).total);
  }
  const ageDays = date => Math.round((Date.parse(`${start}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / DAY_MS);
  let volume = 0, heavyReps = 0, effort = 0;
  // Retain every earlier impulse when the visible range changes; decay to start-1.
  for (const [date, input] of inputs) if (date < start) {
    const days = ageDays(date) - 1;
    volume += input.relativeVolume * 2 ** (-days / model.volumeHalfLife);
    heavyReps += input.heavyReps * 2 ** (-days / model.heavyHalfLife);
    effort += input.tonnage * 2 ** (-days / model.volumeHalfLife);
  }
  // These are additive workload traces in arbitrary units, not fatigue or recovery predictions.
  // Callers choose the visible horizon and any tail after the final input.
  return datesBetween(start, end).map(date => {
    const input = inputs.get(date), inputVolume = input?.relativeVolume || 0, inputHeavyReps = input?.heavyReps || 0, inputEffort = input?.tonnage || 0;
    volume = volume * 2 ** (-1 / model.volumeHalfLife) + inputVolume;
    heavyReps = heavyReps * 2 ** (-1 / model.heavyHalfLife) + inputHeavyReps;
    effort = effort * 2 ** (-1 / model.volumeHalfLife) + inputEffort;
    return { date, effort, volume, heavyReps, inputEffort, inputVolume, inputHeavyReps, complete: input?.complete ?? true };
  });
}

export function performanceSeries(workouts, arm) {
  const entries = actualWorkloadEntries(workouts, arm).filter(entry => entry.role === 'main' && entry.reps > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || Date.parse(a.at) - Date.parse(b.at)
      || String(a.workoutId).localeCompare(String(b.workoutId)) || String(a.setId).localeCompare(String(b.setId)));
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.workoutId)) groups.set(entry.workoutId, []);
    groups.get(entry.workoutId).push(entry);
  }
  const pairHistory = new Map(), repsHistory = new Map(), result = [];
  for (const group of groups.values()) {
    const bestInGroup = new Map();
    for (const entry of group) {
      const key = `${entry.pair}:${entry.kg}`, history = pairHistory.get(key);
      const previousBestReps = history?.best ?? null;
      const previousBestKg = repsHistory.get(entry.reps) ?? null;
      // A usual range needs at least three previous workouts, using each workout's best
      // repetitions at this exact spring pair/load. It is an observed range, not a forecast.
      const baseline = history?.recent || [];
      const improvedReps = previousBestReps !== null && entry.reps > previousBestReps;
      const improvedKg = previousBestKg !== null && entry.kg > previousBestKg;
      result.push({ date: entry.date, workoutId: entry.workoutId, setId: entry.setId, pair: entry.pair, reps: entry.reps, kg: entry.kg,
        previousBestReps, previousBestKg, improvedReps, improvedKg, improved: improvedReps || improvedKg,
        usualLow: baseline.length >= 3 ? Math.min(...baseline) : null,
        usualHigh: baseline.length >= 3 ? Math.max(...baseline) : null, baselineCount: baseline.length });
      bestInGroup.set(key, Math.max(bestInGroup.get(key) || 0, entry.reps));
    }
    for (const [key, reps] of bestInGroup) {
      const history = pairHistory.get(key);
      pairHistory.set(key, { best: Math.max(history?.best || 0, reps), recent: [...history?.recent || [], reps].slice(-5) });
    }
    for (const entry of group) repsHistory.set(entry.reps, Math.max(repsHistory.get(entry.reps) || 0, entry.kg));
  }
  return result;
}
