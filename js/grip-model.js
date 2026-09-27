export const gripFrame = force => Math.min(9, Math.max(0, Math.floor(force / 12)));

// No wall-clock polling: every transient belongs to one cancellable sequence.
export class GripModel {
  constructor(render, { schedule = (fn, delay) => setTimeout(fn, delay), cancel = id => clearTimeout(id) } = {}) {
    this.render = render;
    this.schedule = schedule;
    this.cancel = cancel;
    this.timers = [];
    this.force = null;
    this.valid = false;
    this.visible = true;
    this.ready = false;
    this.reduced = false;
    this.phase = 'pose';
  }
  show(frame, phase = 'pose') {
    this.phase = phase;
    this.render({ frame, phase, valid: this.valid, ready: this.ready });
  }
  stop() {
    this.timers.forEach(this.cancel);
    this.timers = [];
    this.show(this.force === null ? 0 : gripFrame(this.force));
  }
  setReady(ready) { this.ready = ready; this.stop(); }
  setVisible(visible) {
    if (this.visible === visible) return;
    this.visible = visible;
    this.stop();
  }
  setReduced(reduced) { this.reduced = reduced; this.stop(); }
  setForce(force) {
    if (force === null || !Number.isFinite(force)) {
      this.valid = false;
      this.stop();
      return;
    }
    const crosses = this.force !== null && this.force < 120 && force >= 120;
    this.force = force;
    this.valid = true;
    if (crosses && this.ready && this.visible && !this.reduced) {
      this.stop();
      this.show(10, 'burst');
      const at = (delay, fn) => this.timers.push(this.schedule(fn, delay));
      at(100, () => this.show(11, 'burst'));
      at(200, () => this.show(12, 'burst'));
      at(300, () => this.show(13, 'burst'));
      at(400, () => this.show(13, 'pause'));
      at(650, () => this.show(14, 'renew'));
      at(900, () => this.stop());
    } else if (force < 120 || this.phase === 'pose') {
      this.stop();
    }
  }
  destroy() { this.stop(); }
}
