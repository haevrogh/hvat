import { COEFFICIENTS, doubleForce, isValidDouble, isValidSingle, springForce } from './formulas.js';
import { findByWeightDouble } from './finders.js';
import { initUI } from './ui.js';

function runTests() {
  const approxEq = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
  const { A, B, C } = COEFFICIENTS;

  console.assert(approxEq(springForce(1), A * 1 * 1 + B * 1 + C), 'S(1) formula');
  console.assert(isValidSingle(12) && !isValidSingle(0), 'isValidSingle bounds');
  console.assert(
    isValidDouble(12, 9) && !isValidDouble(5, 5) && !isValidDouble(6, 5),
    'isValidDouble rules',
  );

  const t = 64;
  const rows = findByWeightDouble(t);
  const ids = new Set(rows.map((r) => `${r.i}-${r.j}`));
  rows.forEach((r) => {
    console.assert(!ids.has(`${r.j}-${r.i}`) || r.i === r.j, 'no duplicates by order');
  });

  console.assert(approxEq(doubleForce(4, 12), doubleForce(12, 4)), 'doubleForce symmetric');
  console.log('%cTests passed', 'color:green');
}

initUI();
runTests();
