import test from 'node:test';
import assert from 'node:assert/strict';
import { PAIRS } from '../js/workout-model.js';
import { addBlockDays, createWorkspace, scenarioSeries } from '../js/block-model.js';
import { createCycle, getCycleSession, transitionCycle } from '../js/cycle-model.js';
import { cycleLoadSeries } from '../js/cycle-charts-model.js';

const today = '2026-11-06';
const model = createWorkspace().model;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const make = (maxima = { right: 100, left: 80 }) => createCycle(maxima, `${today}T12:00:00Z`);
function move(cycle, sessions) {
  for (let index = 0; index < sessions; index++) cycle = transitionCycle(cycle, { type: 'skip' }, `${today}T12:00:00Z`);
  return cycle;
}
function recorded(cycle, date, { role = 'main', reps = 3, maximum = 150 } = {}) {
  const completedAt = `${date}T12:00:00Z`;
  const pair = PAIRS.find(candidate => candidate.kg === 90.6);
  return { cycleId: cycle.id, endedAt: completedAt, sets: { right: [
    { ...pair, role, actualReps: reps, status: 'done', completedAt, cycleMaxKg: maximum },
  ], left: [] } };
}

test('cycle plan projects 26 whole training weeks at two doses per week without changing the cursor', () => {
  const cycle = move(make(), 5);
  assert.equal(cycle.day, 2);
  const before = structuredClone(cycle);
  const right = cycleLoadSeries({ cycle, model, arm: 'right', source: 'plan', today });
  assert.equal(right.firstWeek, 3);
  assert.equal(right.lastWeek, 28);
  assert.equal(right.series.length, 182);
  assert.equal(right.hasTrace, true);
  assert.equal(right.series[0].week, 3);
  assert.equal(right.series.at(-1).week, 28);
  assert.equal(right.series.filter(point => point.inputVolume > 0).length, 52);
  assert.ok(right.series.filter(point => point.inputVolume > 0).every(point => [1, 4].includes(point.trainingDay)));
  close(right.series[0].inputVolume, (84.9 * 9 + 69.1 * 20) / (100 * 1.005 ** 2));
  assert.equal(right.series[0].inputHeavyReps, 0);
  assert.equal(right.series[7].inputHeavyReps, 4);
  const left = cycleLoadSeries({ cycle, model, arm: 'left', source: 'plan', today });
  assert.notEqual(left.series[0].inputVolume, right.series[0].inputVolume);
  assert.deepEqual(cycle, before);
});

test('cycle and block yield the same trace for matching working sets', () => {
  const cycle = make();
  const profile = { right: { maxKg: 100 } };
  const row = (role, value, sets, reps) => ({ role, mode: 'kg', value, sets, reps });
  const block = { start: today, weeks: 1, sessions: [
    { date: today, arms: { right: [row('warmup', 27.7, 1, 5), row('warmup', 49.3, 1, 3), row('warmup', 65, 1, 1),
      row('main', 74.9, 5, 5), row('main', 69.1, 1, 10)] } },
    { date: addBlockDays(today, 3), arms: { right: [row('warmup', 27.7, 1, 8), row('warmup', 42.3, 1, 5), row('main', 65, 4, 10)] } },
  ] };
  const settings = { ...model, heavyThreshold: 70 };
  const planned = cycleLoadSeries({ cycle, model: settings, arm: 'right', today });
  const blockSeries = scenarioSeries(block, profile, 'right', settings, 'plan', [], { end: addBlockDays(today, 6) });
  const cycleSeries = planned.series.slice(0, 7).map(({ week, trainingDay, ...point }) => point);
  assert.deepEqual(cycleSeries, blockSeries);
});

test('plan keeps the equipment cap and still normalizes by the growing calculation maximum', () => {
  const cycle = move(make({ right: 120.4, left: 100 }), 120);
  const maximum = 120.4 * 1.005 ** 60;
  const groups = getCycleSession(cycle).arms.right;
  const main = groups.find(group => group.role === 'main');
  const backoff = groups.find(group => group.role === 'backoff');
  assert.ok(main.targetKg > 120.4);
  assert.equal(main.pair.kg, 120.4);
  const point = cycleLoadSeries({ cycle, model, arm: 'right', today }).series[0];
  close(point.inputVolume, (120.4 * 25 + backoff.pair.kg * 10) / maximum);
  assert.equal(point.inputHeavyReps, 0);
  assert.equal(point.complete, true);
});

test('fact starts at the earliest visible date and carries over earlier loads of the same cycle', () => {
  const cycle = make();
  const windowStart = addBlockDays(today, -181);
  const priorDate = addBlockDays(windowStart, -1);
  const firstDate = addBlockDays(windowStart, 3);
  const prior = recorded(cycle, priorDate, { reps: 2, maximum: 100 });
  const first = recorded(cycle, firstDate);
  const future = recorded(cycle, addBlockDays(today, 1));
  const other = recorded(make(), windowStart);
  const workouts = [future, other, first, prior];
  const fact = cycleLoadSeries({ cycle, model, arm: 'right', source: 'actual', workouts, today });
  assert.equal(fact.firstWeek, null);
  assert.equal(fact.lastWeek, null);
  assert.equal(fact.hasTrace, true);
  assert.equal(fact.series[0].date, firstDate);
  assert.equal(fact.series.at(-1).date, today);
  assert.equal(fact.series.filter(point => point.inputVolume > 0).length, 1);
  close(fact.series[0].inputVolume, 90.6 / 150 * 3);
  close(fact.series[0].volume, 90.6 / 150 * 3 + 90.6 / 100 * 2 * 2 ** (-4 / model.volumeHalfLife));
  close(fact.series[0].heavyReps, 2 * 2 ** (-4 / model.heavyHalfLife));
  const changed = transitionCycle(cycle, { type: 'maxima', right: 90, left: 70 }, `${today}T13:00:00Z`);
  assert.deepEqual(cycleLoadSeries({ cycle: changed, model, arm: 'right', source: 'actual', workouts, today }), fact);
});

test('actual graph ignores legacy warmups and shows no fact for zero visible input', () => {
  const cycle = make();
  const firstDate = addBlockDays(today, -181);
  const tooOld = recorded(cycle, addBlockDays(today, -182));
  const warmup = recorded(cycle, firstDate, { role: 'warmup' });
  const data = { cycle, model, arm: 'right', source: 'actual', workouts: [tooOld, warmup], today };
  assert.deepEqual(cycleLoadSeries(data), { series: [], firstWeek: null, lastWeek: null, hasTrace: false });
  const work = recorded(cycle, firstDate);
  const fact = cycleLoadSeries({ ...data, workouts: [tooOld, warmup, work] });
  assert.equal(fact.series.length, 182);
  assert.equal(fact.series[0].date, firstDate);
  assert.equal(fact.hasTrace, true);
  assert.deepEqual(fact, cycleLoadSeries({ ...data, workouts: [tooOld, work] }));
  assert.equal(cycleLoadSeries({ ...data, arm: 'left', workouts: [work] }).hasTrace, false);
  const zero = cycleLoadSeries({ ...data, workouts: [tooOld, recorded(cycle, today, { reps: 0 })] });
  assert.equal(zero.series.length, 1);
  assert.equal(zero.series[0].inputVolume, 0);
  assert.equal(zero.hasTrace, false);
});
