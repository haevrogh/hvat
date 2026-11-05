import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace } from '../js/block-model.js';
import { mergeWorkspace, mergeWorkspaceGraph, remapBlockWorkout } from '../js/block-storage.js';
import { PAIRS, validateBackup } from '../js/workout-model.js';
import { saveBlockWorkspace, mergeBlockWorkspace, mergeBackup } from '../js/workout-db.js';

const workspace = (prefix = 'original') => {
  const value = createWorkspace();
  value.profile.right = { maxKg: 100, date: '2026-11-05' };
  value.blocks = [{ id: `${prefix}-block`, name: 'Силовой блок', start: '2026-11-05', weeks: 4,
    sessions: [{ id: `${prefix}-session`, title: 'Тяжёлая', date: '2026-11-05',
      arms: { right: [{ id: `${prefix}-row`, role: 'main', sets: 5, reps: 5,
        mode: 'percent', value: 70, restSec: 240, rir: 'unknown' }], left: [] } }] }];
  return value;
};
const backup = blockWorkspace => ({ format: 'hvat-backup', version: 3, data: {
  templates: [], workouts: [], manualRecords: [], active: null,
  progressions: [], pendingImports: [], settings: { sound: false },
  ...(blockWorkspace === undefined ? {} : { blockWorkspace }),
} });

test('backup v3 roundtrip includes the block workspace and keeps existing data intact', () => {
  const raw = backup(workspace());
  const pair = PAIRS[20];
  raw.data.manualRecords = [{ id: 'record', arm: 'right', ...pair, reps: 1, recordedAt: '2026-11-05T10:00:00.000Z' }];
  const result = validateBackup(JSON.parse(JSON.stringify(raw)));
  assert.deepEqual(result.blockWorkspace, raw.data.blockWorkspace);
  assert.deepEqual(result.manualRecords, raw.data.manualRecords);
  assert.deepEqual(result.settings, { sound: false });
  result.blockWorkspace.blocks[0].name = 'Изменён';
  assert.equal(raw.data.blockWorkspace.blocks[0].name, 'Силовой блок');
  assert.deepEqual(validateBackup(backup()).blockWorkspace, createWorkspace());
});

test('merge preserves local profile and model, adds distinct blocks, and fills an empty arm profile', () => {
  const local = workspace('local'), incoming = workspace('incoming');
  local.profile.sex = 'female';
  local.model.volumeHalfLife = 3;
  incoming.profile.right.maxKg = 110;
  incoming.profile.left = { maxKg: 80, date: '2026-11-04' };
  incoming.profile.sex = 'male';
  incoming.profile.age = 35;
  const merged = mergeWorkspace(local, incoming);
  assert.equal(merged.blocks.length, 2);
  assert.equal(merged.blocks[1].id, 'incoming-block');
  assert.deepEqual(merged.profile.right, local.profile.right);
  assert.deepEqual(merged.profile.left, incoming.profile.left);
  assert.equal(merged.profile.sex, 'female');
  assert.equal(merged.profile.age, 35);
  assert.deepEqual(merged.model, local.model);
  assert.equal(local.blocks.length, 1);
  assert.equal(incoming.blocks[0].id, 'incoming-block');
});

test('a conflicting block is copied with all new IDs and repeated imports reuse that copy', () => {
  const local = workspace(), incoming = workspace();
  incoming.blocks[0].sessions[0].arms.right[0].sets = 4;
  const first = mergeWorkspaceGraph(local, incoming);
  assert.equal(first.added, 1);
  assert.equal(first.workspace.blocks.length, 2);
  const copied = first.workspace.blocks[1];
  assert.notEqual(copied.id, 'original-block');
  assert.notEqual(copied.sessions[0].id, 'original-session');
  assert.notEqual(copied.sessions[0].arms.right[0].id, 'original-row');
  assert.equal(first.workspace.blocks[0].sessions[0].arms.right[0].sets, 5);
  assert.equal(first.blockIds.get('original-block'), copied.id);
  const second = mergeWorkspaceGraph(first.workspace, incoming);
  assert.equal(second.added, 0);
  assert.deepEqual(second.workspace, first.workspace);
  assert.equal(second.sessionIds.get('original-session'), copied.sessions[0].id);
});

test('a collision in a nested ID also copies the complete block and deduplicates later imports', () => {
  const local = workspace('local'), incoming = workspace('incoming');
  incoming.blocks[0].sessions[0].arms.right[0].id = 'local-row';
  incoming.blocks[0].name = 'Другой блок';
  const first = mergeWorkspaceGraph(local, incoming);
  assert.equal(first.workspace.blocks.length, 2);
  assert.notEqual(first.workspace.blocks[1].id, 'incoming-block');
  assert.equal(mergeWorkspaceGraph(first.workspace, incoming).workspace.blocks.length, 2);
});

test('journal block links follow a copied block while captured loads and original data stay intact', () => {
  const local = workspace(), incoming = workspace();
  incoming.blocks[0].name = 'Входящий';
  const maps = mergeWorkspaceGraph(local, incoming);
  const row = { id: 'done-set', blockRowId: 'original-row', kg: 67.8 };
  const original = { id: 'workout', blockId: 'original-block', blockSessionId: 'original-session',
    initialPlan: { right: [row], left: [] }, sets: { right: [row], left: [] } };
  const remapped = remapBlockWorkout(original, maps);
  assert.equal(remapped.blockId, maps.blockIds.get('original-block'));
  assert.equal(remapped.blockSessionId, maps.sessionIds.get('original-session'));
  assert.equal(remapped.sets.right[0].blockRowId, maps.rowIds.get('original-row'));
  assert.equal(remapped.sets.right[0].kg, 67.8);
  assert.equal(original.blockId, 'original-block');
});

test('invalid workspace imports and saves fail before opening or writing IndexedDB', async () => {
  const invalid = workspace();
  invalid.blocks[0].sessions[0].arms.right[0].sets = 0;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  let opened = 0;
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() {
    opened++;
    throw new Error('Invalid data must not open the database');
  } });
  try {
    assert.throws(() => validateBackup(backup(invalid)));
    assert.throws(() => saveBlockWorkspace(invalid));
    assert.throws(() => mergeBlockWorkspace(invalid));
    await assert.rejects(mergeBackup({ ...backup(invalid).data }));
    assert.equal(opened, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    else delete globalThis.indexedDB;
  }
});

test('backup rejects broken block references and impossible captured loads', () => {
  const pair = PAIRS[20], now = '2026-11-05T10:00:00.000Z';
  const set = { id: 'set', ...pair, reps: 5, actualReps: 5, status: 'done', completedAt: now };
  const raw = backup(workspace());
  raw.data.workouts = [{ id: 'workout', title: 'Факт', startedAt: now, endedAt: now,
    restSec: 240, initialPlan: { right: [{ ...set, status: 'pending' }], left: [] },
    sets: { right: [set], left: [] }, blockId: 'original-block', blockSessionId: 'original-session' }];
  assert.equal(validateBackup(raw).workouts.length, 1);
  raw.data.workouts[0].blockSessionId = 'invalid id';
  assert.throws(() => validateBackup(raw), /тренировка/);
  raw.data.workouts[0].blockSessionId = 'original-session';
  for (const kg of [NaN, Infinity, 0, -10]) {
    set.kg = kg;
    assert.throws(() => validateBackup(raw), /тренировка/);
  }
});

test('backup validates every saved maximum and preserves legacy absence and unused arm null', () => {
  const pair = PAIRS[20], now = '2026-11-05T10:00:00.000Z';
  const set = { id: 'set', ...pair, reps: 5, actualReps: 5, status: 'done', completedAt: now };
  const raw = backup(workspace());
  const item = { id: 'workout', title: 'Факт', startedAt: now, endedAt: now,
    restSec: 240, initialPlan: { right: [{ ...set, status: 'pending' }], left: [] },
    sets: { right: [set], left: [] }, blockId: 'original-block', blockSessionId: 'original-session' };
  raw.data.workouts = [item];
  assert.doesNotThrow(() => validateBackup(raw));
  for (const invalid of [0, -1, NaN, Infinity, 120.5, null, '100']) {
    set.blockMaxKg = invalid;
    assert.throws(() => validateBackup(raw), /тренировка/);
  }
  set.blockMaxKg = 100;
  item.blockContext = { name: 'План', plannedDate: '2026-11-05', maxima: { right: 100, left: null } };
  assert.equal(validateBackup(raw).workouts[0].sets.right[0].blockMaxKg, 100);
  for (const invalid of [0, -1, NaN, Infinity, 120.5, '100']) {
    item.blockContext.maxima.right = invalid;
    assert.throws(() => validateBackup(raw), /тренировка/);
  }
  item.blockContext.maxima.right = 100;
  item.blockContext.plannedDate = '2026-02-30';
  assert.throws(() => validateBackup(raw), /тренировка/);
  delete item.blockContext;
  delete set.blockMaxKg;
  item.initialPlan.right[0].blockMaxKg = 0;
  assert.throws(() => validateBackup(raw), /тренировка/);
});
