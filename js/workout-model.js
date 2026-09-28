import { doubleForce, isValidDouble } from './formulas.js';

export const ARMS = Object.freeze(['right', 'left']);
export const ARM_LABELS = Object.freeze({ right: 'Правая', left: 'Левая' });
export const BACKUP_FORMAT = 'hvat-backup';
export const BACKUP_VERSION = 2;

export const PAIRS = Object.freeze((() => {
  const pairs = [];
  for (let i = 1; i <= 12; i += 1) {
    for (let j = i + 1; j <= 12; j += 1) {
      if (isValidDouble(i, j)) pairs.push({ i, j, kg: Number(doubleForce(i, j).toFixed(1)) });
    }
  }
  return pairs.sort((a, b) => a.kg - b.kg || a.i - b.i);
})());

export function newId() {
  return crypto.randomUUID();
}

export function pairFor(i, j) {
  const a = Math.min(Number(i), Number(j));
  const b = Math.max(Number(i), Number(j));
  return PAIRS.find((pair) => pair.i === a && pair.j === b) || null;
}

export function makeSet(pair = PAIRS[Math.floor(PAIRS.length / 2)], reps = 5) {
  return { id: newId(), i: pair.i, j: pair.j, kg: pair.kg, reps, status: 'pending' };
}

export function createPlan() {
  return { right: [makeSet()], left: [makeSet()] };
}

export function copyPlan(sets, useActual = false) {
  return Object.fromEntries(ARMS.map((arm) => [arm, (sets[arm] || []).map((set) => ({
    id: newId(), i: set.i, j: set.j, kg: set.kg ?? pairFor(set.i, set.j).kg,
    reps: useActual ? Math.max(1,set.actualReps || set.reps) : set.reps, status: 'pending',
  }))]));
}

export function nextPending(sets) {
  for (const arm of ARMS) {
    const index = sets[arm].findIndex((set) => set.status === 'pending');
    if (index !== -1) return { arm, index, set: sets[arm][index] };
  }
  return null;
}

export function completedSets(sets) {
  return Object.fromEntries(ARMS.map((arm) => [arm, sets[arm].filter((set) => set.status === 'done')]));
}

export function repeatFromHistory(workout) {
  if (!ARMS.some(a=>workout.sets[a].length || workout.initialPlan[a].length)) return null;
  return Object.fromEntries(ARMS.map(arm=>{
    const done=workout.sets[arm].filter(s=>s.status==='done');
    return [arm,copyPlan({[arm]:done.length?done:workout.initialPlan[arm]},!!done.length)[arm]];
  }));
}

export function calculateRecords(workouts, manualRecords) {
  const entries = [];
  for (const record of manualRecords) {
    entries.push({ id: record.id, arm: record.arm, reps: 1, kg: record.kg,
      i: record.i, j: record.j, at: record.recordedAt, source: 'manual' });
  }
  for (const workout of workouts) {
    for (const arm of ARMS) {
      for (const set of workout.sets[arm]) {
        if (set.status === 'done' && !['invalid','assisted'].includes(set.quality) && set.actualReps >= 1 && set.actualReps <= 10) {
          entries.push({ id: `${workout.id}:${set.id}`, arm, reps: set.actualReps,
            kg: set.kg, i: set.i, j: set.j, at: set.completedAt || workout.endedAt,
            source: 'workout', workoutId: workout.id });
        }
      }
    }
  }
  entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  const best = { right: Array(11).fill(null), left: Array(11).fill(null) };
  const events = [];
  for (const entry of entries) {
    const old = best[entry.arm][entry.reps];
    if (!old || entry.kg > old.kg) {
      best[entry.arm][entry.reps] = entry;
      events.push(entry);
    }
  }
  return { best, events: events.reverse() };
}

function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,120}$/.test(value); }
function validDate(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function validRest(value) { return Number.isInteger(value) && value >= 0 && value <= 3600; }
function validSet(set, completed = false) {
  return set && validId(set.id) && pairFor(set.i, set.j)
    && Number.isInteger(set.reps) && set.reps >= 1 && set.reps <= 999
    && (completed ? ['done','skipped'].includes(set.status) : set.status === 'pending')
    && (!completed || set.status === 'skipped' || (Number.isInteger(set.actualReps) && set.actualReps >= 0
      && set.actualReps <= 999 && validDate(set.completedAt)))
    && (set.restSec === undefined || validRest(set.restSec))
    && (set.quality === undefined || ['valid','unknown','invalid','assisted'].includes(set.quality));
}
function validPlan(plan, completed = false, allowEmpty = false) {
  return plan && ARMS.every((arm) => Array.isArray(plan[arm])
    && (allowEmpty || plan[arm].length > 0) && plan[arm].every((set) => validSet(set, completed)));
}
function validActivePlan(plan) {
  return plan && ARMS.some(arm=>plan[arm]?.length) && ARMS.every((arm) => Array.isArray(plan[arm])
    && plan[arm].every((set) => validSet(set, set.status !== 'pending')))
    && (!plan.left.some((set) => set.status === 'done')
      || !plan.right.some((set) => set.status === 'pending'));
}
export function validActiveWorkout(active) {
  return active && validId(active.id) && typeof active.title === 'string' && active.title.length<=100
    && validDate(active.startedAt) && validRest(active.restSec) && validPlan(active.initialPlan,false,true)
    && validActivePlan(active.sets) && (active.restUntil===null || Number.isFinite(active.restUntil));
}

export function validateBackup(raw) {
  if (!raw || raw.format !== BACKUP_FORMAT || ![1,2].includes(raw.version) || !raw.data) {
    throw new Error('Неизвестный формат или версия резервной копии.');
  }
  const { templates, workouts, manualRecords, active, settings } = raw.data;
  if (![templates, workouts, manualRecords].every(Array.isArray) || !settings || typeof settings !== 'object') {
    throw new Error('В резервной копии не хватает данных.');
  }
  if (!templates.every((item) => item && validId(item.id) && typeof item.name === 'string'
      && item.name.trim().length > 0 && item.name.length <= 100 && validRest(item.restSec)
      && validPlan(item.sets))) throw new Error('В копии есть повреждённый шаблон.');
  if (!workouts.every((item) => item && validId(item.id) && typeof item.title === 'string'
      && item.title.length <= 100 && validDate(item.startedAt)
      && validDate(item.endedAt) && validRest(item.restSec) && validPlan(item.initialPlan,false,true)
      && validPlan(item.sets, true, true)
      && ARMS.some(a=>item.sets[a].length > 0))) throw new Error('В копии есть повреждённая тренировка.');
  if (!manualRecords.every((item) => item && validId(item.id) && ARMS.includes(item.arm)
      && pairFor(item.i, item.j) && validDate(item.recordedAt))) {
    throw new Error('В копии есть повреждённый ручной рекорд.');
  }
  if (active !== null && active !== undefined && !validActiveWorkout(active)) {
    throw new Error('В копии есть повреждённая активная тренировка.');
  }
  if(raw.version===2&&raw.data.pendingImports!==undefined&&(!Array.isArray(raw.data.pendingImports)||!raw.data.pendingImports.every(validActiveWorkout)))throw new Error('Повреждено сохранённое импортированное занятие.');
  const cleanSet = (set) => ({ ...set, kg: set.calcVersion && Number.isFinite(set.kg) ? set.kg : pairFor(set.i, set.j).kg });
  const cleanPlan = (plan) => Object.fromEntries(ARMS.map((arm) => [arm, plan[arm].map(cleanSet)]));
  return {
    progressions: raw.version === 2 ? (raw.data.progressions || []) : [],
    pendingImports: raw.version === 2 ? (raw.data.pendingImports || []) : [],
    templates: templates.map((item) => ({ ...item, sets: cleanPlan(item.sets) })),
    workouts: workouts.map((item) => ({ ...item, initialPlan: cleanPlan(item.initialPlan), sets: cleanPlan(item.sets) })),
    manualRecords: manualRecords.map((item) => ({ ...item, kg: pairFor(item.i, item.j).kg })),
    active: active ? { ...active, initialPlan: cleanPlan(active.initialPlan), sets: cleanPlan(active.sets) } : null,
    settings: { sound: settings.sound !== false },
  };
}
