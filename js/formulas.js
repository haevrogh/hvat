export const COEFFICIENTS = Object.freeze({
  A: 0.3008,
  B: 1.8637,
  C: 2.98,
});

export const POSITION_LIMITS = Object.freeze({
  MIN: 1,
  MAX: 12,
});

export function springForce(position) {
  const n = Number(position);
  if (!Number.isFinite(n)) {
    return NaN;
  }
  const { A, B, C } = COEFFICIENTS;
  return A * n * n + B * n + C;
}

export function doubleForce(i, j) {
  return springForce(i) + springForce(j);
}

export function isValidSingle(position) {
  const n = Number(position);
  const { MIN, MAX } = POSITION_LIMITS;
  return Number.isInteger(n) && n >= MIN && n <= MAX;
}

export function isValidDouble(first, second) {
  const i = Number(first);
  const j = Number(second);
  const { MIN, MAX } = POSITION_LIMITS;
  return (
    Number.isInteger(i) &&
    Number.isInteger(j) &&
    i !== j &&
    Math.abs(i - j) >= 2 &&
    i >= MIN &&
    i <= MAX &&
    j >= MIN &&
    j <= MAX
  );
}
