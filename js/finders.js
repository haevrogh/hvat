import { doubleForce, isValidDouble, isValidSingle, springForce } from './formulas.js';

function sortedByDifference(rows) {
  return rows.sort((a, b) => a.diff - b.diff || a.f - b.f);
}

export function findByWeightSingle(target, limit = 2) {
  const desired = Number(target);
  if (!Number.isFinite(desired)) {
    return [];
  }
  const rows = [];
  for (let n = 1; n <= 12; n += 1) {
    if (!isValidSingle(n)) continue;
    const f = springForce(n);
    rows.push({ mode: 'single', i: n, f, diff: Math.abs(f - desired) });
  }
  return sortedByDifference(rows).slice(0, limit);
}

export function findByWeightDouble(target, limit = 2) {
  const desired = Number(target);
  if (!Number.isFinite(desired)) {
    return [];
  }
  const rows = [];
  for (let i = 1; i <= 12; i += 1) {
    for (let j = i + 1; j <= 12; j += 1) {
      if (!isValidDouble(i, j)) continue;
      const f = doubleForce(i, j);
      rows.push({ mode: 'double', i, j, f, diff: Math.abs(f - desired) });
    }
  }
  return sortedByDifference(rows).slice(0, limit);
}
