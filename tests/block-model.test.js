import test from 'node:test';
import assert from 'node:assert/strict';
import { PAIRS } from '../js/workout-model.js';
import { createWorkspace, createBlock, createSession, createRow, validateWorkspace, resolveRow, sessionStats,
  blockAnalytics, scenarioSeries, performanceSeries, copyBlock, copyBlockSession, addBlockDays, blockEnd } from '../js/block-model.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function fixture() {
  const workspace = createWorkspace();
  workspace.profile.right.maxKg = 100; workspace.profile.left.maxKg = 80;
  const block = createBlock({ name: 'Ручной блок', start: '2026-11-01', weeks: 4 });
  const session = createSession('2026-11-02');
  session.arms.right = [createRow({ mode: 'kg', value: 70, sets: 2, reps: 5 })];
  session.arms.left = [createRow({ mode: 'percent', value: 70, sets: 3, reps: 3 })];
  block.sessions.push(session); workspace.blocks.push(block);
  return { workspace, block, session, profile: workspace.profile, model: workspace.model };
}
function workout(id, date, pair = PAIRS[20], reps = 5, arm = 'right', extra = {}) {
  return { id, date, endedAt: `${date}T12:00:00Z`, sets: { right: [], left: [], [arm]: [{ id: `${id}-s`, ...pair,
    reps, actualReps: reps, status: 'done', completedAt: `${date}T12:00:00Z`, ...extra }] } };
}

test('workspace is isolated, optional profile is unset, validated imports are deep copies', () => {
  const one = createWorkspace(), two = createWorkspace();
  assert.equal(one.profile.right.maxKg, null);
  one.profile.right.maxKg = 70;
  assert.equal(two.profile.right.maxKg, null);
  const { workspace } = fixture(), copy = validateWorkspace(workspace);
  copy.blocks[0].sessions[0].arms.right[0].reps = 9;
  assert.equal(workspace.blocks[0].sessions[0].arms.right[0].reps, 5);
});
test('validation rejects non-finite values, impossible dates, bounds and duplicate IDs', () => {
  const changes = [
    w => { w.profile.right.maxKg = 0; }, w => { w.profile.left.maxKg = 120.5; },
    w => { w.profile.age = 12.5; }, w => { w.model.volumeHalfLife = .24; },
    w => { w.model.heavyThreshold = NaN; }, w => { w.blocks[0].weeks = 53; },
    w => { w.blocks[0].start = '2026-02-29'; }, w => { w.blocks[0].sessions[0].date = '2026-12-01'; },
    w => { w.blocks[0].sessions[0].arms.right[0].sets = 21; },
    w => { w.blocks[0].sessions[0].arms.right[0].mode = 'arbitrary'; },
    w => { w.blocks[0].sessions[0].arms.left[0].id = w.blocks[0].sessions[0].arms.right[0].id; },
    w => { w.blocks[0].sessions[0].arms.right[0].rir = 2; },
  ];
  for (const change of changes) { const { workspace } = fixture(); change(workspace); assert.throws(() => validateWorkspace(workspace)); }
  const { workspace } = fixture();
  workspace.profile.right.maxKg = .01;
  assert.doesNotThrow(() => validateWorkspace(workspace));
});
test('dates are date-only across leap days and DST; last day belongs to the block', () => {
  assert.equal(addBlockDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addBlockDays('2027-03-27', 2), '2027-03-29');
  const { workspace, block } = fixture();
  assert.equal(blockEnd(block), '2026-11-28');
  block.sessions[0].date = blockEnd(block);
  assert.doesNotThrow(() => validateWorkspace(workspace));
  assert.throws(() => createBlock({ name: 'a', start: '2026-2-01', weeks: 1 }));
});
test('copied blocks and sessions have new IDs, independent rows, shifted calendar', () => {
  const { workspace, block, session } = fixture();
  const copy = copyBlock(block, '2026-12-01'), copiedSession = copyBlockSession(session);
  assert.equal(copy.sessions[0].date, '2026-12-02');
  assert.notEqual(copy.id, block.id);
  assert.notEqual(copy.sessions[0].id, session.id);
  assert.notEqual(copy.sessions[0].arms.right[0].id, session.arms.right[0].id);
  assert.notEqual(copiedSession.arms.left[0].id, session.arms.left[0].id);
  copy.sessions[0].arms.right[0].reps = 99;
  assert.equal(session.arms.right[0].reps, 5);
  workspace.blocks.push(copy);
  assert.doesNotThrow(() => validateWorkspace(workspace));
});
test('pair resolution always rounds down and exposes both hardware limits without compensation', () => {
  const row = createRow({ mode: 'kg', value: 70, sets: 4, reps: 5 });
  const resolved = resolveRow(row, { maxKg: 100 });
  assert.ok(resolved.actualKg <= 70 && resolved.available);
  assert.equal(resolved.reps, 5); assert.equal(resolved.sets, 4);
  const below = resolveRow({ ...row, value: 1 }, { maxKg: 100 });
  assert.equal(below.available, false); assert.equal(below.pair, null);
  const above = resolveRow({ ...row, value: 125 }, { maxKg: 100 });
  assert.equal(above.available, false); assert.equal(above.actualKg, 120.4);
  const missing = resolveRow(row, { maxKg: null });
  assert.equal(missing.available, false); assert.equal(missing.intensity, null);
  assert.equal(resolveRow(createRow(), { maxKg: null }).pair, null);
});
test('independent hand maxima set percentages; changing one hand cannot affect the other', () => {
  const { session, profile } = fixture();
  const left = sessionStats(session, profile, 'left');
  const right = sessionStats(session, profile, 'right');
  profile.right.maxKg = 50;
  assert.deepEqual(sessionStats(session, profile, 'left'), left);
  assert.notEqual(sessionStats(session, profile, 'right').main.meanIntensity, right.main.meanIntensity);
});
test('main, warmup, intensity and explicit/unknown RIR statistics stay separate', () => {
  const { session, profile } = fixture();
  const pair = PAIRS[20];
  session.arms.right = [createRow({ mode: 'kg', value: pair.kg, sets: 2, reps: 5, rir: '2' }),
    createRow({ mode: 'kg', value: PAIRS[0].kg, sets: 1, reps: 8, role: 'warmup' })];
  const stats = sessionStats(session, profile, 'right', 40);
  assert.equal(stats.main.sets, 2); assert.equal(stats.main.repetitions, 10);
  assert.equal(stats.warmup.repetitions, 8); assert.equal(stats.total.repetitions, 18);
  close(stats.main.tonnage, pair.kg * 10); close(stats.main.relativeVolume, pair.kg / 100 * 10);
  assert.equal(stats.main.rirDistribution.find(row => row.key === '2').repetitions, 10);
  assert.equal(stats.warmup.rirDistribution[0].repetitions, 8);
  assert.equal(stats.main.intensityDistribution.reduce((sum, row) => sum + row.repetitions, 0), 10);
  const changed = sessionStats({ ...session, arms: { ...session.arms, right: session.arms.right.map(row => ({ ...row, rir: '0', restSec: 3600 })) } }, profile, 'right');
  close(changed.main.tonnage, stats.main.tonnage);
  close(changed.main.relativeVolume, stats.main.relativeVolume);
});
test('unavailable rows retain planned counts but never add an invented load dose', () => {
  const { session, profile } = fixture();
  session.arms.right = [createRow({ value: 300, sets: 2, reps: 4 })];
  const stats = sessionStats(session, profile, 'right');
  assert.equal(stats.main.sets, 2); assert.equal(stats.main.repetitions, 8);
  assert.equal(stats.main.tonnage, 0); assert.equal(stats.main.complete, false);
  assert.equal(stats.unavailableRows, 1); assert.equal(stats.main.meanIntensity, null);
});
test('heavy threshold uses raw intensity: 84.999% is below85%,100%+ is retained', () => {
  const { block, profile, model } = fixture(), pair = PAIRS[20];
  const under = workout('under', '2026-11-02', pair, 5, 'right', { blockMaxKg: pair.kg / .84999 });
  const at = workout('at', '2026-11-03', pair, 5, 'right', { blockMaxKg: pair.kg / .85 });
  const over = workout('over', '2026-11-04', pair, 5, 'right', { blockMaxKg: pair.kg / 1.2 });
  const analytics = blockAnalytics(block, profile, 'right', model, [under, at, over]);
  assert.equal(analytics.actual.daily[1].heavyReps, 0);
  assert.equal(analytics.actual.daily[2].heavyReps, 5);
  assert.equal(analytics.actual.daily[3].heavyReps, 5);
  assert.equal(analytics.actual.totals.intensityDistribution.at(-1).repetitions, 5);
});
test('actual relative volume preserves saved maxima across profile changes and prioritizes set snapshot', () => {
  const { block, profile, model } = fixture(), pair = PAIRS[20];
  const w = workout('w', '2026-11-02', pair, 5, 'right', { blockMaxKg: 50 });
  w.blockContext = { maxima: { right: 80, left: 80 } };
  const before = blockAnalytics(block, profile, 'right', model, [w]).actual;
  profile.right.maxKg = 20;
  const after = blockAnalytics(block, profile, 'right', model, [w]).actual;
  close(before.totals.relativeVolume, pair.kg / 50 * 5);
  assert.deepEqual(before, after);
  delete w.sets.right[0].blockMaxKg;
  close(blockAnalytics(block, profile, 'right', model, [w]).actual.totals.relativeVolume, pair.kg / 80 * 5);
});
test('legacy actual keeps absolute effort and counts without inventing a historical maximum', () => {
  const { block, profile, model } = fixture(), pair = PAIRS[20];
  const w = workout('legacy', '2026-11-02', pair, 5);
  const before = blockAnalytics(block, profile, 'right', model, [w]).actual;
  profile.right.maxKg = 20;
  const after = blockAnalytics(block, profile, 'right', model, [w]).actual;
  assert.deepEqual(before, after);
  assert.equal(before.totals.sets, 1); assert.equal(before.totals.repetitions, 5);
  close(before.totals.tonnage, pair.kg * 5); close(before.totals.effort, pair.kg * 5);
  assert.equal(before.totals.relativeVolume, 0); assert.equal(before.totals.heavyReps, 0);
  assert.equal(before.totals.meanIntensity, null); assert.equal(before.totals.complete, false);
  assert.equal(before.totals.unavailableRows, 1);
});
test('a tiny saved denominator cannot overflow actual relative analytics or charts', () => {
  const { block, profile, model } = fixture();
  const w = workout('tiny', '2026-11-02', PAIRS[20], 5, 'right', { blockMaxKg: 1e-320 });
  const totals = blockAnalytics(block, profile, 'right', model, [w]).actual.totals;
  assert.equal(totals.complete, false); assert.equal(totals.meanIntensity, null);
  assert.equal(totals.relativeVolume, 0); assert.equal(totals.heavyReps, 0);
  assert.ok(totals.tonnage > 0 && Number.isFinite(totals.tonnage));
  assert.ok(scenarioSeries(block, profile, 'right', model, 'actual', [w]).every(point => Number.isFinite(point.volume) && Number.isFinite(point.heavyReps)));
  profile.right.maxKg = 1e-320;
  const resolved = resolveRow(createRow({ mode: 'kg', value: 70 }), profile.right);
  assert.equal(resolved.available, false); assert.equal(resolved.intensity, null);
  assert.ok(scenarioSeries(block, profile, 'right', model, 'plan').every(point => Number.isFinite(point.volume) && Number.isFinite(point.heavyReps)));
});
test('cycle actual volume uses the saved growing maximum even above the hardware ceiling', () => {
  const { block, profile, model } = fixture();
  const w = workout('cycle-fact', '2026-11-02', PAIRS[20], 5, 'right', { cycleMaxKg: 150 });
  w.cycleContext = { maxima: { right: 140, left: 80 } };
  const first = blockAnalytics(block, profile, 'right', model, [w]).actual.totals;
  close(first.volume, PAIRS[20].kg / 150 * 5);
  profile.right.maxKg = 50;
  close(blockAnalytics(block, profile, 'right', model, [w]).actual.totals.volume, first.volume);
});

test('actual RIR remains unknown until explicitly reported and never inherits the prescribed field', () => {
  const { block, profile, model } = fixture();
  const w = workout('rir', '2026-11-02', PAIRS[20], 5, 'right', { rir: '2' });
  assert.equal(blockAnalytics(block, profile, 'right', model, [w]).actual.totals.rirDistribution[0].sets, 1);
  w.sets.right[0].actualRir = '1';
  assert.equal(blockAnalytics(block, profile, 'right', model, [w]).actual.totals.rirDistribution.find(row => row.key === '1').sets, 1);
});
test('weekly and rolling windows aggregate overlaps without confusing warmups and working rows', () => {
  const { block, profile, model, session } = fixture();
  block.sessions.push(copyBlockSession(session, '2026-11-08'), copyBlockSession(session, '2026-11-22'));
  const data = blockAnalytics(block, profile, 'right', model);
  assert.equal(data.weekly.length, 4);
  assert.equal(data.weekly[0].sets, 2); assert.equal(data.weekly[1].sets, 2);
  assert.equal(data.rolling7[7].sets, 4);
  assert.equal(data.rolling7[8].sets, 2);
  assert.equal(data.rolling21[21].sets, 6);
  assert.equal(data.totals.sets, 6);
});
test('actual rolling7/21 include journal work before the block while block totals do not', () => {
  const { block, profile, model } = fixture(), pair = PAIRS[20];
  const old = workout('old', '2026-10-15', pair, 2, 'right', { blockMaxKg: 100 });
  const recent = workout('recent', '2026-10-30', pair, 3, 'right', { blockMaxKg: 100 });
  const tooOld = workout('tooOld', '2026-10-01', pair, 4, 'right', { blockMaxKg: 100 });
  const actual = blockAnalytics(block, profile, 'right', model, [old, recent, tooOld]).actual;
  assert.equal(actual.totals.sets, 0);
  assert.equal(actual.rolling7[0].sets, 1); assert.equal(actual.rolling7[0].repetitions, 3);
  assert.equal(actual.rolling21[0].sets, 2); assert.equal(actual.rolling21[0].repetitions, 5);
});
test('scenario has no dose before session, exact half/quarter decay and additive overlap', () => {
  const { block, profile, model, session } = fixture();
  model.volumeHalfLife = 2; model.heavyHalfLife = 4; model.heavyThreshold = 1;
  const one = scenarioSeries(block, profile, 'right', model, 'plan');
  assert.equal(one[0].volume, 0);
  const impulse = one[1].inputVolume, heavy = one[1].inputHeavyReps;
  close(one[1].volume, impulse); close(one[3].volume, impulse / 2); close(one[5].volume, impulse / 4);
  close(one[5].heavyReps, heavy / 2); close(one[9].heavyReps, heavy / 4);
  block.sessions.push(copyBlockSession(session, '2026-11-04'));
  const two = scenarioSeries(block, profile, 'right', model, 'plan');
  close(two[3].volume, impulse / 2 + impulse);
  close(two[3].heavyReps, one[3].heavyReps + heavy);
  const zoom = scenarioSeries(block, profile, 'right', model, 'plan', [], { start: '2026-11-04', end: '2026-11-08' });
  close(zoom[0].volume, two[3].volume);
  close(zoom[0].heavyReps, two[3].heavyReps);
});
test('combined scenario replaces linked plan and optional warmups add only their own dose', () => {
  const { block, profile, model, session } = fixture();
  session.arms.right.push(createRow({ role: 'warmup', mode: 'kg', value: PAIRS[0].kg, sets: 1, reps: 8 }));
  const w = workout('fact', '2026-11-02', PAIRS[20], 2);
  w.blockContext = { sessionId: session.id, maxima: { right: 100, left: 80 } };
  const actual = scenarioSeries(block, profile, 'right', model, 'actual', [w]);
  const combined = scenarioSeries(block, profile, 'right', model, 'combined', [w]);
  assert.deepEqual(actual, combined);
  const plan = scenarioSeries(block, profile, 'right', model, 'plan');
  const warm = scenarioSeries(block, profile, 'right', model, 'plan', [], true);
  assert.ok(warm[1].inputVolume > plan[1].inputVolume);
  w.sets.right[0].status = 'skipped';
  assert.equal(scenarioSeries(block, profile, 'right', model, 'combined', [w])[1].volume, 0);
});
test('performance uses exact reps/recorded pair and requires3prior workouts for observed usual range', () => {
  const pair = PAIRS[20], higher = PAIRS[21];
  const workouts = [workout('a', '2026-11-01', pair, 5), workout('b', '2026-11-02', pair, 6),
    workout('c', '2026-11-03', pair, 4), workout('d', '2026-11-04', pair, 7), workout('e', '2026-11-05', higher, 7)];
  const series = performanceSeries(workouts, 'right');
  assert.equal(series[0].improved, false); assert.equal(series[2].usualLow, null);
  assert.equal(series[3].usualLow, 4); assert.equal(series[3].usualHigh, 6);
  assert.equal(series[3].improvedReps, true); assert.equal(series[4].improvedKg, true);
  assert.equal(series[4].previousBestKg, pair.kg);
  assert.deepEqual(performanceSeries(workouts, 'left'), []);
  const oneWorkout = workout('multi', '2026-11-01', pair, 5);
  oneWorkout.sets.right = Array.from({ length: 4 }, (_, index) => ({ ...oneWorkout.sets.right[0], id: `s${index}`, actualReps: 5 + index }));
  const comparisons = performanceSeries([oneWorkout, workout('later', '2026-11-02', pair, 9)], 'right');
  assert.equal(comparisons.at(-1).baselineCount, 1); assert.equal(comparisons.at(-1).usualLow, null);
});
test('same-day performance follows observed timestamps instead of identifier ordering', () => {
  const early = workout('z', '2026-11-01', PAIRS[20], 5);
  early.sets.right[0].completedAt = '2026-11-01T08:00:00Z';
  const late = workout('a', '2026-11-01', PAIRS[20], 6);
  late.sets.right[0].completedAt = '2026-11-01T16:00:00Z';
  const series = performanceSeries([late, early], 'right');
  assert.equal(series[0].workoutId, 'z');
  assert.equal(series[1].improvedReps, true);
});
