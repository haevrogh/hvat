import { ARMS, newId, pairFor, validActiveWorkout } from './workout-model.js';
import { clone, validateConfig } from './progression-model.js';

// Each progression is an aggregate: conflicting graphs are never merged record by record.
export function validateProgressions(data) {
  if(!Array.isArray(data.progressions)) throw new Error('Повреждён список программ.');
  const ids=new Set();
  const id=v=>typeof v==='string' && /^[a-zA-Z0-9:_-]{1,120}$/.test(v);
  const plan=rows=>rows && ARMS.every(a=>Array.isArray(rows[a]) && rows[a].every(s=>id(s.id)&&pairFor(s.i,s.j)&&Number.isFinite(s.kg)&&Number.isInteger(s.reps)&&s.reps>0));
  for(const p of data.progressions) {
    if(!id(p.id)||ids.has(p.id)||!['draft','active','paused','completed','archived'].includes(p.status)||!p.config||!p.arms||!Array.isArray(p.slots)||!Array.isArray(p.decisions)||!Array.isArray(p.blocks)||!Number.isInteger(p.revision)||typeof p.name!=='string'||p.name.length>100||!Array.isArray(p.config.days)||p.config.days.length!==2||p.config.days.some(d=>!Number.isInteger(d)||d<0||d>6)||!Number.isInteger(p.config.weeks)) throw new Error('Повреждена программа.');
    ids.add(p.id);const slots=new Set();
    if(p.suspendedWorkout&&!validActiveWorkout(p.suspendedWorkout))throw new Error('Повреждено отложенное занятие программы.');
    if(!ARMS.some(a=>p.arms[a]))throw new Error('В программе нет участвующих рук.');
    for(const a of ARMS) if(p.arms[a]) {
      validateConfig(p.config.arms[a]);const s=p.arms[a];
      if(![s.wave,s.block].every(n=>Number.isInteger(n)&&n>0))throw new Error('Повреждён номер блока.');
      if(s.method!==p.config.arms[a].method||!id(s.blockId)||!Number.isInteger(s.index)||s.index<0||s.index>8||!Number.isInteger(s.step)||s.step<0||s.step>8||![1,2].includes(s.stage)||![s.levelA,s.levelB].every(n=>Number.isInteger(n)&&n>=1&&n<=4)||!p.config.arms[a].allowed.includes(s.pair)||!s.evaluations||s.n!==null&&(!Number.isInteger(s.n)||s.n<3||s.n>999))throw new Error('Повреждено состояние руки.');
    }
    for(const s of p.slots) {
      if(!id(s.id)||slots.has(s.id)||!plan(s.plan)||!s.before||!s.arms||!Array.isArray(s.attempts)||!Array.isArray(s.revisions)||!s.applied||!Number.isInteger(s.index)||s.index<0||!Number.isInteger(s.week)||s.week<1||!Number.isFinite(Date.parse(s.date))||!['planned','active','completed','modified','partial','skipped','replaced'].includes(s.status))throw new Error('Повреждено занятие программы.');
      slots.add(s.id);
      for(const attempt of s.attempts) if(!data.workouts.some(w=>w.id===attempt&&w.progressionId===p.id&&w.plannedSessionId===s.id))throw new Error('Нарушены связи истории программы.');
      if(s.credited&&!s.attempts.includes(s.credited))throw new Error('Зачтённая попытка отсутствует.');
    }
  }
  for(const w of [...data.workouts,...(data.active?[data.active]:[]),...(data.pendingImports||[]),...data.progressions.filter(p=>p.suspendedWorkout).map(p=>p.suspendedWorkout)]) if(w.progressionId) {
    const p=data.progressions.find(p=>p.id===w.progressionId);
    if(!p?.slots.some(s=>s.id===w.plannedSessionId))throw new Error('Тренировка ссылается на отсутствующее занятие программы.');
  }
  return data;
}
export function copyProgressionGraph(program,workouts,active) {
  const graph={program:clone(program),workouts:clone(workouts),active:active?clone(active):null};
  const map=new Map();
  function collect(value) {
    if(!value||typeof value!=='object')return;
    if(typeof value.id==='string') map.set(value.id,newId());
    for(const [key,v] of Object.entries(value)) {if((key==='blockId'||key==='plannedSetId')&&typeof v==='string'&&!map.has(v))map.set(v,newId());collect(v);}
  }
  collect(graph);
  function remap(value) {
    if(typeof value==='string')return map.get(value)||value;
    if(Array.isArray(value))return value.map(remap);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[map.get(k)||k,remap(v)]));
    return value;
  }
  const result=remap(graph);result.program.name=`${program.name.slice(0,88)} (копия)`;result.program.status='paused';
  return result;
}
