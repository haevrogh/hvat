import test from 'node:test';
import assert from 'node:assert/strict';
import { GripModel, gripFrame } from '../js/grip-model.js';

function harness() {
  const frames = [], jobs = new Map();
  let now = 0, id = 0;
  const model = new GripModel(state => frames.push(state), {
    schedule(fn, delay) { jobs.set(++id, { fn, time: now + delay }); return id; },
    cancel(key) { jobs.delete(key); },
  });
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...jobs].sort((a, b) => a[1].time - b[1].time)[0];
      if (!next || next[1].time > end) break;
      jobs.delete(next[0]); now = next[1].time; next[1].fn();
    }
    now = end;
  }
  model.setReady(true);
  return { model, frames, jobs, advance, last: () => frames.at(-1) };
}

test('ten load bands reverse without any timer', () => {
  const h = harness();
  for (const weight of [0, 11.9, 12, 57, 112.8, 69, 24, 0]) {
    h.model.setForce(weight);
    assert.equal(h.last().frame, gripFrame(weight));
    assert.equal(h.last().phase, 'pose');
    assert.equal(h.jobs.size, 0);
  }
  assert.equal(gripFrame(120.4), 9);
});

test('threshold plays one burst with pause and renewal, and rearms only below 120', () => {
  const h = harness();
  h.model.setForce(112.8); h.model.setForce(120.4);
  assert.equal(h.last().frame, 10);
  for (const frame of [11, 12, 13]) { h.advance(100); assert.equal(h.last().frame, frame); }
  h.advance(100); assert.equal(h.last().phase, 'pause');
  h.advance(249); assert.equal(h.last().phase, 'pause');
  h.advance(1); assert.equal(h.last().frame, 14);
  h.advance(250); assert.equal(h.last().frame, 9);
  h.model.setForce(120.4); h.advance(2000);
  assert.equal(h.jobs.size, 0);
  h.model.setForce(112.8); h.model.setForce(120.4);
  assert.equal(h.last().phase, 'burst');
});

test('rapid changes and invalid pairs cancel effects without false rearming', () => {
  const h = harness();
  h.model.setForce(112.8); h.model.setForce(120.4); h.advance(100);
  h.model.setForce(69); h.advance(1000);
  assert.equal(h.last().frame, gripFrame(69));
  h.model.setForce(120.4); h.model.setForce(null);
  assert.equal(h.last().valid, false);
  assert.equal(h.last().frame, 9);
  assert.equal(h.jobs.size, 0);
  h.model.setForce(120.4);
  assert.equal(h.last().phase, 'pose');
  h.model.setForce(112.8); h.model.setForce(null); h.model.setForce(120.4);
  assert.equal(h.last().phase, 'burst');
});

test('initial maximum, loading, reduced motion and hidden screens never queue a burst', () => {
  const h = harness();
  h.model.setForce(120.4); assert.equal(h.jobs.size, 0);
  for (const method of ['setReady', 'setVisible', 'setReduced']) {
    const disabled = method === 'setReduced';
    h.model[method](disabled);
    h.model.setForce(112.8); h.model.setForce(120.4);
    assert.equal(h.jobs.size, 0);
    h.model[method](!disabled);
    assert.equal(h.last().phase, 'pose');
  }
  h.model.setForce(112.8); h.model.setForce(120.4);
  h.model.setVisible(false); h.advance(2000); h.model.setVisible(true);
  assert.equal(h.last().phase, 'pose');
  assert.equal(h.jobs.size, 0);
});
