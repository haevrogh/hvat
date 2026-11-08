import { applyWorkout, clone, currentSlot } from './progression-model.js';
import { copyProgressionGraph, validateProgressions } from './progression-backup.js';
import { createWorkspace, validateWorkspace } from './block-model.js';
import { mergeWorkspaceGraph, remapBlockWorkout } from './block-storage.js';
import { validateCycle, transitionCycle, cyclePlan, getCycleSession } from './cycle-model.js';
import { validActiveWorkout, validateBackup, BACKUP_FORMAT, BACKUP_VERSION } from './workout-model.js';
const DB_NAME = 'hvat-training';
const DB_VERSION = 3;
const STORES = ['templates','workouts','manualRecords','meta','progressions'];
let dbPromise;
function openDb() {
  if(!dbPromise) dbPromise=new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=event=>{
      for(const name of STORES)if(!r.result.objectStoreNames.contains(name))r.result.createObjectStore(name,{keyPath:'id'});
      // The approved v3 replacement starts a new training journal once, in the upgrade transaction.
      if(event.oldVersion>0){
        for(const name of STORES.filter(n=>n!=='meta'))r.transaction.objectStore(name).clear();
        const meta=r.transaction.objectStore('meta'),settings=meta.get('settings');
        settings.onsuccess=()=>{meta.clear();if(settings.result)meta.put(settings.result);};
      }
    };
    r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();dbPromise=null;};resolve(r.result);};
    r.onerror=()=>{dbPromise=null;reject(r.error);};
    r.onblocked=()=>{dbPromise=null;reject(new Error('Закрой другие вкладки HVAT и повтори обновление.'));};
  });
  return dbPromise;
}
function stateFrom(raw) {
  const active=raw.meta.find(r=>r.id==='active')?.value||null;
  if(active)for(const arm of ['right','left']){
    active.initialPlan[arm].forEach(s=>{s.plannedSetId ||= s.id;});
    active.sets[arm].forEach((s,i)=>{s.plannedSetId ||= active.initialPlan[arm][i]?.plannedSetId||s.id;});
  }
  return {templates:raw.templates,workouts:raw.workouts,manualRecords:raw.manualRecords,progressions:raw.progressions,
    blockWorkspace:raw.meta.find(r=>r.id==='blockWorkspace')?.value||createWorkspace(),
    endlessCycle:raw.meta.find(r=>r.id==='endlessCycle')?.value||null,
    active,settings:raw.meta.find(r=>r.id==='settings')?.value||{sound:true},pendingImports:raw.meta.find(r=>r.id==='pendingImports')?.value||[]};
}
async function atomic(change,readonly=false) {
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORES,readonly?'readonly':'readwrite'),raw={};let remaining=STORES.length,result,error;
    for(const name of STORES){const r=tx.objectStore(name).getAll();r.onsuccess=()=>{
      raw[name]=r.result;if(--remaining)return;
      try{
        const action=change(stateFrom(raw));result=action.result;
        for(const [store,rows] of Object.entries(action.puts||{}))for(const row of rows)tx.objectStore(store).put(row);
        for(const [store,ids] of Object.entries(action.deletes||{}))for(const id of ids)tx.objectStore(store).delete(id);
      }catch(e){error=e;tx.abort();}
    };}
    tx.oncomplete=()=>{if(!readonly)document.dispatchEvent(new Event('hvat-data-change'));resolve(result);};
    tx.onabort=()=>reject(error||tx.error);tx.onerror=()=>reject(error||tx.error);
  });
}
export const readAll=()=>atomic(state=>({result:state}),true);
export const getAll=store=>atomic(state=>({result:state[store]}),true);
export const getBlockWorkspace=()=>atomic(state=>({result:validateWorkspace(state.blockWorkspace)}),true);
export const getCycle=()=>atomic(state=>({result:state.endlessCycle?validateCycle(state.endlessCycle):null}),true);
function cycleMutable(state, nextId=state.endlessCycle?.id) {
  if(state.active?.cycleId && [state.endlessCycle?.id,nextId].includes(state.active.cycleId))throw new Error('Сначала заверши или отмени тренировку цикла.');
}
function cycleRevision(cycle, expectedRevision) {
  if(expectedRevision!==undefined && cycle?.revision!==expectedRevision)throw new Error('Цикл уже изменён. Открой его заново.');
}
export function saveCycle(raw, expectedRevision) {
  const cycle=validateCycle(raw);
  return atomic(state=>{
    cycleMutable(state,cycle.id);cycleRevision(state.endlessCycle,expectedRevision);
    if(state.endlessCycle && expectedRevision===undefined && (state.endlessCycle.id!==cycle.id || state.endlessCycle.revision>cycle.revision))throw new Error('Цикл уже существует или изменён. Открой его заново.');
    return {puts:{meta:[{id:'endlessCycle',value:cycle}]},result:cycle};
  });
}
export function cycleAction(action, expectedRevision) {
  return atomic(state=>{
    if(!state.endlessCycle)throw new Error('Цикл не создан.');
    cycleMutable(state);cycleRevision(state.endlessCycle,expectedRevision);
    const cycle=transitionCycle(state.endlessCycle,action);
    return {puts:{meta:[{id:'endlessCycle',value:cycle}]},result:cycle};
  });
}
export function saveBlockWorkspace(raw) {
  const workspace=validateWorkspace(raw);
  return atomic(()=>({puts:{meta:[{id:'blockWorkspace',value:workspace}]},result:workspace}));
}
export function mergeBlockWorkspace(raw) {
  const workspace=validateWorkspace(raw);
  return atomic(state=>{
    const merged=mergeWorkspaceGraph(state.blockWorkspace,workspace);
    return {puts:{meta:[{id:'blockWorkspace',value:merged.workspace}]},result:merged.workspace};
  });
}
export const put=(store,value)=>atomic(()=>({puts:{[store]:[value]}}));
export const remove=(store,id)=>atomic(()=>({deletes:{[store]:[id]}}));
export const getMeta=async(id,fallback=null)=>{const db=await openDb();return new Promise((resolve,reject)=>{const r=db.transaction('meta').objectStore('meta').get(id);r.onsuccess=()=>resolve(r.result?.value??fallback);r.onerror=()=>reject(r.error);});};
export const setMeta=(id,value)=>id==='active'&&value?atomic(state=>state.active?.id===value.id?{puts:{meta:[{id,value}]}}:{}):put('meta',{id,value});
export const setRestUntil=(id,restUntil)=>atomic(state=>state.active?.id===id?{puts:{meta:[{id:'active',value:{...state.active,restUntil}}]}}:{});
export const setDraftReps=(id,setId,value)=>atomic(state=>{
  if(state.active?.id!==id)return {};
  const current=Object.values(state.active.sets).flat().find(set=>set.id===setId&&set.status==='pending');
  if(!current)return {};
  if(value===null)delete current.draftReps;
  else {
    if(!Number.isInteger(value)||value<0||value>999)throw new Error('Фактические повторы должны быть от 0 до 999.');
    current.draftReps=value;
  }
  return {puts:{meta:[{id:'active',value:state.active}]}};
});
export function saveProgression(program,expectedRevision) {
  return atomic(state=>{
    const old=state.progressions.find(p=>p.id===program.id);
    if(old && (expectedRevision!==undefined?old.revision!==expectedRevision:old.revision>program.revision))throw new Error('Программа уже изменена. Открой её заново.');
    if(state.active?.progressionId===program.id)throw new Error('Сначала заверши или отмени активное занятие этой программы.');
    if(program.status==='active' && state.progressions.some(p=>p.id!==program.id&&p.status==='active'))throw new Error('Сначала приостанови другую активную прогрессию.');
    return {puts:{progressions:[{...program,updatedAt:new Date().toISOString()}]}};
  });
}
export function startWorkout(active) {
  return atomic(state=>{
    if(state.active)throw new Error('Уже есть активная тренировка. Продолжи или отмени её.');
    const puts={meta:[{id:'active',value:active}]};
    if(active.cycleId){
      const cycle=state.endlessCycle;
      if(!validActiveWorkout(active))throw new Error('Повреждено назначение цикла.');
      if(!cycle || cycle.id!==active.cycleId || cycle.status!=='active')throw new Error('Цикл не активен.');
      if(cycle.revision!==active.cycleRevision || cycle.week!==active.cycleWeek || cycle.day!==active.cycleDay)throw new Error('Занятие цикла изменилось. Открой его заново.');
      const expected=cyclePlan(cycle), session=getCycleSession(cycle);
      const fields=['i','j','kg','reps','role','restSec','status','calcVersion','cycleRole','cycleMaxKg','cyclePercent','cycleGroup','cycleId','cycleWeek','cycleDay','cycleRevision'];
      const signature=plan=>JSON.stringify(['right','left'].map(arm=>plan[arm].map(set=>fields.map(field=>set[field]))));
      if(signature(active.initialPlan)!==signature(expected) || signature(active.sets)!==signature(expected)
        || JSON.stringify(active.initialPlan)!==JSON.stringify(active.sets))throw new Error('Начальное назначение не совпадает с планом цикла.');
      const ids=Object.values(active.initialPlan).flat().map(set=>set.id);
      if(new Set(ids).size!==ids.length || Object.values(active.initialPlan).flat().some(set=>set.plannedSetId!==set.id))throw new Error('Повторяющиеся подходы цикла.');
      if(['right','left'].some(arm=>active.cycleContext.maxima[arm]!==expected[arm][0]?.cycleMaxKg)
        || active.cycleContext.light!==session.light)throw new Error('Снимок нагрузки цикла не совпадает с назначением.');
    }
    if(active.progressionId){
      const p=clone(state.progressions.find(p=>p.id===active.progressionId));
      if(!p||p.status!=='active')throw new Error('Программа не активна.');
      const slot=p.slots.find(s=>s.id===active.plannedSessionId);
      if(!slot || slot.revision!==active.slotRevision)throw new Error('Назначения изменились. Открой занятие заново.');
      if(slot.closed||slot.status==='active'||currentSlot(p)?.id!==slot.id)throw new Error('Это занятие уже закрыто или не является следующим.');
      if(Object.values(slot.arms).some(a=>a.unavailable))throw new Error('Нет подходящей пары пружин для этого занятия.');
      if(JSON.stringify(active.initialPlan)!==JSON.stringify(slot.plan)||JSON.stringify(active.sets)!==JSON.stringify(slot.plan))throw new Error('Начальное назначение не совпадает с сохранённым планом.');
      slot.previousStatus=slot.status;slot.status='active';slot.startedAt=active.startedAt;p.revision++;
      puts.progressions=[p];
    }
    return {puts,result:active};
  });
}
export function cancelWorkout(id) {
  return atomic(state=>{
    if(state.active?.id!==id)return {};
    const puts={meta:[{id:'active',value:null}]};
    if(state.active.progressionId){const p=clone(state.progressions.find(p=>p.id===state.active.progressionId)),slot=p.slots.find(s=>s.id===state.active.plannedSessionId);slot.status=slot.previousStatus||'planned';p.revision++;puts.progressions=[p];}
    return {puts};
  });
}
export function restoreImportedWorkout(id) {
  return atomic(state=>{
    if(state.active)throw new Error('Сначала заверши текущее занятие.');
    const candidate=state.pendingImports.find(x=>x.id===id)||state.progressions.find(p=>p.suspendedWorkout?.id===id)?.suspendedWorkout;
    if(!candidate)throw new Error('Импортированное занятие не найдено.');
    const puts={meta:[{id:'active',value:candidate},{id:'pendingImports',value:state.pendingImports.filter(x=>x.id!==id)}]};
    if(candidate.progressionId){const p=clone(state.progressions.find(p=>p.id===candidate.progressionId));p.slots.find(s=>s.id===candidate.plannedSessionId).status='active';delete p.suspendedWorkout;p.revision++;puts.progressions=[p];}
    return {puts};
  });
}
export function finishWorkout(workout) {
  return atomic(state=>{
    if(state.workouts.some(w=>w.id===workout.id))return {result:state.workouts.find(w=>w.id===workout.id)};
    if(state.active?.id!==workout.id)throw new Error('Активная тренировка изменилась. Обнови экран.');
    const puts={workouts:[workout],meta:[{id:'active',value:null}]};
    if(state.active.cycleId){
      const fields=['cycleId','cycleRevision','cycleWeek','cycleDay','cycleContext'];
      if(fields.some(field=>JSON.stringify(workout[field])!==JSON.stringify(state.active[field])))throw new Error('Связь тренировки с циклом изменилась.');
      const cycle=state.endlessCycle;
      if(!workout.partial && cycle?.id===workout.cycleId && cycle.status==='active'
        && cycle.revision===workout.cycleRevision && cycle.week===workout.cycleWeek && cycle.day===workout.cycleDay){
        puts.meta.push({id:'endlessCycle',value:transitionCycle(cycle,{type:'advance'})});
      }
    }
    if(workout.progressionId){const p=state.progressions.find(p=>p.id===workout.progressionId);if(!p)throw new Error('Программа не найдена.');puts.progressions=[applyWorkout(p,workout)];}
    return {puts,result:workout};
  });
}
export function deleteWorkout(id) {
  return atomic(state=>{
    const w=state.workouts.find(w=>w.id===id),puts={};
    if(w?.progressionId){
      if(state.active?.progressionId===w.progressionId)throw new Error('Сначала заверши текущее занятие программы.');
      const p=clone(state.progressions.find(p=>p.id===w.progressionId)),slot=p.slots.find(s=>s.id===w.plannedSessionId);
      slot.attempts=slot.attempts.filter(x=>x!==id);
      if(slot.credited===id){slot.credited=slot.attempts.find(x=>state.workouts.some(w=>w.id===x&&!w.partial))||null;if(!slot.credited){slot.status='skipped';slot.closed=true;}}
      slot.evaluations={};
      p.revision++;p.decisions.push({id:crypto.randomUUID(),type:'deleted-workout',workoutId:id,at:new Date().toISOString()});puts.progressions=[p];
    }
    return {puts,deletes:{workouts:[id]}};
  });
}
export async function mergeBackup(data,choices={}) {
  data=validateBackup({format:BACKUP_FORMAT,version:BACKUP_VERSION,data});
  validateProgressions(data);
  const blockWorkspace=data.blockWorkspace===undefined?createWorkspace():validateWorkspace(data.blockWorkspace);
  const endlessCycle=data.endlessCycle==null?null:validateCycle(data.endlessCycle);
  return atomic(local=>{
    const incoming=clone(data), blocked=new Set();
    const blockMerge=mergeWorkspaceGraph(local.blockWorkspace,blockWorkspace);
    incoming.workouts=incoming.workouts.map(workout=>remapBlockWorkout(workout,blockMerge));
    incoming.active=remapBlockWorkout(incoming.active,blockMerge);
    incoming.pendingImports=(incoming.pendingImports||[]).map(workout=>remapBlockWorkout(workout,blockMerge));
    for(const p of [...incoming.progressions]){
      const old=local.progressions.find(x=>x.id===p.id);
      if(!old)continue;
      if(JSON.stringify(old)===JSON.stringify(p)||choices[p.id]!=='copy'){blocked.add(p.id);continue;}
      const graph=copyProgressionGraph(p,incoming.workouts.filter(w=>w.progressionId===p.id),incoming.active?.progressionId===p.id?incoming.active:null,incoming.pendingImports.filter(w=>w.progressionId===p.id));
      incoming.progressions=incoming.progressions.filter(x=>x.id!==p.id).concat(graph.program);
      incoming.workouts=incoming.workouts.filter(x=>x.progressionId!==p.id).concat(graph.workouts);
      incoming.pendingImports=incoming.pendingImports.filter(x=>x.progressionId!==p.id).concat(graph.pendingImports);
      if(graph.active)incoming.active=graph.active;
    }
    incoming.progressions=incoming.progressions.filter(p=>!blocked.has(p.id));
    incoming.workouts=incoming.workouts.filter(w=>!blocked.has(w.progressionId));
    incoming.pendingImports=incoming.pendingImports.filter(w=>!blocked.has(w.progressionId));
    if(incoming.active&&blocked.has(incoming.active.progressionId))incoming.active=null;
    if(local.progressions.some(p=>p.status==='active'))for(const p of incoming.progressions)if(p.status==='active')p.status='paused';
    const puts={meta:[{id:'blockWorkspace',value:blockMerge.workspace}]},counts={blocks:blockMerge.added};
    if(!local.endlessCycle && endlessCycle)puts.meta.push({id:'endlessCycle',value:endlessCycle});
    for(const store of ['templates','workouts','manualRecords','progressions']){
      const ids=new Set(local[store].map(x=>x.id));puts[store]=incoming[store].filter(x=>{if(ids.has(x.id))return false;ids.add(x.id);return true;});counts[store]=puts[store].length;
    }
    const restore=!local.active&&incoming.active&&choices.active!=='keep';
    if(restore)puts.meta.push({id:'active',value:incoming.active});
    else if(incoming.active?.progressionId){const p=puts.progressions.find(p=>p.id===incoming.active.progressionId);if(p){p.suspendedWorkout=incoming.active;const s=p.slots.find(s=>s.id===incoming.active.plannedSessionId);s.status=s.previousStatus||'planned';}}
    const pending=[...local.pendingImports];
    for(const w of [...(incoming.pendingImports||[]),...(!restore&&incoming.active&&!incoming.active.progressionId?[incoming.active]:[])])if(!pending.some(x=>x.id===w.id)&&!local.workouts.some(x=>x.id===w.id))pending.push(w);
    if(pending.length)puts.meta=[...(puts.meta||[]),{id:'pendingImports',value:pending}];
    return {puts,result:{...counts,active:!!restore}};
  });
}
