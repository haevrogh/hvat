import { validateWorkspace } from './block-model.js';

const ARMS = ['right', 'left'];

// IDs locate editable records; the remaining data identifies a previously imported copy.
function blockContent(block) {
  return JSON.stringify({
    name: block.name, start: block.start, weeks: block.weeks,
    sessions: block.sessions.map(session => ({
      title: session.title, date: session.date,
      arms: Object.fromEntries(ARMS.map(arm => [arm, session.arms[arm].map(row => ({
        role: row.role, sets: row.sets, reps: row.reps, mode: row.mode,
        value: row.value, restSec: row.restSec, rir: row.rir,
      }))])),
    })),
  });
}

function mapBlock(source, target, maps) {
  maps.blockIds.set(source.id, target.id);
  source.sessions.forEach((session, index) => {
    const destination = target.sessions[index];
    maps.sessionIds.set(session.id, destination.id);
    for (const arm of ARMS) session.arms[arm].forEach((row, rowIndex) => {
      maps.rowIds.set(row.id, destination.arms[arm][rowIndex].id);
    });
  });
}

/** Merge without overwriting local plans, profile values, or model settings. */
export function mergeWorkspaceGraph(localRaw, incomingRaw) {
  const workspace = validateWorkspace(localRaw), incoming = validateWorkspace(incomingRaw);
  const maps = { blockIds: new Map(), sessionIds: new Map(), rowIds: new Map() };
  const used = new Set();
  for (const block of workspace.blocks) {
    used.add(block.id);
    for (const session of block.sessions) {
      used.add(session.id);
      for (const arm of ARMS) for (const row of session.arms[arm]) used.add(row.id);
    }
  }
  const nextId = () => {
    let id;
    do { id = crypto.randomUUID(); } while (used.has(id));
    used.add(id);
    return id;
  };
  let added = 0;
  for (const source of incoming.blocks) {
    const ids = [source.id, ...source.sessions.flatMap(session => [session.id,
      ...ARMS.flatMap(arm => session.arms[arm].map(row => row.id))])];
    const collision = ids.some(id => used.has(id));
    const content = blockContent(source);
    const matching = collision && workspace.blocks.find(block => blockContent(block) === content);
    if (matching) {
      mapBlock(source, matching, maps);
      continue;
    }
    const target = structuredClone(source);
    // A collision anywhere copies the complete incoming block so its internal links stay together.
    if (collision) {
      target.id = nextId();
      for (const session of target.sessions) {
        session.id = nextId();
        for (const arm of ARMS) for (const row of session.arms[arm]) row.id = nextId();
      }
    } else for (const id of ids) used.add(id);
    workspace.blocks.push(target);
    mapBlock(source, target, maps);
    added++;
  }
  for (const arm of ARMS) {
    if (workspace.profile[arm].maxKg === null && incoming.profile[arm].maxKg !== null) {
      workspace.profile[arm] = structuredClone(incoming.profile[arm]);
    }
  }
  if (!workspace.profile.sex) workspace.profile.sex = incoming.profile.sex;
  if (workspace.profile.age === null) workspace.profile.age = incoming.profile.age;
  return { workspace: validateWorkspace(workspace), ...maps, added };
}

export const mergeWorkspace = (local, incoming) => mergeWorkspaceGraph(local, incoming).workspace;

/** Keep journal references attached to the imported block after a collision copy. */
export function remapBlockWorkout(workout, maps) {
  if (!workout?.blockId || !maps.blockIds.has(workout.blockId)) return workout;
  const result = structuredClone(workout);
  result.blockId = maps.blockIds.get(result.blockId);
  result.blockSessionId = maps.sessionIds.get(result.blockSessionId) || result.blockSessionId;
  for (const plans of [result.initialPlan, result.sets]) for (const arm of ARMS) {
    for (const set of plans?.[arm] || []) {
      if (set.blockRowId && maps.rowIds.has(set.blockRowId)) set.blockRowId = maps.rowIds.get(set.blockRowId);
    }
  }
  return result;
}
