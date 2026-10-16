import test from 'node:test';
import assert from 'node:assert/strict';
import { ARMS, PAIRS, calculateRecords, validateBackup, BACKUP_VERSION } from '../js/workout-model.js';
import { allocatePeriods, generateCalendar, weeklyBase, idealLoad, fitLoad, createProgression, defaultArm, clone, applyWorkout, skipSlot, stopControlAttempts, loadStats, addDays } from '../js/progression-model.js';
import { validateProgressions, copyProgressionGraph } from '../js/progression-backup.js';
import { PERIODS } from '../js/progression-presets.js';

const config = (weeks = 12, right = 100, left = 80) => ({ name: 'Подготовка', targetDate: '2027-10-03', weeks,
  arms: { right: { ...defaultArm(), base: right, baseConfirmed: true }, left: { ...defaultArm(), base: left, baseConfirmed: true } } });
const at = '2026-10-04T12:00:00.000Z';
const finish = (p, index = 0, fail = false) => {
  const slot = p.slots[index], sets = clone(slot.plan);
  for (const arm of ARMS) sets[arm].forEach(s => Object.assign(s, { status: 'done', actualReps: fail ? Math.max(0, s.reps - 1) : s.reps, completedAt: at }));
  return { id: crypto.randomUUID(), title: p.name, startedAt: at, endedAt: at, restSec: 0, partial: false,
    progressionId: p.id, plannedSessionId: slot.id, initialPlan: clone(slot.plan), sets };
};
const backup = (program, workouts = [], active = null) => ({ format: 'hvat-backup', version: BACKUP_VERSION,
  data: { templates: [], manualRecords: [], workouts, progressions: [program], active, settings: { sound: false }, pendingImports: [] } });

test('every duration allocates four positive consecutive periods and three sessions per week', () => {
  for (let weeks = 4; weeks <= 52; weeks++) {
    const lengths = allocatePeriods(weeks), p = createProgression(config(weeks));
    assert.equal(lengths.reduce((a, b) => a + b), weeks);
    assert.ok(lengths.every(n => n >= 1));
    if (weeks >= 26) lengths.forEach((n, i) => assert.ok(n >= PERIODS[i].min && n <= PERIODS[i].max));
    assert.deepEqual(p.blocks.map(b => b.key), PERIODS.map(b => b.key));
    assert.equal(p.slots.length, weeks * 3);
    assert.equal(p.slots.at(-1).date, p.config.targetDate);
    assert.equal(new Set(p.slots.map(s => s.date)).size, p.slots.length);
    for (let w = 1; w <= weeks; w++) assert.equal(p.slots.filter(s => s.week === w).length, 3);
    for (const s of p.slots) {
      assert.equal(s.arms.right.baseKg, weeklyBase(100, s.week));
      assert.equal(s.arms.left.baseKg, weeklyBase(80, s.week));
      for (const arm of ARMS) {
        assert.ok(s.plan[arm].every(row => row.reps >= 1 && row.reps <= 999 && PAIRS.some(p => p.i === row.i && p.j === row.j)));
        const warmups = s.plan[arm].filter(s => s.role === 'warmup'), work = s.plan[arm].filter(s => s.role !== 'warmup');
        assert.equal(new Set(warmups.map(s => s.kg)).size, warmups.length);
        assert.ok(warmups.every((s, i) => (i === 0 || s.kg > warmups[i - 1].kg) && s.kg < work[0].kg));
      }
    }
  }
});
test('published durations and deterministic largest-remainder ties', () => {
  assert.deepEqual(allocatePeriods(4), [1, 1, 1, 1]);
  assert.deepEqual(allocatePeriods(12), [3, 3, 3, 3]);
  assert.deepEqual(allocatePeriods(26), [6, 6, 6, 8]);
  assert.deepEqual(allocatePeriods(52), [20, 12, 10, 10]);
  assert.deepEqual(allocatePeriods(5), [1, 1, 1, 2]);
  for (const n of [0, 3, 53, 5.5, NaN]) assert.throws(() => allocatePeriods(n));
});
test('calendar is date-only across leap days and DST boundaries', () => {
  for (const target of ['2028-02-29', '2027-03-28', '2027-11-07']) {
    const rows = generateCalendar(target, 4);
    assert.equal(rows[0].date, addDays(target, -27));
    assert.deepEqual(rows.slice(-3).map(s => s.date), [-6, -4, 0].map(n => addDays(target, n)));
  }
  for (const date of ['2027-02-29', '2026-13-01', '2026-10-4', 'bad']) assert.throws(() => generateCalendar(date, 4));
});
test('four-week waves lower workload and restart for each period', () => {
  const a = idealLoad('strength', 3, 12, 0, 100), b = idealLoad('strength', 4, 12, 0, 100), c = idealLoad('strength', 5, 12, 0, 100);
  assert.ok(b.kg < a.kg && b.sets < a.sets && b.deload);
  assert.equal(c.kg, idealLoad('strength', 1, 12, 0, 100).kg);
  assert.equal(idealLoad('endurance', 1, 6, 1, 100).restSec, 120);
  assert.equal(idealLoad('speed', 1, 6, 0, 100).restSec, 240);
});
test('peaking increases intensity while reducing volume; taper is the final week', () => {
  const first = idealLoad('peak', 1, 8, 0, 100), last = idealLoad('peak', 7, 8, 0, 100);
  assert.ok(last.kg > first.kg && last.sets * last.reps < first.sets * first.reps);
  assert.deepEqual([0, 1, 2].map(d => idealLoad('peak', 8, 8, d, 100).percent), [85, 40, 100]);
  assert.ok(idealLoad('peak', 1, 1, 2, 100).control);
});
test('load fitting can compensate a lighter weight with more repetitions and remains deterministic', () => {
  const ideal = { kg: 31.7, baseKg: 100, sets: 4, reps: 10 };
  const fitted = fitLoad(ideal, 'endurance');
  assert.ok(fitted.pair.kg < ideal.kg);
  assert.ok(fitted.reps.reduce((a, b) => a + b) > 40);
  assert.ok(Math.max(...fitted.reps) - Math.min(...fitted.reps) <= 1);
  assert.deepEqual(fitLoad(ideal, 'endurance'), fitted);
  assert.ok(fitted.reps.every(n => n >= 8 && n <= 12));
  for (const period of ['speed', 'peak']) {
    const f = fitLoad({ ...ideal, kg: 70, reps: 3 }, period);
    assert.ok(f.pair.kg <= 70); assert.deepEqual(f.reps, [3, 3, 3, 3]);
  }
});
test('equipment ceiling adds balanced repetitions in all four periods without adding sets', () => {
  for (const period of PERIODS.map(p => p.key)) {
    const f = fitLoad({ kg: 125, baseKg: 150, sets: 4, reps: 5 }, period);
    assert.equal(f.pair.kg, 120.4); assert.deepEqual(f.reps, [6, 5, 5, 5]); assert.equal(f.capped, true);
  }
  assert.equal(fitLoad({ kg: 120.4, baseKg: 130, sets: 2, reps: 1 }, 'peak').capped, false);
  assert.equal(fitLoad({ kg: 5, baseKg: 10, sets: 2, reps: 5 }, 'strength').unavailable, true);
  assert.ok(createProgression(config(4, 20)).slots[0].arms.right.unavailable);
});
test('results, misses, serialization and skips never rewrite the fixed plan', () => {
  const p = createProgression(config()), frozen = JSON.stringify(p.slots.map(s => ({ date: s.date, plan: s.plan, arms: s.arms })));
  for (const failed of [false, true]) {
    const w = finish(p, 0, failed), next = applyWorkout(p, w);
    assert.equal(next.slots[0].status, failed ? 'modified' : 'completed');
    assert.equal(JSON.stringify(next.slots.map(s => ({ date: s.date, plan: s.plan, arms: s.arms }))), frozen);
    assert.deepEqual(applyWorkout(next, w), next);
  }
  const skipped = skipSlot(p, p.slots[0].id);
  assert.equal(skipped.slots[0].status, 'skipped');
  assert.equal(JSON.stringify(skipped.slots.map(s => ({ date: s.date, plan: s.plan, arms: s.arms }))), frozen);
  assert.deepEqual(JSON.parse(JSON.stringify(p)).slots, p.slots);
});
test('failed control stops only later attempts of that arm and leaves initial plan intact', () => {
  const p = createProgression(config(4)), slot = p.slots.at(-1), active = { initialPlan: clone(slot.plan), sets: clone(slot.plan) };
  const tests = active.sets.right.filter(s => s.control);
  Object.assign(tests[0], { status: 'done', actualReps: 0 });
  const frozen = JSON.stringify(active.initialPlan);
  stopControlAttempts(active, 'right');
  assert.ok(tests.slice(1).every(s => s.status === 'skipped' && s.autoStopped));
  assert.ok(active.sets.left.every(s => s.status === 'pending'));
  assert.equal(JSON.stringify(active.initialPlan), frozen);
});
test('ceiling control merges repeated attempts and records only actual repetitions, including >10', () => {
  const p = createProgression(config(52, 120.4, 100)), final = p.slots.at(-1);
  assert.equal(final.plan.right.filter(s => s.control && s.capped).length, 1);
  assert.equal(final.arms.right.groups.at(-1).ideal.percent, 100);
  assert.equal(final.arms.right.groups.at(-1).ideal.kg, final.arms.right.baseKg);
  const w = finish(p, p.slots.length - 1), record = w.sets.right.find(s => s.control && s.capped);
  const best = calculateRecords([w], []).best;
  assert.equal(best.right[record.actualReps].kg, 120.4);
  assert.ok(best.right[1] === null || best.right[1].kg <= 120.4);
  record.actualReps = 15;
  assert.equal(calculateRecords([w], []).best.right[15].kg, 120.4);
});
test('statistics include warmups and actual repetitions', () => {
  const rows = [{ kg: 30, reps: 5, role: 'warmup', status: 'done', actualReps: 4 }, { kg: 70, reps: 5, role: 'main', status: 'pending' }];
  assert.deepEqual(loadStats(rows, 100), { repetitions: 10, tonnage: 500, sets: 2, intensity: 50 });
  assert.deepEqual(loadStats(rows, 100, true), { repetitions: 4, tonnage: 120, sets: 1, intensity: 30 });
});
test('v3 backup roundtrip preserves snapshots and graph copying remaps all links', () => {
  const p = createProgression(config()), w = finish(p), applied = applyWorkout(p, w);
  const data = validateProgressions(validateBackup(backup(applied, [w])));
  assert.deepEqual(data.progressions[0].slots, applied.slots);
  const copy = copyProgressionGraph(applied, [w], null);
  assert.notEqual(copy.program.id, applied.id);
  assert.equal(copy.workouts[0].progressionId, copy.program.id);
  assert.equal(copy.program.slots[0].credited, copy.workouts[0].id);
  assert.equal(copy.workouts[0].sets.right[0].plannedSetId, copy.program.slots[0].plan.right[0].id);
  validateProgressions({ progressions: [copy.program], workouts: copy.workouts });
  const damaged = clone(data); damaged.progressions[0].slots[0].date = '2027-01-01';
  assert.throws(() => validateProgressions(damaged), /занятие/);
  const badPeriod = clone(data); badPeriod.progressions[0].blocks[0].endDate = '2027-01-01';
  assert.throws(() => validateProgressions(badPeriod), /периоды/);
  const invalid = clone(data); invalid.progressions[0].slots[0].arms.right.baseKg = Infinity;
  assert.throws(() => validateProgressions(invalid), /занятие/);
  for (const version of [1, 2]) assert.throws(() => validateBackup({ ...backup(applied, [w]), version }), /несовместимы/);
});
