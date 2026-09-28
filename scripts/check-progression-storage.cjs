const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});try{
const p=await b.newPage({viewport:{width:320,height:720}});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:8765/manifest.json');
await p.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('hvat-training',1);r.onupgradeneeded=()=>['templates','workouts','manualRecords','meta'].forEach(n=>r.result.createObjectStore(n,{keyPath:'id'}));r.onsuccess=()=>{const db=r.result,tx=db.transaction(['templates','meta'],'readwrite');const sets={right:[{id:'r',i:1,j:3,kg:16.4,reps:5,status:'pending'}],left:[{id:'l',i:1,j:3,kg:16.4,reps:5,status:'pending'}]};tx.objectStore('templates').put({id:'legacy',name:'Старый шаблон',sets,restSec:90,createdAt:'2026-01-01',updatedAt:'2026-01-01'});tx.objectStore('meta').put({id:'settings',value:{sound:false}});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};}));
await p.goto('http://127.0.0.1:8765/');await p.locator('#sectionTrainingButton').click();await p.getByText('Старый шаблон',{exact:true}).waitFor();
const results=await p.evaluate(async()=>{
const db=await import('./js/workout-db.js'),m=await import('./js/progression-model.js'),w=await import('./js/workout-model.js');let data=await db.readAll();if(data.templates[0].id!=='legacy'||data.settings.sound!==false)throw Error('migration lost data');
let program=m.createProgression({name:'Только левая',weeks:2,start:'2026-09-28',days:[1,5],arms:{right:null,left:m.defaultArm('double')}});program.status='active';await db.saveProgression(program);
const slot=program.slots[0];const active={id:crypto.randomUUID(),title:'Тест',sourceType:'progression',progressionId:program.id,plannedSessionId:slot.id,slotRevision:slot.revision,startedAt:new Date().toISOString(),restSec:0,restUntil:Date.now()+120000,initialPlan:m.clone(slot.plan),sets:m.clone(slot.plan)};
const starts=await Promise.allSettled([db.startWorkout(active),db.startWorkout({...active,id:crypto.randomUUID()})]);if(starts.filter(x=>x.status==='fulfilled').length!==1)throw Error('double start');
active.sets.left[0].draftReps=8;await db.setMeta('active',active);
const workout={...active,endedAt:new Date().toISOString(),partial:false,feedback:{left:{technique:true,pain:false}}};workout.sets.left.forEach(s=>Object.assign(s,{status:'done',actualReps:10,completedAt:workout.endedAt}));
await Promise.all([db.finishWorkout(workout),db.finishWorkout(workout)]);await db.setMeta('active',active);data=await db.readAll();if(data.active||data.workouts.length!==1||data.progressions[0].slots[0].attempts.length!==1)throw Error('atomic finish or stale active');
const backup=w.validateBackup({format:w.BACKUP_FORMAT,version:w.BACKUP_VERSION,data});const again=await db.mergeBackup(backup);if(again.workouts||again.progressions)throw Error('duplicate import');
const incoming=m.clone(backup);incoming.progressions[0].name='Другая ревизия';const copied=await db.mergeBackup(incoming,{[program.id]:'copy'});data=await db.readAll();if(copied.progressions!==1||copied.workouts!==1||!data.progressions.some(p=>p.id!==program.id&&p.name.includes('(копия)')))throw Error('copy conflict');
await db.deleteWorkout(workout.id);data=await db.readAll();if(data.progressions.find(p=>p.id===program.id).slots[0].credited)throw Error('deletion credit');
return {programs:data.progressions.length,history:data.workouts.length};
});
assert.equal(results.programs,2);assert.deepEqual(errors,[]);console.log('PASS v1 migration, two starts, idempotent finish, no resurrection, graph-copy import, deletion credit');
await p.reload();await p.locator('#sectionProgressionButton').click();await p.locator('#progressionRoot h1').waitFor();assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));

}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

