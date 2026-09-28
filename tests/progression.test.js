import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultArm,createProgression,currentSlot,applyWorkout,materializeTest,decide,progress,assignment,lowerPair,extend,waveSuggestion } from '../js/progression-model.js';
import { validateBackup,PAIRS } from '../js/workout-model.js';
import { validateProgressions,copyProgressionGraph } from '../js/progression-backup.js';
const config=method=>({...defaultArm(method),baseConfirmed:true,reviewed:true});
const program=(right='double',left=null)=>createProgression({name:'Тест',start:'2026-09-28',weeks:32,days:[1,5],arms:{right:right?config(right):null,left:left?config(left):null}});
const quality={technique:true,pain:false,rir:'2',topRir:'1'};
function workout(p,alter=()=>{},slot=currentSlot(p)) {
  const w={id:crypto.randomUUID(),title:'Занятие',progressionId:p.id,plannedSessionId:slot.id,
    initialPlan:structuredClone(slot.plan),sets:structuredClone(slot.plan),startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),restSec:0,feedback:{right:quality,left:quality}};
  for(const arm of ['right','left'])for(const s of w.sets[arm])Object.assign(s,{status:'done',actualReps:s.reps,quality:'valid',completedAt:w.endedAt});
  alter(w);return w;
}
test('all wave weights are real pairs; first A and B match approved preset',()=>{
  const p=program('wave');assert.equal(p.slots.length,64);
  assert.deepEqual(p.slots[0].plan.right.filter(s=>s.role==='main').map(s=>[s.i,s.j,s.reps]),Array(4).fill([3,12,4]));
  assert.equal(p.slots[1].plan.right.find(s=>s.role==='main').kg,67.8);
  assert.ok(p.slots.every(s=>s.plan.right.every(r=>PAIRS.some(p=>p.i===r.i&&p.j===r.j))));
  assert.equal(p.slots[32].arms.right.stage,2);
});
test('independent double progression only proposes the successful arm',()=>{
  let p=program('double','double');p=applyWorkout(p,workout(p,w=>{w.sets.right.forEach(s=>s.actualReps=10);w.sets.left[0].actualReps=2;}));
  assert.equal(p.arms.right.pending.type,'increase');assert.equal(p.arms.left.pending,null);
  p=decide(p,'right',{action:'increase'});assert.notEqual(p.arms.right.pair,p.arms.left.pair);
  assert.equal(currentSlot(p).plan.right[0].reps,6);
});
test('maximum test generates four N-2 sets and nine successful sessions complete the block',()=>{
  let p=program('ladder');
  let w=workout(p);w.sets.right[0].actualReps=9;materializeTest(w,'right',w.sets.right[0]);
  assert.deepEqual(w.sets.right.slice(1).map(s=>s.reps),[7,7,7,7]);
  for(const s of w.sets.right.slice(1))Object.assign(s,{status:'done',actualReps:s.reps,completedAt:w.endedAt});
  p=applyWorkout(p,w);assert.equal(p.arms.right.step,1);
  assert.deepEqual(currentSlot(p).plan.right.map(s=>s.reps),[8,7,7,7]);
  for(let i=0;i<8;i++)p=applyWorkout(p,workout(p));
  assert.equal(progress(p).done,9);assert.equal(p.arms.right.pending.type,'increase');
  p=decide(p,'right',{action:'increase'});assert.equal(p.arms.right.n,null);assert.equal(currentSlot(p).plan.right[0].maxTest,true);
});
test('shortfall resets ladder to baseline, unknown feedback never advances, other arm independent',()=>{
  let p=program('ladder','double');p.arms.right.n=9;p.arms.right.step=3;
  // Regenerate from a persisted state using the same public extension path.
  p=extend(p,1);
  let w=workout(p,x=>{x.sets.right[0].actualReps=1;x.sets.left.forEach(s=>s.actualReps=10);});p=applyWorkout(p,w);
  assert.equal(p.arms.right.step,0);assert.equal(p.arms.right.n,9);assert.equal(p.arms.left.pending.type,'increase');
  assert.deepEqual(currentSlot(p).plan.right.map(s=>s.reps),[7,7,7,7]);
  w=workout(p,x=>x.feedback.right={});p=applyWorkout(p,w);assert.equal(p.arms.right.step,0);
});
test('partial attempts preserve progress, retries credit once and do not double advance',()=>{
  let p=program('double','double');const slotId=currentSlot(p).id;
  let w=workout(p,x=>{x.sets.left=[];x.sets.right.forEach(s=>s.actualReps=10);});p=applyWorkout(p,w);
  assert.equal(progress(p).done,0);assert.equal(currentSlot(p).id,slotId);
  const retry=workout(p);p=applyWorkout(p,retry);assert.equal(progress(p).done,1);
  assert.equal(applyWorkout(p,retry).slots[0].attempts.length,2);
});
test('zero max cannot generate invalid sets; missing feedback and pain block increases',()=>{
  let p=program(null,'ladder'),w=workout(p);w.sets.left[0].actualReps=0;materializeTest(w,'left',w.sets.left[0]);
  assert.equal(w.sets.left.length,1);p=applyWorkout(p,w);assert.equal(p.arms.left.pending.type,'retest');
  p=program('double');w=workout(p,x=>{x.sets.right.forEach(s=>s.actualReps=10);x.feedback.right={technique:true,pain:true};});p=applyWorkout(p,w);assert.equal(p.arms.right.pending,null);
});
test('program backup graph survives validation and remapping without mixing identities',()=>{
  let p=program(null,'double');const w=workout(p);p=applyWorkout(p,w);
  const raw={format:'hvat-backup',version:2,data:{templates:[],workouts:[w],manualRecords:[],active:null,settings:{sound:true},progressions:[p]}};
  const data=validateProgressions(validateBackup(raw));assert.equal(data.workouts[0].sets.right.length,0);
  const copy=copyProgressionGraph(p,[w],null);assert.notEqual(copy.program.id,p.id);assert.equal(copy.workouts[0].progressionId,copy.program.id);
  assert.equal(copy.program.slots[0].attempts[0],copy.workouts[0].id);
  validateProgressions({...data,workouts:copy.workouts,progressions:[copy.program]});
  raw.data.progressions[0].slots[0].attempts.push('missing');assert.throws(()=>validateProgressions(validateBackup(raw)),/связи/);
});
test('no rounding upward, extension changes denominator but preserves historical plan',()=>{
  const c=config('double');c.allowed=['7-12','9-11'];assert.equal(lowerPair(c,100).kg,99.4);assert.throws(()=>lowerPair(c,90));
  let p=program('double');p=applyWorkout(p,workout(p));const before=structuredClone(p.slots[0]);p=extend(p,4);
  assert.equal(p.slots.length,72);assert.deepEqual(p.slots[0],before);assert.equal(progress(p).done,1);
});

test('wave promotion uses three successful sessions per direction and all four levels before stage 2',()=>{
  let p=program('wave');
  for(let level=1;level<=4;level++) {
    for(let i=0;i<8;i++)p=applyWorkout(p,workout(p));
    const suggestion=waveSuggestion(p.arms.right);
    assert.equal(suggestion.aOK,true);assert.equal(suggestion.bOK,true);
    assert.equal(suggestion.nextStage,level===4);
    p=decide(p,'right',{action:'wave',a:suggestion.a,b:suggestion.b,nextStage:suggestion.nextStage});
  }
  assert.equal(p.arms.right.stage,2);assert.equal(currentSlot(p).index,32);
  for(let level=1;level<=4;level++) {
    for(let i=0;i<6;i++)p=applyWorkout(p,workout(p));
    if(level===4){assert.equal(p.arms.right.pending.type,'taper');break;}
    for(let i=0;i<2;i++)p=applyWorkout(p,workout(p));
    const suggestion=waveSuggestion(p.arms.right);p=decide(p,'right',{action:'wave',a:suggestion.a,b:suggestion.b});
  }
  p=decide(p,'right',{action:'taper'});
  const taper=currentSlot(p),testSlot=p.slots[taper.index+1];
  assert.equal((Date.parse(testSlot.date)-Date.parse(taper.date))/86400000,4);
  assert.equal(testSlot.plan.right.at(-1).kg,99.4);
  p=applyWorkout(p,workout(p));p=applyWorkout(p,workout(p));
  assert.equal(p.arms.right.goalDone,true);p=decide(p,'right',{action:'finish-arm'});assert.equal(p.status,'completed');
});

test('failed B cannot be compensated by A, extra reps or a warmup; skips do not credit',()=>{
  let p=program('wave');
  for(let i=0;i<8;i++)p=applyWorkout(p,workout(p,w=>{if(i===5)w.sets.right.find(s=>s.role==='main').actualReps=0;}));
  const suggestion=waveSuggestion(p.arms.right);assert.equal(suggestion.a,2);assert.equal(suggestion.b,1);
  p=decide(p,'right',{action:'wave',a:2,b:1});assert.equal(p.needsExtension.weeks,4);
  p=program('wave');const w=workout(p,x=>{x.sets.right[0].status='skipped';delete x.sets.right[0].actualReps;});p=applyWorkout(p,w);
  assert.equal(progress(p).done,0);assert.equal(p.slots[0].status,'partial');
});
