import test from 'node:test';
import assert from 'node:assert/strict';
import { createCycle, cyclePlan, getCycleSession } from '../js/cycle-model.js';
import { PAIRS, validateBackup, validActiveWorkout } from '../js/workout-model.js';
import { saveCycle, mergeBackup } from '../js/workout-db.js';

const timestamp = '2026-11-05T10:00:00.000Z';
const backup = endlessCycle => ({ format: 'hvat-backup', version: 3, data: {
  templates: [], workouts: [], manualRecords: [], active: null, progressions: [],
  pendingImports: [], settings: { sound: false }, ...(endlessCycle === undefined ? {} : { endlessCycle }),
} });
const activeWorkout = cycle => {
  const plan = cyclePlan(cycle), session = getCycleSession(cycle);
  return { id: crypto.randomUUID(), title: 'Цикл', startedAt: timestamp, restSec: 0, restUntil: null,
    initialPlan: structuredClone(plan), sets: structuredClone(plan), cycleId: cycle.id,
    cycleRevision: cycle.revision, cycleWeek: cycle.week, cycleDay: cycle.day,
    cycleContext: { label: session.label, light: session.light,
      maxima: Object.fromEntries(['right','left'].map(arm => [arm, plan[arm][0].cycleMaxKg])) } };
};

test('v3 backup roundtrip preserves the endless cycle, history and empty legacy state', () => {
  const cycle = createCycle({ right: 100, left: 80 }), raw = backup(cycle), pair = PAIRS[20];
  raw.data.manualRecords.push({ id: 'record', arm: 'right', ...pair, reps: 1, recordedAt: timestamp });
  const result = validateBackup(JSON.parse(JSON.stringify(raw)));
  assert.deepEqual(result.endlessCycle, cycle);
  assert.deepEqual(result.manualRecords, raw.data.manualRecords);
  assert.deepEqual(result.settings, { sound: false });
  assert.equal(validateBackup(backup()).endlessCycle, null);
  assert.equal(validateBackup(backup(null)).endlessCycle, null);
  result.endlessCycle.initialMaxima.right = 50;
  assert.equal(cycle.initialMaxima.right, 100);
});

test('active and completed cycle journal records retain cursor and calculated maximum snapshots', () => {
  const cycle = createCycle({ right: 100, left: 80 }), active = activeWorkout(cycle), raw = backup(cycle);
  assert.equal(validActiveWorkout(active), true);
  raw.data.active = active;
  assert.deepEqual(validateBackup(raw).active.cycleContext, active.cycleContext);
  const workout = { ...structuredClone(active), endedAt: timestamp, partial: false };
  for (const arm of ['right','left']) workout.sets[arm].forEach(set => {
    set.status = 'done'; set.actualReps = set.reps; set.completedAt = timestamp;
  });
  raw.data.workouts.push(workout);
  const cleaned = validateBackup(raw).workouts[0];
  assert.equal(cleaned.cycleId, cycle.id);
  assert.equal(cleaned.cycleRevision, cycle.revision);
  assert.equal(cleaned.cycleDay, cycle.day);
  assert.equal(cleaned.sets.right[0].cycleMaxKg, active.cycleContext.maxima.right);
  // A growing calculation base may exceed the physical resistance ceiling.
  workout.sets.right[0].cycleMaxKg = 150;
  assert.equal(validateBackup(raw).workouts[0].sets.right[0].cycleMaxKg, 150);
});

test('backups preserve legacy cycle warmups in active, pending and finished workouts', () => {
  const cycle = createCycle({ right: 100, left: 80 }), active = activeWorkout(cycle), raw = backup(cycle);
  const pair = PAIRS.find(value => value.kg === 27.7);
  const warmup = { ...active.initialPlan.right[0], ...pair, id: 'legacy-warmup', plannedSetId: 'legacy-warmup',
    role: 'warmup', cycleRole: 'warmup', cyclePercent: .30, reps: 5, restSec: 90 };
  active.initialPlan.right.unshift(warmup);
  const performed = { ...warmup, status: 'done', actualReps: 5, completedAt: timestamp };
  active.sets.right.unshift(performed);
  raw.data.active = active;
  raw.data.pendingImports = [{ ...structuredClone(active), id: 'legacy-pending' }];
  const finished = { ...structuredClone(active), id: 'legacy-finished', endedAt: timestamp, partial: true };
  finished.sets = { right: [performed], left: [] };
  raw.data.workouts = [finished];

  const restored = validateBackup(JSON.parse(JSON.stringify(raw)));
  for (const workout of [restored.active, restored.pendingImports[0], restored.workouts[0]]) {
    assert.deepEqual(workout.initialPlan.right[0], warmup);
    assert.deepEqual(workout.sets.right[0], performed);
  }
});

test('backup validates foreign cycle fields on active, pending and completed workouts', () => {
  const cycle = createCycle({ right: 100, left: 80 });
  const invalidChanges = [
    value => { value.cycleId = 'bad id'; },
    value => { value.cycleRevision = -1; },
    value => { value.cycleWeek = 0; },
    value => { value.cycleDay = 3; },
    value => { value.cycleContext.light = 'true'; },
    value => { value.cycleContext.maxima.right = NaN; },
    value => { value.cycleContext.maxima.left = -1; },
    value => { value.cycleContext.label = null; },
    value => { value.blockId = 'block'; value.blockSessionId = 'session'; },
    value => { value.sets.right[0].cycleMaxKg = 0; },
    value => { value.initialPlan.right[0].cyclePercent = Infinity; },
    value => { value.sets.right[0].cycleRole = 'invalid'; },
    value => { value.sets.right[0].cycleGroup = -1; },
    value => { value.sets.right[0].cycleId = 'bad id'; },
    value => { value.sets.right[0].cycleWeek = 0; },
    value => { value.sets.right[0].cycleDay = 0; },
    value => { value.sets.right[0].cycleRevision = -1; },
  ];
  for (const change of invalidChanges) {
    const active = activeWorkout(cycle); change(active);
    const raw = backup(cycle); raw.data.active = active;
    assert.throws(() => validateBackup(raw));
    raw.data.active = null; raw.data.pendingImports = [active];
    assert.throws(() => validateBackup(raw));
    const workout = { ...structuredClone(active), endedAt: timestamp, partial: false };
    for (const arm of ['right','left']) workout.sets[arm].forEach(set => Object.assign(set, { status: 'done', actualReps: set.reps, completedAt: timestamp }));
    raw.data.pendingImports = []; raw.data.workouts = [workout];
    assert.throws(() => validateBackup(raw));
  }
  const orphan = activeWorkout(cycle); delete orphan.cycleId;
  assert.equal(validActiveWorkout(orphan), false);
});

test('invalid cycle persistence and import fail before any IndexedDB transaction', async () => {
  const cycle = createCycle({ right: 100, left: 80 }), invalid = structuredClone(cycle);
  invalid.initialMaxima.right = 0;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  let opened = 0;
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() {
    opened++; throw new Error('Invalid data must not access storage');
  } });
  try {
    assert.throws(() => validateBackup(backup(invalid)));
    assert.throws(() => saveCycle(invalid));
    await assert.rejects(mergeBackup(backup(invalid).data));
    const invalidWorkout = backup(cycle); invalidWorkout.data.active = activeWorkout(cycle);
    invalidWorkout.data.active.cycleRevision = NaN;
    await assert.rejects(mergeBackup(invalidWorkout.data));
    assert.equal(opened, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    else delete globalThis.indexedDB;
  }
});
