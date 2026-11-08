import { createWorkspace, createBlock, createSession, createRow, validateWorkspace, resolveRow } from './block-model.js';
import { saveBlockWorkspace, mergeBackup } from './workout-db.js';
import { BACKUP_FORMAT, BACKUP_VERSION, validateBackup } from './workout-model.js';
import { validateProgressions } from './progression-backup.js';
import { blockView, dialogView, addDate, today, calendarLayout, calendarWeekSessions, canRepeatCalendarWeek } from './block-view.js';
import { showSection } from './navigation.js';

const clone = value => structuredClone(value);
const id = () => crypto.randomUUID();
const copySession = (s,date=s.date) => ({...clone(s),id:id(),date,arms:Object.fromEntries(['right','left'].map(a=>[a,s.arms[a].map(r=>({...clone(r),id:id()}))]))});
const daysBetween = (a,b) => Math.round((Date.parse(`${b}T12:00:00Z`)-Date.parse(`${a}T12:00:00Z`))/86400000);

export function initBlockUI(bridge) {
  const root=document.getElementById('blockRoot'), dialog=document.getElementById('blockDialog'), file=document.getElementById('blockImportFile');
  const state={workspace:clone(bridge.getState().blockWorkspace||createWorkspace()),blockId:null,sessionId:null,arm:'right',editArms:'both',week:0,range:'3',source:'combined',includeWarmup:false,workouts:bridge.getState().workouts,saveStatus:''};
  state.blockId=state.workspace.blocks[0]?.id||null;
  if(state.workspace.blocks[0]?.weeks<=3)state.range='all';
  let pending=Promise.resolve(), dialogKind=null, dialogExtra={}, saving=0, inputTimer;
  const block=()=>state.workspace.blocks.find(b=>b.id===state.blockId);
  const session=()=>block()?.sessions.find(s=>s.id===state.sessionId);
  const error=e=>{document.getElementById('blockMessage').textContent=e.message||String(e);};
  const clearError=()=>{document.getElementById('blockMessage').textContent='';};
  function render() {
    const focused=root.contains(document.activeElement)?document.activeElement:null;
    const focusKey=focused?.dataset.rowField?`[data-row-id="${focused.closest('[data-row-id]').dataset.rowId}"] [data-row-field="${focused.dataset.rowField}"]`:focused?.dataset.sessionField?`[data-session-field="${focused.dataset.sessionField}"]`:null;
    const scroll=root.querySelector('.block-editor')?.scrollTop;
    root.innerHTML=blockView(state);
    if(focusKey)root.querySelector(focusKey)?.focus({preventScroll:true});
    if(scroll)root.querySelector('.block-editor').scrollTop=scroll;
  }
  async function commit(next) {
    const validated=validateWorkspace(next);
    state.workspace=validated;state.saveStatus='Сохранение…';saving++;clearError();render();
    const operation=pending.catch(()=>{}).then(()=>saveBlockWorkspace(validated));pending=operation;
    try{await operation;state.saveStatus='Сохранено на устройстве';await bridge.reload();}
    catch(e){state.saveStatus='Не сохранено';throw e;}
    finally{saving--;if(!saving)render();}
  }
  function open(kind,extra={}) {
    dialogKind=kind;dialogExtra=extra;dialog.innerHTML=dialogView(kind,state,extra);dialog.showModal();
    dialog.querySelector('input,select,button')?.focus();
  }
  async function change(mutator) { const next=clone(state.workspace);mutator(next);await commit(next); }
  function selected(next) { return next.blocks.find(b=>b.id===state.blockId); }
  function selectedSession(next) { return selected(next).sessions.find(s=>s.id===state.sessionId); }
  function preset(count) {
    const percent={5:70,4:75,3:80,2:85}[count];
    return [createRow({role:'warmup',sets:1,reps:1,value:percent-25,restSec:90}),createRow({role:'warmup',sets:1,reps:1,value:percent-15,restSec:90}),createRow({role:'warmup',sets:1,reps:1,value:percent-5,restSec:120}),createRow({sets:count,reps:count,value:percent,restSec:180}),createRow({sets:2,reps:8,value:55,restSec:120})];
  }
  async function start() {
    await pending;
    const s=session(), b=block(), sets={right:[],left:[]}, maxima={};
    for(const a of ['right','left']){
      maxima[a]=state.workspace.profile[a].maxKg;
      for(const row of s.arms[a]){
        const r=resolveRow(row,state.workspace.profile[a]);if(!r.available)throw new Error(r.reason);
        for(let n=0;n<row.sets;n++){const setId=id();sets[a].push({id:setId,plannedSetId:setId,i:r.pair.i,j:r.pair.j,kg:r.actualKg,reps:row.reps,role:row.role,restSec:row.restSec,rir:row.rir,status:'pending',blockRowId:row.id,blockMaxKg:maxima[a],calcVersion:'spring-0.3008-1.8637-2.98'});}
      }
    }
    if(!sets.right.length&&!sets.left.length)throw new Error('Добавьте подходы.');
    await bridge.start({title:s.title,sets,restSec:0,sourceTemplateId:null,blockId:b.id,blockSessionId:s.id,blockContext:{name:b.name,plannedDate:s.date,maxima}});
  }
  async function exportData() {
    await pending;await bridge.reload();
    const data={...bridge.getState(),blockWorkspace:state.workspace};
    const backup={format:BACKUP_FORMAT,version:BACKUP_VERSION,exportedAt:new Date().toISOString(),data};
    const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob), link=document.createElement('a');
    link.href=url;link.download=`hvat-${today()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function onAction(target) {
    const name=target.dataset.blockAction;clearError();
    if(name==='close-dialog'){dialog.close();return;}
    if(['profile','new-block','edit-block','model','copy-session','delete-block','delete-session'].includes(name)){open(name);return;}
    if(name==='repeat-week'){open(name,{week:Number(target.dataset.week)});return;}
    if(name==='import'){file.click();return;}
    if(name==='export'){await exportData();return;}
    if(name==='analysis-arm'){state.arm=target.dataset.arm;render();return;}
    if(name==='select-session'){state.sessionId=target.dataset.id;state.anchorDate=session().date;render();if(innerWidth<1200)root.querySelector('.block-editor')?.scrollIntoView({block:'start'});return;}
    if(name==='close-editor'){state.sessionId=null;render();return;}
    if(name==='week-prev'||name==='week-next'){const weeks=calendarLayout(block()).weeks,step=Number(state.range==='all'?weeks:state.range);state.week=Math.max(0,Math.min(Math.max(0,weeks-step),state.week+(name==='week-prev'?-1:1)*step));render();return;}
    if(name==='add-session'){
      const s=createSession(target.dataset.date||block().start);state.sessionId=s.id;
      await change(next=>selected(next).sessions.push(s));root.querySelector('[data-session-field="title"]')?.focus();return;
    }
    if(name==='copy-block'){
      const b=clone(block());b.id=id();b.name=`${b.name.slice(0,90)} · копия`;b.sessions=b.sessions.map(s=>copySession(s));state.blockId=b.id;state.sessionId=null;state.week=0;
      await change(next=>next.blocks.push(b));return;
    }
    if(name==='copy-hand'){
      const from=state.editArms,to=from==='right'?'left':'right';
      await change(next=>{const s=selectedSession(next);s.arms[to]=s.arms[from].map(r=>({...r,id:id()}));});return;
    }
    if(name==='preset'){
      const arms=state.editArms==='both'?['right','left']:[state.editArms];
      await change(next=>{const s=selectedSession(next);for(const a of arms)s.arms[a].push(...preset(Number(target.dataset.count)));});return;
    }
    if(name==='add-row'){await change(next=>selectedSession(next).arms[target.dataset.arm].push(createRow()));return;}
    if(name.startsWith('row-')){
      const parent=target.closest('[data-row-id]');
      await change(next=>{const rows=selectedSession(next).arms[parent.dataset.rowArm], i=rows.findIndex(r=>r.id===parent.dataset.rowId);
        if(name==='row-delete')rows.splice(i,1);
        if(name==='row-copy')rows.splice(i+1,0,{...rows[i],id:id()});
        if(name==='row-up'&&i>0)[rows[i-1],rows[i]]=[rows[i],rows[i-1]];
        if(name==='row-down'&&i<rows.length-1)[rows[i],rows[i+1]]=[rows[i+1],rows[i]];
      });return;
    }
    if(name==='start-session')await start();
  }
  root.addEventListener('click',e=>{const target=e.target.closest('[data-block-action]');if(target&&!target.disabled)onAction(target).catch(error);});
  root.addEventListener('input',e=>{
    if(!['sets','reps','value','restSec'].includes(e.target.dataset.rowField))return;
    clearTimeout(inputTimer);const el=e.target;
    inputTimer=setTimeout(()=>{if(el.isConnected&&el.checkValidity())el.dispatchEvent(new Event('change',{bubbles:true}));},300);
  });
  root.addEventListener('change',async e=>{
    clearTimeout(inputTimer);
    const el=e.target;
    try{
      if(el.dataset.blockControl){
        const key=el.dataset.blockControl;
        if(key==='block'){state.blockId=el.value;state.sessionId=null;state.week=0;state.anchorDate='';state.range=block().weeks<=3?'all':'3';}
        if(key==='range'){state.range=el.value;state.week=0;}
        if(key==='edit-arms')state.editArms=el.value;
        if(key==='source')state.source=el.value;
        if(key==='warmup')state.includeWarmup=el.checked;
        if(key==='anchor')state.anchorDate=el.value;
        render();return;
      }
      if(!el.checkValidity()){el.reportValidity();return;}
      if(el.dataset.sessionField){await change(next=>{selectedSession(next)[el.dataset.sessionField]=el.value;});return;}
      if(el.dataset.rowField){
        const parent=el.closest('[data-row-id]'), key=el.dataset.rowField;
        await change(next=>{const row=selectedSession(next).arms[parent.dataset.rowArm].find(r=>r.id===parent.dataset.rowId);row[key]=['sets','reps','value','restSec'].includes(key)?Number(el.value):el.value;});
      }
    }catch(e){error(e);}
  });
  dialog.addEventListener('click',e=>{if(e.target.closest('[data-block-action="close-dialog"]'))dialog.close();});
  dialog.addEventListener('submit',async e=>{
    e.preventDefault();const form=e.target;if(!form.reportValidity())return;
    const f=new FormData(form), next=clone(state.workspace), b=selected(next);let nextId=null;
    try{
      if(dialogKind==='profile'){
        for(const a of ['right','left'])next.profile[a]={maxKg:f.get(a+'-max')===''?null:Number(f.get(a+'-max')),date:f.get(a+'-date')||''};
        next.profile.sex=f.get('sex');next.profile.age=f.get('age')===''?null:Number(f.get('age'));
      }else if(dialogKind==='new-block'){
        const created=createBlock({name:String(f.get('name')).trim(),start:f.get('start'),weeks:Number(f.get('weeks'))});next.blocks.push(created);nextId=created.id;state.range=created.weeks<=3?'all':'3';
      }else if(dialogKind==='edit-block'){
        const start=f.get('start'),delta=daysBetween(b.start,start);b.name=String(f.get('name')).trim();b.start=start;b.weeks=Number(f.get('weeks'));b.sessions.forEach(s=>s.date=addDate(s.date,delta));
      }else if(dialogKind==='model')for(const key of ['volumeHalfLife','heavyHalfLife','heavyThreshold'])next.model[key]=Number(f.get(key));
      else if(dialogKind==='copy-session'){const copied=copySession(session(),f.get('date'));copied.title=String(f.get('title')).trim();b.sessions.push(copied);state.sessionId=copied.id;}
      else if(dialogKind==='repeat-week'){
        const source=dialogExtra.week,target=Number(f.get('targetWeek'));
        const sessions=calendarWeekSessions(b,source);
        if(!sessions.length)throw new Error('В выбранной неделе нет занятий.');
        if(!canRepeatCalendarWeek(b,source,target))throw new Error('Все скопированные занятия должны оставаться в пределах блока. Выберите другую неделю.');
        b.sessions.push(...sessions.map(s=>copySession(s,addDate(s.date,(target-source)*7))));state.week=target;
      }else if(dialogKind==='delete-session'){b.sessions=b.sessions.filter(s=>s.id!==state.sessionId);state.sessionId=null;}
      else if(dialogKind==='delete-block'){next.blocks=next.blocks.filter(x=>x.id!==b.id);nextId=next.blocks[0]?.id||null;state.sessionId=null;}
      validateWorkspace(next);if(nextId!==null||dialogKind==='delete-block')state.blockId=nextId;
      await commit(next);dialog.close();
    }catch(e){document.getElementById('blockDialogError').textContent=e.message;}
  });
  file.addEventListener('change',async()=>{
    const incoming=file.files[0];if(!incoming)return;
    try{
      if(incoming.size>25*1024*1024)throw new Error('Размер копии превышает 25 МБ.');
      await pending;
      const data=validateBackup(JSON.parse(await incoming.text()));validateProgressions(data);
      await mergeBackup(data);await bridge.reload();state.workspace=clone(bridge.getState().blockWorkspace);state.blockId=state.workspace.blocks[0]?.id||null;state.sessionId=null;
      state.saveStatus='Импорт завершён';render();
    }catch(e){error(e);}finally{file.value='';}
  });
  document.getElementById('sectionBlockButton').addEventListener('click',()=>{state.workouts=bridge.getState().workouts;showSection('Block');render();});
  render();
  if(location.hash==='#block')showSection('Block');
  return {refresh(workspace,workouts){state.workouts=workouts;if(workspace&&!saving)state.workspace=clone(workspace);if(!state.workspace.blocks.some(b=>b.id===state.blockId))state.blockId=state.workspace.blocks[0]?.id||null;if(!document.getElementById('sectionBlock').classList.contains('hidden'))render();}};
}
