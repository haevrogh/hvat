import { GripModel } from './grip-model.js';

export function createGripAnimation(card) {
  const sprite = card.querySelector('.grip-sprite');
  const spray = card.querySelector('.grip-spray');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let animations = [];
  let previousPhase = 'pose';
  let disposed = false;
  const stopParticles = () => {
    animations.forEach(animation => animation.cancel());
    animations = [];
  };
  // Reuse the same small particle layer. Only transforms and opacity animate.
  const particles = Array.from({ length: 16 }, (_, i) => {
    const particle = document.createElement('i');
    particle.className = i % 3 ? 'grip-drop' : 'grip-peel';
    spray.append(particle);
    return particle;
  });
  function burst() {
    stopParticles();
    const width = card.clientWidth, height = card.clientHeight;
    const size = sprite.clientWidth;
    const originX = sprite.offsetLeft + size * .5;
    const originY = sprite.offsetTop + size * .48;
    particles.forEach((particle, i) => {
      particle.style.left = `${originX}px`;
      particle.style.top = `${originY}px`;
      const endX = (i % 8) / 7 * width - originX;
      const endY = (i < 8 ? -height * .2 : height * 1.15) - originY;
      animations.push(particle.animate([
        { transform: 'translate(0, 0) rotate(0deg) scale(.3)', opacity: 0 },
        { opacity: .85, offset: .1 },
        { transform: `translate(${endX}px, ${endY}px) rotate(${i * 73 - 290}deg) scale(1)`, opacity: 0 },
      ], { duration: 650, easing: 'cubic-bezier(.12,.55,.45,1)', fill: 'none' }));
    });
  }
  const model = new GripModel(({ frame, phase, valid, ready }) => {
    sprite.style.backgroundPosition = `${(frame % 5) * 25}% ${Math.floor(frame / 5) * 50}%`;
    sprite.dataset.frame = String(frame + 1);
    sprite.dataset.phase = phase;
    sprite.classList.toggle('is-ready', ready);
    sprite.classList.toggle('is-invalid', !valid);
    sprite.classList.toggle('is-renewing', phase === 'renew');
    if (phase === 'burst' && previousPhase !== 'burst') burst();
    if (phase === 'pose') stopParticles();
    previousPhase = phase;
  });
  const onMotion = () => model.setReduced(motion.matches);
  onMotion();
  motion.addEventListener('change', onMotion);
  let screenVisible = true;
  const onVisibility = () => model.setVisible(screenVisible && !document.hidden);
  document.addEventListener('visibilitychange', onVisibility);
  onVisibility();
  const atlas = new Image();
  atlas.src = new URL('../assets/grip-atlas.webp', import.meta.url).href;
  atlas.decode().then(() => {
    if (disposed) return;
    sprite.style.backgroundImage = `url("${atlas.src}")`;
    model.setReady(true);
  }).catch(() => { /* The calculator remains usable if artwork cannot load. */ });
  return {
    setForce: force => model.setForce(force),
    setVisible(visible) { screenVisible = visible; onVisibility(); },
    destroy() {
      disposed = true;
      model.destroy();
      motion.removeEventListener('change', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
