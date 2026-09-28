import { applyWorkout, clone, pairKey } from './progression-model.js';
import { copyProgressionGraph, validateProgressions } from './progression-backup.js';
const DB_NAME = 'hvat-training';
const DB_VERSION = 2;
const STORES = ['templates','workouts','manualRecords','meta','progressions'];
let dbPromise;
function openDb() {
  if(!dbPromise) dbPromise=new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{for(const name of STORES)if(!r.result.objectStoreNames.contains(name))r.result.createObjectStore(name,{keyPath:'id'});};
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
export const put=(store,value)=>atomic(()=>({puts:{[store]:[value]}}));
export const remove=(store,id)=>atomic(()=>({deletes:{[store]:[id]}}));
export const getMeta=async(id,fallback=null)=>{const db=await openDb();return new Promise((resolve,reject)=>{const r=db.transaction('meta').objectStore('meta').get(id);r.onsuccess=()=>resolve(r.result?.value??fallback);r.onerror=()=>reject(r.error);});};
export const setMeta=(id,value)=>id==='active'&&value?atomic(state=>state.active?.id===value.id?{puts:{meta:[{id,value}]}}:{}):put('meta',{id,value});
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
    if(active.progressionId){
      const p=clone(state.progressions.find(p=>p.id===active.progressionId));
      if(!p||p.status!=='active')throw new Error('Программа не активна.');
      const slot=p.slots.find(s=>s.id===active.plannedSessionId);
      if(!slot || slot.revision!==active.slotRevision)throw new Error('Назначения изменились. Открой занятие заново.');
      if(Object.values(p.arms).some(s=>s.pending))throw new Error('Сначала подтверди решение о следующем блоке.');
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
      if(slot.credited===id){slot.credited=slot.attempts.find(x=>state.workouts.some(w=>w.id===x&&!w.partial))||null;if(!slot.credited){slot.status='partial';slot.needsResolution=true;}}
      for(const arm of Object.values(p.arms))for(const [key,e] of Object.entries(arm.evaluations))if(e.workoutId===id)delete arm.evaluations[key];
      for(const arm of ['right','left'])if(p.arms[arm]){
        if(slot.applied[arm]?.workoutId===id){delete slot.applied[arm];p.arms[arm].pending=null;}
        p.arms[arm].goalDone=state.workouts.filter(x=>x.id!==id&&x.progressionId===p.id).some(x=>x.feedback?.[arm]?.technique===true&&x.feedback?.[arm]?.pain===false&&x.sets[arm].some(s=>s.status==='done'&&!['invalid','assisted'].includes(s.quality)&&s.actualReps>=6&&s.kg>=(p.config.arms[arm].method==='wave'?pairKey(p.config.arms[arm].goal).kg:Infinity)));
      }
      if(p.completionReason==='goal'&&!Object.values(p.arms).every(s=>s.goalDone))p.completionReason='result-deleted';
      p.revision++;p.decisions.push({id:crypto.randomUUID(),type:'deleted-workout',workoutId:id,at:new Date().toISOString()});puts.progressions=[p];
    }
    return {puts,deletes:{workouts:[id]}};
  });
}
export async function mergeBackup(data,choices={}) {
  validateProgressions(data);
  return atomic(local=>{
    const incoming=clone(data), blocked=new Set();
    for(const p of [...incoming.progressions]){
      const old=local.progressions.find(x=>x.id===p.id);
      if(!old)continue;
      if(JSON.stringify(old)===JSON.stringify(p)||choices[p.id]!=='copy'){blocked.add(p.id);continue;}
      const graph=copyProgressionGraph(p,incoming.workouts.filter(w=>w.progressionId===p.id),incoming.active?.progressionId===p.id?incoming.active:null);
      incoming.progressions=incoming.progressions.filter(x=>x.id!==p.id).concat(graph.program);
      incoming.workouts=incoming.workouts.filter(x=>x.progressionId!==p.id).concat(graph.workouts);
      if(graph.active)incoming.active=graph.active;
    }
    incoming.progressions=incoming.progressions.filter(p=>!blocked.has(p.id));
    incoming.workouts=incoming.workouts.filter(w=>!blocked.has(w.progressionId));
    if(incoming.active&&blocked.has(incoming.active.progressionId))incoming.active=null;
    if(local.progressions.some(p=>p.status==='active'))for(const p of incoming.progressions)if(p.status==='active')p.status='paused';
    const puts={},counts={};
    for(const store of ['templates','workouts','manualRecords','progressions']){
      const ids=new Set(local[store].map(x=>x.id));puts[store]=incoming[store].filter(x=>{if(ids.has(x.id))return false;ids.add(x.id);return true;});counts[store]=puts[store].length;
    }
    const restore=!local.active&&incoming.active&&choices.active!=='keep';
    if(restore)puts.meta=[{id:'active',value:incoming.active}];
    else if(incoming.active?.progressionId){const p=puts.progressions.find(p=>p.id===incoming.active.progressionId);if(p){p.suspendedWorkout=incoming.active;const s=p.slots.find(s=>s.id===incoming.active.plannedSessionId);s.status=s.previousStatus||'planned';}}
    const pending=[...local.pendingImports];
    for(const w of [...(incoming.pendingImports||[]),...(!restore&&incoming.active&&!incoming.active.progressionId?[incoming.active]:[])])if(!pending.some(x=>x.id===w.id)&&!local.workouts.some(x=>x.id===w.id))pending.push(w);
    if(pending.length)puts.meta=[...(puts.meta||[]),{id:'pendingImports',value:pending}];
    return {puts,result:{...counts,active:!!restore}};
  });
}
