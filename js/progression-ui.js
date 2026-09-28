import { ARMS, ARM_LABELS, calculateRecords, newId } from './workout-model.js';
import { createProgression, defaultArm, validateConfig, clone, currentSlot, decide, extend, dateSequence, refreshFuture, pairKey, keyPair, assignment } from './progression-model.js';
import { saveProgression } from './workout-db.js';
import { esc, button, options, armForm, programView, slotView } from './progression-view.js';
import { showSection } from './navigation.js';

export function initProgressionUI(bridge) {
  const root=document.getElementById('progressionRoot'),dialog=document.getElementById('progressionDialog');
  let selected=null,wizard=null,busy=false;
  const state=()=>bridge.getState();
  const program=()=>state().progressions.find(p=>p.id===selected)||state().progressions.find(p=>p.status==='active')||state().progressions[0];
  function error(e){document.getElementById('progressionMessage').textContent=e.message||String(e);}
  async function persist(p){await saveProgression(p,state().progressions.find(x=>x.id===p.id)?.revision);selected=p.id;await bridge.reload();render();}
  function render() {
    const p=program();if(p)selected=p.id;
    root.innerHTML=p?programView(p,state().active,state().progressions,state().workouts):`<div class="training-heading"><div><p class="eyebrow">ОТ ЗАНЯТИЯ К ЗАНЯТИЮ</p><h1>Прогрессия</h1><p class="training-lead">У каждой руки — свой путь. У тебя — одна понятная тренировка.</p></div></div><div class="training-panel"><h2>Выбери программу каждой руке</h2><p>Волны нагрузки, double progression или тест с постепенным набором повторений. План и история остаются на этом устройстве.</p>${button('create','Создать прогрессию','',true)}</div>`;
    const next=state().progressions.find(p=>p.status==='active'),card=document.getElementById('nextProgression');
    card.classList.toggle('hidden',!next);
    if(next)card.innerHTML=`<div><strong>${esc(next.name)}</strong><small>${currentSlot(next)?`Неделя ${currentSlot(next).week} · следующее занятие программы`:'Плановый период завершён'}</small></div>${button('open','Открыть прогрессию','',true)}`;
  }
  function startWizard(existing=null) {
    const today=new Date(),date=new Date(today.getTime()-today.getTimezoneOffset()*60000).toISOString().slice(0,10);
    wizard={step:0,existing,settings:existing?clone(existing.config):{name:'Моя прогрессия',weeks:32,horizon:50,start:date,days:[1,5],arms:{right:defaultArm(),left:defaultArm()}}};
    if(!existing){const records=calculateRecords(state().workouts,state().manualRecords).best;for(const a of ARMS){if(records[a][10]){wizard.settings.arms[a].pair=keyPair(records[a][10]);wizard.settings.arms[a].hasRecord10=true;}if(records[a][1])wizard.settings.arms[a].base=records[a][1].kg;}}
    renderWizard();dialog.showModal();
  }
  function renderWizard() {
    const s=wizard.settings,step=wizard.step,arm=ARMS[step-1];
    let html;
    if(step===0)html=`<h2>Период и расписание</h2><label class="field">Название<input name="name" value="${esc(s.name)}" maxlength="100" required></label><div class="prog-fields"><label>Начало<input name="start" type="date" value="${s.start}" required></label><label>Запланировано недель<input name="weeks" type="number" min="1" max="260" value="${s.weeks}" required></label><label>Ориентир, недель<input name="horizon" type="number" min="1" max="520" value="${s.horizon||''}"></label></div><p class="muted">Период — окно расписания. Блоки могут потребовать продления. Волновой маршрут без повторов — 32 недели.</p><fieldset><legend>Два дня занятий в неделю</legend><div class="prog-pairs">${['Вс','Пн','Вт','Ср','Чт','Пт','Сб'].map((d,i)=>`<label class="prog-check"><input name="day" type="checkbox" value="${i}" ${s.days.includes(i)?'checked':''}>${d}</label>`).join('')}</div></fieldset><fieldset><legend>Участвующие руки</legend>${ARMS.map(a=>`<label class="prog-check"><input name="arm" type="checkbox" value="${a}" ${s.arms[a]?'checked':''}>${ARM_LABELS[a]}</label>`).join('')}</fieldset>`;
    else if(step<=2)html=armForm(s.arms[arm],arm);
    else {
      const preview=wizard.preview;
      html=`<h2>Проверка перед запуском</h2><p>${preview.slots.length} занятий · ${s.weeks} недель · до ${preview.slots.at(-1).date}${s.horizon?` · ориентир ${s.horizon} недель`:''}.</p><p>Будущие веса зависят от выполнения. Неизвестный максимум не прогнозируется. Тест + восемь прибавок — минимум девять занятий.</p>${wizard.replacements?.length?`<div class="training-message">Замены на доступные пары:<br>${wizard.replacements.map(esc).join('<br>')}</div>`:''}<details open><summary>Первая волна / первые четыре недели</summary>${preview.slots.slice(0,8).map(slot=>slotView(slot)).join('')}</details><p class="muted">${wizard.existing?'Изменятся только незапущенные назначения. Начатые занятия и история сохранятся.':'После запуска конфигурация и версия методик сохранятся вместе с программой.'}</p>`;
    }
    dialog.innerHTML=`<form id="progressionForm"><div class="dialog-heading"><p class="eyebrow">${step+1} / 4 · ${wizard.existing?'БУДУЩИЕ НАСТРОЙКИ':'НОВАЯ ПРОГРЕССИЯ'}</p>${button('close-dialog','Закрыть')}</div>${html}<p id="wizardError" class="form-error" role="alert"></p><div class="dialog-actions">${step?button('wizard-back','Назад'):''}${step===3?`${!wizard.existing?button('save-draft','Сохранить черновик'):''}<button class="button button--primary" type="submit">${wizard.existing?'Применить к будущему':'Запустить прогрессию'}</button>`:'<button class="button button--primary" type="submit">Далее</button>'}</div></form>`;
    dialog.scrollTop=0;dialog.querySelector('h2')?.setAttribute('tabindex','-1');dialog.querySelector('h2')?.focus();
    if(wizard.existing&&step===0){for(const name of ['start','weeks'])dialog.querySelector(`[name=${name}]`).readOnly=true;dialog.querySelectorAll('[name=day]').forEach(el=>el.disabled=true);}
  }
  function readStep(validate=true) {
    const f=new FormData(dialog.querySelector('form')),s=wizard.settings,step=wizard.step;
    if(step===0){s.name=String(f.get('name')).trim();s.start=f.get('start');s.weeks=Number(f.get('weeks'));s.horizon=f.get('horizon')?Number(f.get('horizon')):null;s.days=f.getAll('day').map(Number);
      for(const a of ARMS)s.arms[a]=f.getAll('arm').includes(a)?s.arms[a]||defaultArm():null;
      if(wizard.existing)s.days=clone(wizard.existing.config.days);
      if(validate){dateSequence(s.start,s.days,2);if(!ARMS.some(a=>s.arms[a]))throw new Error('Выбери хотя бы одну руку.');}
    } else if(step<=2){const a=ARMS[step-1],c=s.arms[a];
      for(const key of ['method','pair','standard','goal','readiness','referencePair'])if(f.has(key))c[key]=f.get(key);
      for(const key of ['sets','low','high','rest','restB','restDeload','base','initialA','initialB','referenceSets','referenceReps'])if(f.has(key))c[key]=Number(f.get(key));
      c.allowed=f.getAll('allowed');c.baseConfirmed=f.has('baseConfirmed');c.reviewed=f.has('reviewed');
      c.pairConfirmed=f.has('pairConfirmed');
      for(const [k,v] of f)if(k.startsWith('override-'))c.overrides[k.slice(9)]=v;
      if(validate)validateConfig(c);
    }
  }
  function preparePreview(){
    wizard.preview=createProgression(wizard.settings);wizard.replacements=[];
    for(const a of ARMS){const c=wizard.settings.arms[a];if(!c||c.method!=='wave')continue;
      for(const [kg,pair] of Object.entries(c.overrides)){const accepted=wizard.preview.slots.flatMap(s=>s.plan[a]).find(s=>keyPair(s)===pair);if(Number(kg)!==pairKey(pair).kg)wizard.replacements.push(`${ARM_LABELS[a]}: ${kg} → ${pairKey(pair).kg} кг`);}
      for(const key of Object.keys(c.overrides)){const pair=pairKey(c.overrides[key]);if(!c.allowed.includes(keyPair(pair))){const less=c.allowed.map(pairKey).filter(p=>p.kg<=pair.kg).sort((a,b)=>b.kg-a.kg)[0];if(less)wizard.replacements.push(`${ARM_LABELS[a]}: исключена ${pair.kg}, принята ${less.kg} кг`);}}
    }
  }
  async function saveWizard(draft=false){
    let p=wizard.preview;
    if(wizard.existing){p=clone(wizard.existing);p.config=clone(wizard.settings);p.name=p.config.name;
      for(const a of ARMS){if(!p.config.arms[a])delete p.arms[a];else if(!p.arms[a]||p.arms[a].method!==p.config.arms[a].method)p.arms[a]=clone(wizard.preview.arms[a]);else p.arms[a].pair=p.config.arms[a].pair;}
      p.revision++;p.decisions.push({id:newId(),at:new Date().toISOString(),type:'future-settings',reason:'Изменены будущие настройки'});refreshFuture(p);
    }else{p.status=draft?'draft':'active';p.configSnapshot=clone(p.config);}
    await persist(p);dialog.close();wizard=null;showSection('Progression');
  }
  async function action(target){
    const {prog:action,id,arm}=target.dataset;
    if(action==='close-dialog'){dialog.close();return;}
    if(action==='create'){startWizard();return;}
    if(action==='open'){showSection('Progression');render();return;}
    if(action==='resume'){bridge.resume();return;}
    if(action==='wizard-back'){readStep(false);do{wizard.step--;}while(wizard.step>0&&!wizard.settings.arms[ARMS[wizard.step-1]]);renderWizard();return;}
    if(action==='save-draft'){await saveWizard(true);return;}
    let p=clone(program());if(!p)return;
    const slot=p.slots.find(s=>s.id===id);
    if(action==='start'||action==='retry'){await bridge.start(p,slot);return;}
    if(action==='history'||action==='attempts'){bridge.history(p.id);return;}
    if(action==='current'){const el=document.getElementById(`slot-${currentSlot(p)?.id}`);if(el){let parent=el.parentElement;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}el.scrollIntoView({block:'start',behavior:'smooth'});}return;}
    if(action==='future-settings'){startWizard(p);return;}
    if(action==='activate'){
      if(p.pausedAt){const days=Math.floor((Date.now()-Date.parse(p.pausedAt))/86400000);if(!confirm(`Перерыв ${days} дн. Продолжить с прежними назначениями? Отмена — сначала пересмотри будущие настройки.`))return;}
      p.status='active';
    }
    if(action==='pause'){p.status='paused';p.pausedAt=new Date().toISOString();}
    if(action==='finish'){if(!confirm('Завершить программу с текущим процентом прохождения? История останется.'))return;p.status='completed';p.completionReason=Object.values(p.arms).every(s=>s.goalDone)?'goal':'user';}
    if(action==='archive'){if(!confirm('Убрать программу в архив? Тренировки сохранятся.'))return;p.status='archived';}
    if(action==='extend'){const answer=prompt('На сколько недель продлить? Процент прохождения будет пересчитан.','4');if(answer===null)return;p=extend(p,Number(answer));}
    if(action==='extend-wave'){p=extend(p,4);p.needsExtension=null;}
    if(action==='keep-period')p.needsExtension=null;
    if(action==='skip'||action==='advance-partial'||action==='resolve-deletion'){
      if(!confirm('Продолжить программу без зачёта этого занятия?'))return;
      slot.closed=true;slot.needsResolution=false;if(action==='skip'||action==='resolve-deletion')slot.status='skipped';
      for(const a of ARMS)if(p.arms[a]?.method==='wave'&&slot.before[a]&&p.arms[a].blockId===slot.before[a].blockId&&p.arms[a].index<=slot.before[a].index){p.arms[a].index=slot.before[a].index+1;if(p.arms[a].index>=8)p.arms[a].pending={type:'wave',reason:'Волна завершена с пропусками: повышение не подтверждено.'};slot.applied[a]={success:false};}
      refreshFuture(p);
    }
    if(action==='move'){
      if(slot.status!=='planned')throw new Error('Перенос доступен для незапущенных занятий.');
      const date=prompt('Новая дата занятия (ГГГГ-ММ-ДД)',slot.date);if(!date)return;if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))throw new Error('Некорректная дата.');
      const previous=p.slots[slot.index-1];if(previous&&date<=previous.date)throw new Error('Дата должна идти после предыдущего занятия.');
      const following=p.slots.slice(slot.index+1).filter(s=>s.status==='planned'&&!s.attempts.length);
      if(following.length&&confirm('Сдвинуть последующие даты, сохранив дни недели и порядок?')){
        const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+1);const start=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        dateSequence(start,p.config.days,following.length).forEach((date,i)=>following[i].date=date);
      }else if(following[0]&&date>=following[0].date)throw new Error('Дата нарушает порядок. Перенеси и следующие занятия.');
      slot.date=date;
    }
    if(action==='edit-slot'){editSlot(p,slot);return;}
    if(action.startsWith('decide-')||action==='finish-arm'){
      let choice={action:action.replace('decide-','')};
      if(choice.action==='wave')choice={action:'wave',a:Number(document.getElementById(`decision-${arm}-a`).value),b:Number(document.getElementById(`decision-${arm}-b`).value),nextStage:!!document.getElementById(`stage-${arm}`)?.checked};
      if(choice.action==='retest')choice.pair=document.getElementById(`retest-${arm}`).value;
      p=decide(p,arm,choice);
    }
    p.revision++;await persist(p);
  }
  function editSlot(p,slot){
    if(slot.attempts.length||slot.status!=='planned')throw new Error('Начатое назначение нельзя переписать.');
    wizard=null;
    const original=clone(slot.plan),editable=clone(slot.plan);
    function read(){const f=new FormData(dialog.querySelector('form'));for(const a of ARMS)editable[a].forEach((s,i)=>Object.assign(s,pairKey(f.get(`${a}-${i}-pair`)),{reps:Number(f.get(`${a}-${i}-reps`))}));}
    function draw(){
      dialog.innerHTML=`<form id="editProgressionSlot"><h2>Назначение · неделя ${slot.week}</h2><p>Изменение касается только этого занятия; исходная версия сохранится.</p>${ARMS.map(a=>editable[a].length?`<h3>${ARM_LABELS[a]}</h3>${editable[a].map((s,i)=>`<div class="prog-fields"><label>Вес<select name="${a}-${i}-pair">${options(keyPair(s),p.config.arms[a].allowed)}</select></label><label>Повторы<input name="${a}-${i}-reps" type="number" min="1" max="999" value="${s.reps}" required></label></div><div class="prog-actions">${!s.maxTest?`<button type="button" class="button" data-edit="duplicate" data-arm="${a}" data-index="${i}">Дублировать</button>`:''}<button type="button" class="button" data-edit="up" data-arm="${a}" data-index="${i}" ${i===0||s.maxTest||editable[a][i-1]?.maxTest?'disabled':''}>Выше</button><button type="button" class="button" data-edit="delete" data-arm="${a}" data-index="${i}" ${editable[a].length<2||s.maxTest?'disabled':''}>Удалить</button></div>`).join('')}`:'').join('')}<p id="wizardError" class="form-error" role="alert"></p><div class="dialog-actions">${button('close-dialog','Отмена')}<button class="button button--primary">Сохранить</button></div></form>`;
      const form=dialog.querySelector('form');
      form.addEventListener('click',e=>{const b=e.target.closest('[data-edit]');if(!b)return;read();const rows=editable[b.dataset.arm],i=Number(b.dataset.index);if(b.dataset.edit==='duplicate'){const id=newId();rows.splice(i+1,0,{...rows[i],id,plannedSetId:id});}if(b.dataset.edit==='delete')rows.splice(i,1);if(b.dataset.edit==='up'&&i>0)[rows[i-1],rows[i]]=[rows[i],rows[i-1]];draw();});
      form.addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;try{read();slot.revisions.push({revision:slot.revision,plan:original,arms:clone(slot.arms)});slot.plan=editable;for(const a of ARMS)if(slot.arms[a])slot.arms[a].sets=editable[a];slot.manual=true;slot.revision++;p.revision++;await persist(p);dialog.close();}catch(e){dialog.querySelector('#wizardError').textContent=e.message;}finally{busy=false;}});
    }
    draw();
    dialog.showModal();
  }
  function events(container){container.addEventListener('click',async e=>{const target=e.target.closest('[data-prog]');if(!target||busy)return;busy=true;try{await action(target);}catch(e){if(dialog.open&&dialog.querySelector('#wizardError'))dialog.querySelector('#wizardError').textContent=e.message;else error(e);}finally{busy=false;}});}
  events(root);events(dialog);events(document.getElementById('nextProgression'));
  root.addEventListener('change',e=>{if(e.target.id==='programSelect'){selected=e.target.value;render();}});
  dialog.addEventListener('change',e=>{if(e.target.id==='armMethod'){const method=e.target.value;readStep(false);const c=wizard.settings.arms[ARMS[wizard.step-1]];c.rest=method==='double'?240:300;renderWizard();}});
  dialog.addEventListener('submit',async e=>{
    if(e.target.id!=='progressionForm')return;e.preventDefault();if(busy)return;busy=true;
    try{if(wizard.step===3)await saveWizard();else{readStep();do{wizard.step++;}while(wizard.step<=2&&!wizard.settings.arms[ARMS[wizard.step-1]]);if(wizard.step===3)preparePreview();renderWizard();}}catch(e){dialog.querySelector('#wizardError').textContent=e.message;}finally{busy=false;}
  });
  document.getElementById('sectionProgressionButton').addEventListener('click',()=>{showSection('Progression');render();});
  return {render,open(id){selected=id;showSection('Progression');render();}};
}
