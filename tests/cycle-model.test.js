import test from 'node:test';
import assert from 'node:assert/strict';
import { PAIRS, validActiveWorkout } from '../js/workout-model.js';
import { createCycle, validateCycle, getCycleWeek, getCycleSession, transitionCycle, cyclePlan } from '../js/cycle-model.js';

const at = '2026-11-05T12:00:00.000Z';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const make = () => createCycle({ right: 100, left: 80 }, at);
const move = (cycle, count) => { for (let i = 0; i < count; i++) cycle = transitionCycle(cycle, { type: 'advance' }, at); return cycle; };

test('two independent maxima generate every row of20weeks and restart atweek21 without a calendar cap', () => {
  const cycle = make();
  const rightHeavy = [74.9,79.9,84.9,90.6,59.6,76.7,79.9,84.9,90.6,62.1,76.7,83.9,88.8,93.7,63.9,79.9,84.9,90.6,97,65];
  for (let week = 1; week <= 21; week++) {
    const result = getCycleWeek(cycle, week), phase = (week - 1) % 5;
    assert.equal(result.phase, phase); assert.equal(result.sessions.length, 2);
    close(result.maxima.right, 100 * 1.005 ** (week - 1)); close(result.maxima.left, 80 * 1.005 ** (week - 1));
    if (week <= 20) assert.equal(result.sessions[0].arms.right.find(row => row.role === 'main').pair.kg, rightHeavy[week - 1]);
    for (const session of result.sessions) for (const arm of ['right', 'left']) {
      const groups = session.arms[arm];
      assert.deepEqual(groups.map(row => row.role), session.day === 1 && !result.light ? ['main', 'backoff'] : ['main']);
      for (const row of groups) {
        assert.equal(row.targetKg, result.maxima[arm] * row.percent);
        if (row.pair) { const index = PAIRS.findIndex(pair => pair.i === row.pair.i && pair.j === row.pair.j); assert.ok(row.pair.kg <= row.targetKg); assert.ok(!PAIRS[index + 1] || PAIRS[index + 1].kg > row.targetKg); }
      }
    }
  }
  const next = getCycleWeek(cycle, 21);
  assert.equal(next.label, '5×5'); close(next.maxima.right, 110.48955771867284);
  assert.equal(next.sessions[0].arms.right.find(row => row.role === 'main').pair.kg, 82.5);
  assert.equal(getCycleWeek(cycle, 100).week, 100);
  const changed = transitionCycle(cycle, { type: 'maxima', right: 90, left: 80 }, at);
  assert.deepEqual(getCycleWeek(changed, 20).sessions[0].arms.left, getCycleWeek(cycle, 20).sessions[0].arms.left);
});
test('light weeks lower both days, omit backoff, and still increase the weekly base', () => {
  for (const week of [5, 10, 15, 20]) {
    const data = getCycleWeek(make(), week), [one, two] = data.sessions;
    assert.equal(data.light, true);
    assert.deepEqual(one.arms.right.map(group => [group.role, group.sets, group.reps, group.percent, group.restSec]), [['main', 2, 5, .6, 120]]);
    assert.deepEqual(two.arms.right.map(group => [group.role, group.sets, group.reps, group.percent, group.restSec]), [['main', 2, 10, .55, 120]]);
    assert.ok(data.maxima.right > getCycleWeek(make(), week - 1).maxima.right);
  }
});
test('strict floor does not round the target near 93.7 or 76.6', () => {
  const cycle = make();
  const main = getCycleSession(cycle, 9, 1).arms.right.find(group => group.role === 'main');
  close(main.targetKg, 93.66363395328936); assert.equal(main.pair.kg, 90.6);
  assert.equal(getCycleSession(cycle, 19, 1).arms.right.find(group => group.role === 'backoff').pair.kg, 75.1);
});
test('belowminimum isunavailable; aboveceiling keeps prescribedsets/reps and highestpair withwarning', () => {
  const low = createCycle({ right: 20, left: 80 }, at), unavailable = getCycleSession(low);
  assert.equal(unavailable.available, false); assert.equal(unavailable.arms.right[0].pair, null);
  assert.throws(() => cyclePlan(low), /доступны/);
  const usable = createCycle({ right: 26, left: 80 }, at);
  assert.equal(getCycleSession(usable, 1, 1).available, true);
  assert.equal(getCycleSession(usable, 1, 2).available, true);
  const high = getCycleSession(make(), 200, 1);
  const main = high.arms.right.find(group => group.role === 'main');
  assert.equal(high.available, true); assert.equal(main.pair.kg, 120.4); assert.ok(main.warning);
  assert.equal(main.sets, 2); assert.equal(main.reps, 5);
});
test('advance and skip advance trainingday, changingweek onlyafterday2', () => {
  const original = make(), one = transitionCycle(original, { type: 'skip' }, '2027-06-01T12:00:00Z');
  assert.equal(one.week, 1); assert.equal(one.day, 2);
  const two = transitionCycle(one, { type: 'advance' }, '2028-06-01T12:00:00Z');
  assert.equal(two.week, 2); assert.equal(two.day, 1); close(getCycleWeek(two).maxima.right, 100.5);
  assert.equal(original.day, 1); assert.equal(original.events.length, 0);
  assert.deepEqual(two.events[1].from, { week: 1, day: 2 }); assert.deepEqual(two.events[1].to, { week: 2, day: 1 });
  assert.equal(two.revision, 2);
});
test('pause/resume andreturn0 do not advance cursor or grow maximum aftercalendar gaps', () => {
  const cycle = move(make(), 7), paused = transitionCycle(cycle, { type: 'pause' }, at);
  assert.equal(paused.week, 4); assert.equal(paused.day, 2); assert.equal(paused.status, 'paused');
  assert.throws(() => transitionCycle(paused, { type: 'advance' }, at), /приостановлен/);
  assert.throws(() => transitionCycle(paused, { type: 'skip' }, at), /приостановлен/);
  assert.throws(() => cyclePlan(paused), /приостановлен/);
  const resumed = transitionCycle(paused, { type: 'resume' }, '2030-01-01T12:00:00Z');
  assert.equal(resumed.week, 4); assert.equal(resumed.day, 2);
  close(getCycleWeek(resumed).maxima.right, getCycleWeek(paused).maxima.right);
  const returned = transitionCycle(paused, { type: 'return', weeksBack: 0 }, at);
  assert.equal(returned.week, 4); assert.equal(returned.day, 2); assert.equal(returned.status, 'active');
});
test('return>0 restartsday1,clampsatweek1,andretains auditevents and previousobjects', () => {
  const original = move(make(), 11), one = transitionCycle(original, { type: 'return', weeksBack: 2 }, at);
  assert.equal(original.week, 6); assert.equal(original.day, 2);
  assert.equal(one.week, 4); assert.equal(one.day, 1); assert.equal(one.events.length, original.events.length + 1);
  const first = transitionCycle(one, { type: 'return', weeksBack: 999 }, at);
  assert.equal(first.week, 1); assert.equal(first.day, 1);
  assert.deepEqual(first.events.slice(0, original.events.length), original.events);
});
test('validation rejects brokenmaxima,cursors,revision,eventchains,andactions', () => {
  const changes = [value => { value.initialMaxima.right = null; }, value => { value.initialMaxima.left = 120.5; },
    value => { value.initialMaxima.right = NaN; }, value => { value.week = 0; }, value => { value.day = 3; },
    value => { value.revision = 1; }, value => { value.status = 'done'; }, value => { value.createdAt = 'bad'; }];
  for (const change of changes) { const value = make(); change(value); assert.throws(() => validateCycle(value)); }
  const changed = move(make(), 2); changed.events[1].from.day = 1;
  assert.throws(() => validateCycle(changed));
  assert.throws(() => createCycle({ right: 100, left: 0 }, at));
  assert.throws(() => transitionCycle(make(), { type: 'return', weeksBack: -.1 }, at));
  assert.throws(() => transitionCycle(make(), { type: 'maxima', right: 100, left: Infinity }, at));
  assert.throws(() => getCycleWeek(make(), 1.5)); assert.throws(() => getCycleSession(make(), 1, 0));
  const copy = validateCycle(make()); copy.initialMaxima.left = 90; assert.equal(make().initialMaxima.left, 80);
});
test('journal plan starts with working sets, uses fresh IDs and freezes maxima', () => {
  const cycle = make(), plan = cyclePlan(cycle), again = cyclePlan(cycle);
  assert.equal(plan.right.length, 6); assert.equal(plan.left.length, 6);
  assert.equal(plan.right.reduce((sum, set) => sum + set.reps, 0), 35);
  assert.equal(plan.right[0].cycleRole, 'main'); assert.equal(plan.right[0].restSec, 240);
  assert.equal(plan.right.at(-1).cycleRole, 'backoff'); assert.equal(plan.right.at(-1).role, 'main');
  assert.equal(plan.right.at(-1).cyclePercent, .7); assert.equal(plan.right.at(-1).restSec, 120);
  assert.equal(plan.left[0].cycleMaxKg, 80);
  assert.ok(plan.right.every(set => set.plannedSetId === set.id && set.status === 'pending' && set.role === 'main'));
  assert.equal(new Set([...plan.right,...plan.left,...again.right,...again.left].map(set => set.id)).size, 24);
  const volume = cyclePlan(move(cycle, 1));
  assert.equal(volume.right.length, 4);
  assert.ok(volume.right.every(set => set.role === 'main' && set.reps === 10 && set.restSec === 150));
  const active = { id: 'active', title: 'Цикл', startedAt: at, restSec: 0, initialPlan: plan, sets: structuredClone(plan), restUntil: null };
  assert.equal(validActiveWorkout(active), true);
  const before = structuredClone(plan), changed = transitionCycle(cycle, { type: 'maxima', right: 90, left: 70 }, at);
  assert.equal(getCycleSession(changed).maxima.right, 90); assert.deepEqual(plan, before);
});
