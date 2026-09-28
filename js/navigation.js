export function showSection(name) {
  for(const key of ['Calc','Training','Progression']) {
    const active=key===name;
    document.getElementById(`section${key}`)?.classList.toggle('hidden',!active);
    const button=document.getElementById(`section${key}Button`);
    button?.classList.toggle('active',active);button?.setAttribute('aria-pressed',String(active));
  }
  document.body.classList.toggle('training-active',name!=='Calc');
  document.body.classList.toggle('progression-active',name==='Progression');
  document.documentElement.classList.remove('calc-no-scroll');
  document.dispatchEvent(new CustomEvent('hvat-section-change',{detail:name}));
}
