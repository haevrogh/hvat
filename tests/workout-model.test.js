import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAIRS, calculateRecords, copyPlan, createPlan, repeatFromHistory, validateBackup,
} from '../js/workout-model.js';

const at = '2026-09-27T12:00:00.000Z';
const later = '2026-09-28T12:00:00.000Z';
const pair = PAIRS[20];
const nextPair = PAIRS[21];
const done = (id, reps, kgPair = pair, completedAt = at) => ({
  id, i: kgPair.i, j: kgPair.j, kg: kgPair.kg,
  reps, actualReps: reps, status: 'done', completedAt,
});

test('all training weights are valid, unique double-spring pairs', () => {
  assert.equal(PAIRS.length, 55);
  assert.equal(new Set(PAIRS.map((item) => item.kg)).size, PAIRS.length);
  assert.ok(PAIRS.every((item) => item.j - item.i >= 2));
});

test('a plan always starts with one set per arm', () => {
  const plan = createPlan();
  assert.equal(plan.right.length, 1);
  assert.equal(plan.left.length, 1);
  assert.notEqual(plan.right[0].id, plan.left[0].id);
});

test('repeat uses actual sets and fills a missing left arm from original plan', () => {
  const original = { right: [done('pr', 5)], left: [done('pl', 6, nextPair)] };
  const partial = { sets: { right: [done('r', 7)], left: [] }, initialPlan: original };
  const repeated = repeatFromHistory(partial);
  assert.equal(repeated.right[0].reps, 7);
  assert.equal(repeated.left[0].reps, 6);
  assert.equal(repeated.left[0].kg, nextPair.kg);
  const full = { sets: { right: [done('r', 7)], left: [done('l', 8)] }, initialPlan: original };
  assert.equal(repeatFromHistory(full).left[0].reps, 8);
  assert.notEqual(repeated.right[0].id, partial.sets.right[0].id);
});

test('records require exact repetitions and strict weight improvement', () => {
  const workouts = [
    { id: 'w1', endedAt: at, sets: { right: [done('a', 2)], left: [done('b', 1)] } },
    { id: 'w2', endedAt: later, sets: { right: [done('c', 2, nextPair, later), done('d', 3, nextPair, later)], left: [] } },
  ];
  const result = calculateRecords(workouts, []);
  assert.equal(result.best.right[2].kg, nextPair.kg);
  assert.equal(result.best.right[1], null);
  assert.equal(result.best.right[3].kg, nextPair.kg);
  assert.equal(result.best.left[1].kg, pair.kg);
  assert.equal(result.events.length, 4);
});

test('backup rejects invalid format and damaged arm plans', () => {
  assert.throws(() => validateBackup({}), /формат/);
  const plan = copyPlan(createPlan());
  const raw = { format: 'hvat-backup', version: 1, data: {
    templates: [{ id: 't', name: 'Тест', restSec: 90, sets: plan }],
    workouts: [], manualRecords: [], active: null, settings: { sound: true },
  } };
  assert.equal(validateBackup(raw).templates.length, 1);
  raw.data.templates[0].sets.left = [];
  assert.throws(() => validateBackup(raw), /шаблон/);
});
