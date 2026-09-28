import { ARMS, PAIRS, newId, pairFor } from './workout-model.js';
import { WAVE, PRESET_VERSION } from './progression-presets.js';

export const CALC_VERSION = 'spring-0.3008-1.8637-2.98';
export const kg10 = kg => Math.round(kg * 10);
export const keyPair = p => `${p.i}-${p.j}`;
export const clone = value => structuredClone(value);
export const pairKey = key => { const [i,j] = String(key).split('-').map(Number); return pairFor(i,j); };
export const allowedPairs = config => PAIRS.filter(p => config.allowed.includes(keyPair(p)));
export const nextPair = (config, pair) => allowedPairs(config).find(p => kg10(p.kg) > kg10(pair.kg)) || null;
export function lowerPair(config, kg) {
  const pairs = allowedPairs(config).filter(p => kg10(p.kg) <= kg10(kg));
  if (!pairs.length) throw new Error(`Нет разрешённой пары не тяжелее ${kg} кг. Измени доступные пары или назначение.`);
  return pairs.at(-1);
}
export function defaultArm(method = 'double') {
  return { method, pair: '2-11', sets: 4, low: 6, high: 10, rest: method === 'double' ? 240 : 300,
    restB: 240, restDeload: 180, base: 100, baseConfirmed: false, goal: '7-12', goalReps: 6,
    readiness: '8-11', reviewed: false, allowed: PAIRS.map(keyPair), standard: 'Полное закрытие без помощи при повторении',
    overrides: {}, initialA: 1, initialB: 1 };
}
export function validateConfig(config) {
  if (!config || !['wave','double','ladder'].includes(config.method)) throw new Error('Выбери методику.');
  if (!Array.isArray(config.allowed) || !config.allowed.length || config.allowed.some(k => !pairKey(k))) throw new Error('Выбери доступные пары.');
  if (!config.allowed.includes(config.pair)) throw new Error('Рабочая пара должна быть доступна.');
  if(!Number.isFinite(config.base)||config.base<=0||!pairKey(config.goal)||!pairKey(config.readiness))throw new Error('Проверь исходный ориентир и целевые пары.');
  if(!config.overrides||Object.values(config.overrides).some(value=>!pairKey(value)))throw new Error('В лестнице есть недопустимая пара.');
  for (const field of ['rest','restB','restDeload']) if (!Number.isInteger(config[field]) || config[field] < 0 || config[field] > 3600) throw new Error('Отдых: от 0 до 3600 секунд.');
  if (!Number.isInteger(config.sets) || config.sets < 1 || config.sets > 20 || !Number.isInteger(config.low) || !Number.isInteger(config.high) || config.low < 1 || config.high < config.low || config.high > 999) throw new Error('Проверь число подходов и диапазон повторений.');
  if (config.method === 'wave') {
    if (!config.baseConfirmed || !Number.isFinite(config.base) || config.base <= 0) throw new Error('Подтверди исходный 1ПМ этой руки.');
    if (!config.reviewed) throw new Error('Проверь и подтверди назначения волновой программы.');
    if (!config.allowed.includes(config.goal) || !config.allowed.includes(config.readiness)) throw new Error('Цель и критерий готовности должны быть доступными парами.');
    if (config.goalReps !== 6) throw new Error('Волновой пресет рассчитан на шесть повторений.');
    if (![config.initialA,config.initialB].every(v => Number.isInteger(v) && v>=1 && v<=4)) throw new Error('Уровни: от 1 до 4.');
  }
}
function makeState(config) {
  return { method: config.method, pair: config.pair, stage: 1, levelA: config.initialA, levelB: config.initialB,
    index: 0, wave: 1, block: 1, blockId: newId(), n: null, step: 0, pending: null, done: false, goalDone: false, evaluations: {} };
}
function set(pair, reps, role, restSec, extra = {}) {
  const id = newId();
  return { id, plannedSetId: id, ...pair, reps, role, restSec, status: 'pending', calcVersion: CALC_VERSION, ...extra };
}
export function assignment(config, state) {
  if (state.done) return { sets: [], label: 'Цель достигнута', blockId: state.blockId };
  const pair = pairKey(state.pair);
  const result = { blockId: state.blockId, block: state.block, wave: state.wave, stage: state.stage,
    index: state.index, levelA: state.levelA, levelB: state.levelB, method: config.method, sets: [], label: '', standard:config.standard, baseKg:config.base };
  if (config.method === 'double') {
    result.label = `Double progression · ${config.low}–${config.high} повторений`;
    result.sets = Array.from({length: config.sets}, () => set(pair, config.low, 'main', config.rest, { repMax: config.high }));
  } else if (config.method === 'ladder') {
    result.label = `Блок ${state.block} · ${state.n === null ? 'Тест максимума' : `прибавка ${state.step} из 8`}`;
    result.sets = state.n === null ? [set(pair, 1, 'max', config.rest, { maxTest: true })]
      : Array.from({length:4}, (_,i) => set(pair, state.n - 2 + Math.floor(state.step / 4) + (i < state.step % 4 ? 1 : 0), 'main', config.rest));
  } else {
    const index = Math.min(7, state.index), day = index % 2, week = Math.floor(index/2);
    const direction = day ? 'b' : 'a', table = WAVE[state.stage];
    const resolve = weight => lowerPair(config, config.overrides[String(weight)] ? pairKey(config.overrides[String(weight)]).kg : weight);
    let work = [], rest = day ? config.restB : config.rest;
    result.label = `${day ? 'Объёмная' : 'Силовая'} · этап ${state.stage} · волна ${state.wave} · неделя ${week+1}`;
    result.phase = week === 3 ? 'Разгрузка' : 'Рабочая';
    if (state.taper && week === 3) {
      result.phase = day ? 'Тест' : 'Подводка';
      if (day) {
        result.sets = [[66.9,5],[79.9,3],[90.6,1],[93.7,1]].filter(([kg])=>kg10(kg)<kg10(pairKey(config.goal).kg))
          .map(([kg,reps])=>set(resolve(kg),reps,'warmup',config.rest));
        result.sets.push(set(pairKey(config.goal),6,'test',config.rest));
        return result;
      }
      work = [[79.9,2,3,'main']];
    } else if (week === 3) { work = [[...table.deload[day], 'main']]; rest = config.restDeload; }
    else {
      const level = day ? state.levelB : state.levelA;
      const weight = table[direction][level-1][week];
      const [count,reps] = (day ? table.setsB : table.setsA)[week];
      work = [[weight,count,reps,'main']];
      if (state.stage === 2 && day && week === 2) work.push([table.b[level-1][0],2,6,'backoff']);
    }
    const first = resolve(work[0][0]);
    const warmups = day ? [[66.9,3]] : [[66.9,5],[73.8,2],...(first.kg>=88.8?[[79.9,1]]:[])];
    const seen = new Set();
    result.sets = warmups.flatMap(([kg,reps]) => {
      let p; try { p = resolve(kg); } catch { return []; }
      if (p.kg >= first.kg || seen.has(keyPair(p)) || (week===3 && seen.size)) return [];
      seen.add(keyPair(p)); return [set(p,reps,'warmup',rest)];
    });
    work.forEach(([kg,count,reps,role], group) => {
      for(let n=0;n<count;n++) result.sets.push(set(resolve(kg),reps,role,rest,
        { rir: state.stage===2 && day===1 && week===2 && group===0 ? 1 : week===3 ? 0 : 2,
          topSix: state.stage===2 && day===1 && week===2 && group===0 }));
    });
  }
  return result;
}
export function dateSequence(start, days, count) {
  const date = new Date(`${start}T12:00:00`), dates=[];
  if (!Number.isFinite(date.getTime()) || days.length!==2 || new Set(days).size!==2 || days.some(d=>!Number.isInteger(d)||d<0||d>6)) throw new Error('Укажи дату и два разных дня недели.');
  while(dates.length<count) {
    if(days.includes(date.getDay())) dates.push(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`);
    date.setDate(date.getDate()+1);
  }
  return dates;
}
export function createProgression(settings) {
  if (!settings.name?.trim() || settings.name.length>100) throw new Error('Название: от 1 до 100 символов.');
  if (!Number.isInteger(settings.weeks) || settings.weeks<1 || settings.weeks>260) throw new Error('Период: от 1 до 260 недель.');
  if (!ARMS.some(a=>settings.arms[a])) throw new Error('Выбери хотя бы одну руку.');
  ARMS.forEach(a=>{if(settings.arms[a])validateConfig(settings.arms[a]);});
  const now = new Date().toISOString();
  const p = { id:newId(), name:settings.name.trim(), status:'draft', presetVersion:PRESET_VERSION, config:clone(settings),
    revision:1, createdAt:now, updatedAt:now, arms:{}, slots:[], decisions:[], blocks:[], position:0 };
  ARMS.forEach(a=>{if(settings.arms[a]) p.arms[a]=makeState(settings.arms[a]);});
  dateSequence(settings.start,settings.days,settings.weeks*2).forEach((date,index)=>p.slots.push({id:newId(),index,week:Math.floor(index/2)+1,date,status:'planned',closed:false,attempts:[],revision:0,revisions:[],applied:{}}));
  refreshFuture(p);
  return p;
}
function forecastStep(state) {
  if(state.method==='wave') {
    state.index++;
    if(state.index>=8){const nextStage=state.stage===1&&state.levelA===4&&state.levelB===4;state.index=0;state.wave++;state.block++;state.blockId=newId();state.levelA=Math.min(4,state.levelA+1);state.levelB=Math.min(4,state.levelB+1);
      if(nextStage){state.stage=2;state.levelA=1;state.levelB=1;}}
  } else if(state.method==='ladder' && state.n!==null) state.step=Math.min(8,state.step+1);
}
export function refreshFuture(p) {
  const states=clone(p.arms); let offset=0;
  for(const slot of p.slots) {
    if(slot.closed || slot.status!=='planned' || slot.attempts.length) continue;
    if(slot.manual){for(const arm of ARMS)if(states[arm])forecastStep(states[arm]);offset++;continue;}
    const oldPlan=slot.plan,oldArms=slot.arms,arms={},plan={right:[],left:[]};
    slot.before=Object.fromEntries(Object.entries(states).map(([a,s])=>{const snapshot=clone(s);delete snapshot.evaluations;delete snapshot.pending;return [a,snapshot];}));slot.preliminary=offset>0;
    for(const arm of ARMS) if(states[arm]) {
      const a=assignment(p.config.arms[arm],states[arm]);arms[arm]=a;plan[arm]=a.sets;
      forecastStep(states[arm]);
    }
    const signature=rows=>JSON.stringify(ARMS.map(a=>rows[a].map(({id,plannedSetId,...s})=>s)));
    if(oldPlan&&signature(oldPlan)===signature(plan)) {
      slot.arms=arms;for(const arm of ARMS)if(arms[arm])arms[arm].sets=oldPlan[arm];
    }else{
      if(oldPlan)slot.revisions.push({revision:slot.revision,plan:oldPlan,arms:oldArms});
      slot.revision++;slot.plan=plan;slot.arms=arms;
    }
    offset++;
  }
}
export const currentSlot = p => p.slots.find(s=>!s.closed && s.status!=='replaced') || null;
export function progress(p) {
  const slots=p.slots.filter(s=>s.status!=='replaced'), done=slots.filter(s=>s.credited).length;
  return {done,total:slots.length,percent:slots.length?Math.round(done/slots.length*100):0,
    partial:slots.filter(s=>s.status==='partial').length,skipped:slots.filter(s=>s.status==='skipped').length};
}
export function materializeTest(active, arm, test) {
  if(!test.maxTest || test.status!=='done' || test.actualReps<3 || active.sets[arm].some(s=>s.generatedBy===test.id)) return;
  const rows=Array.from({length:4},()=>set(pairFor(test.i,test.j),test.actualReps-2,'main',test.restSec,{generatedBy:test.id}));
  const index=active.sets[arm].findIndex(s=>s.id===test.id);
  active.sets[arm].splice(index+1,0,...rows);
  active.initialPlan[arm].push(...clone(rows));
}
export function evaluateArm(plan, actual, feedback={}) {
  const work=plan.filter(s=>s.role!=='warmup'), byId=new Map(actual.map(s=>[s.plannedSetId||s.id,s]));
  const missing=work.filter(s=>byId.get(s.plannedSetId||s.id)?.status!=='done');
  const failed=work.filter(s=>{const a=byId.get(s.plannedSetId||s.id);return a?.status==='done' && (!s.maxTest && (a.actualReps<s.reps || kg10(a.kg)<kg10(s.kg)) || a.quality==='invalid' || a.quality==='assisted');});
  const rirOK=work.every(s=>!s.rir || Number(feedback[s.topSix?'topRir':'rir'])>=s.rir && feedback[s.topSix?'topRir':'rir']!=='' && feedback[s.topSix?'topRir':'rir']!==undefined);
  const quality=feedback.technique===true && feedback.pain===false;
  return {complete:missing.length===0, failed:failed.length>0, success:missing.length===0 && failed.length===0 && quality && rirOK,
    reason:feedback.pain===true?'Боль: тяжёлую работу следует прекратить; пауза или пересмотр назначений.':missing.length?'Часть назначений не выполнена.':failed.length?'Есть недобор повторений, снижение веса или невалидный подход.':!quality||!rirOK?'Недостаточно подтверждений техники, отсутствия боли или нужного запаса.':'Назначения выполнены и подтверждены.'};
}
function completeArm(p,arm,slot,workout,evaluation) {
  const state=p.arms[arm], config=p.config.arms[arm], before=slot.before[arm];
  if(!state||!config||state.method!==before.method)return;
  const actual=workout.sets[arm], test=actual.find(s=>s.maxTest && s.status==='done');
  const isLatest=!p.slots.some(s=>s.index>slot.index && s.applied?.[arm]);
  if(state.method==='wave') state.evaluations[slot.id]={success:evaluation.success,index:before.index,blockId:before.blockId,workoutId:workout.id,
    boundary:actual.filter(s=>s.status==='done'&&s.role==='main'&&s.kg>=(before.index%2?84.9:97)&&s.actualReps>=(before.index%2?6:2)).length>=4};
  if(!isLatest || state.blockId!==before.blockId || slot.applied[arm] && slot.applied[arm].success) return;
  if(state.method==='ladder') {
    if(test) state.n=test.actualReps>=3?test.actualReps:null;
    if(test && test.actualReps<3) state.pending={type:'retest',reason:'Меньше трёх повторений: выбери более лёгкую пару и повтори тест.'};
    else if(evaluation.failed) {state.step=0;state.pending=null;}
    else if(evaluation.success) {
      if(!test && before.step===8) state.pending={type:'increase',reason:'Все четыре подхода достигли N повторений. Пора предложить следующий вес.'};
      else state.step=Math.min(8,(test?0:before.step)+1);
    }
  } else if(state.method==='double' && evaluation.success) {
    const mains=workout.initialPlan[arm].filter(s=>s.role==='main');
    if(mains.every(s=>actual.find(a=>a.plannedSetId===s.plannedSetId)?.actualReps>=config.high)) state.pending={type:'increase',reason:'Верхняя граница достигнута во всех рабочих подходах.'};
  } else if(state.method==='wave' && evaluation.complete && !slot.applied[arm]) {
    state.index=before.index+1;
    if(before.index===5 && state.stage===2 && evaluation.success && actual.some(s=>s.topSix && s.kg>=pairKey(config.readiness).kg && s.actualReps>=6)) state.pending={type:'taper',reason:'Подтверждена главная шестёрка с нужным запасом. Можно назначить подводку и тест.'};
    if(state.index>=8) {
      if(state.taper) state.pending={type:'after-test',reason:'Тест завершён. Подтверди цель либо продолжи подготовку.'};
      else state.pending={type:'wave',reason:'Волна завершена: выбери уровни следующей волны по результатам каждого направления.'};
    }
  }
  if(evaluation.complete || evaluation.failed || test) slot.applied[arm]={success:evaluation.success,workoutId:workout.id};
  if(config.method==='wave' && workout.feedback?.[arm]?.technique===true && workout.feedback?.[arm]?.pain===false && actual.some(s=>s.status==='done' && !['invalid','assisted'].includes(s.quality) && s.actualReps>=config.goalReps && kg10(s.kg)>=kg10(pairKey(config.goal).kg))) state.goalDone=true;
}
export function applyWorkout(program,workout) {
  const p=clone(program), slot=p.slots.find(s=>s.id===workout.plannedSessionId);
  if(!slot) throw new Error('Занятие программы не найдено.');
  if(slot.attempts.includes(workout.id)) return p;
  slot.attempts.push(workout.id); slot.evaluations={};
  for(const arm of ARMS) if(slot.before[arm] && workout.initialPlan[arm].length) {
    const e=evaluateArm(workout.initialPlan[arm],workout.sets[arm],workout.feedback?.[arm]);
    slot.evaluations[arm]=e; completeArm(p,arm,slot,workout,e);
  }
  const complete=ARMS.every(arm=>workout.initialPlan[arm].every(s=>workout.sets[arm].some(a=>a.plannedSetId===(s.plannedSetId||s.id)&&a.status==='done')));
  const unchanged=ARMS.every(arm=>workout.initialPlan[arm].every(s=>{const a=workout.sets[arm].find(a=>a.plannedSetId===s.plannedSetId);return a?.status==='done'&&(s.maxTest||a.actualReps>=s.reps)&&kg10(a.kg)>=kg10(s.kg);}));
  if(complete) {slot.credited=slot.credited||workout.id;slot.status=unchanged?'completed':'modified';slot.closed=true;}
  else if(!slot.credited){slot.status='partial';slot.closed=false;}
  p.position=currentSlot(p)?.index ?? p.slots.length;p.revision++;p.updatedAt=workout.endedAt;
  refreshFuture(p);return p;
}
export function waveSuggestion(state) {
  const values=Object.values(state.evaluations).filter(e=>e.blockId===state.blockId);
  const success=day=>[day,day+2,day+4].every(i=>values.some(e=>e.index===i&&e.success));
  return {a:success(0)?Math.min(4,state.levelA+1):state.levelA,b:success(1)?Math.min(4,state.levelB+1):state.levelB,
    nextStage:state.stage===1&&state.levelA===4&&state.levelB===4&&success(0)&&success(1)&&[4,5].every(i=>values.some(e=>e.index===i&&e.boundary&&e.success)),aOK:success(0),bOK:success(1)};
}
export function decide(program,arm,choice) {
  let p=clone(program);const s=p.arms[arm], c=p.config.arms[arm], pending=s.pending;
  if(!pending) throw new Error('Нет ожидающего решения.');
  if(choice.action==='increase') {
    const pair=nextPair(c,pairKey(s.pair));if(!pair)throw new Error('Более тяжёлой доступной пары нет. Можно оставить вес или завершить программу.');
    s.pair=keyPair(pair);s.n=null;s.step=0;s.block++;s.blockId=newId();
  } else if(choice.action==='retest') {
    if(!c.allowed.includes(choice.pair))throw new Error('Выбери доступную пару.');
    s.pair=choice.pair;s.n=null;s.step=0;s.block++;s.blockId=newId();
  } else if(choice.action==='taper') {
    s.taper=true;
    const next=currentSlot(p),test=p.slots.find(slot=>slot.index===(next?.index??-2)+1);
    if(next&&test&&test.status==='planned'){
      const date=new Date(`${next.date}T12:00:00`);date.setDate(date.getDate()+4);
      test.date=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      const following=p.slots.filter(slot=>slot.index>test.index&&slot.status==='planned'&&!slot.attempts.length);
      if(following[0]&&following[0].date<=test.date){date.setDate(date.getDate()+1);dateSequence(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`,p.config.days,following.length).forEach((d,i)=>following[i].date=d);}
    }
  }
  else if(choice.action==='finish-arm') {if(!s.goalDone)throw new Error('Цель ещё не подтверждена.');s.done=true;}
  else if(choice.action==='wave') {
    if(![choice.a,choice.b].every(v=>Number.isInteger(v)&&v>=1&&v<=4))throw new Error('Уровни: 1–4.');
    if(choice.nextStage&&!waveSuggestion(s).nextStage)throw new Error('Критерии перехода этапа ещё не выполнены.');
    const extraWave=!choice.nextStage && (choice.a<=s.levelA && s.levelA<4 || choice.b<=s.levelB && s.levelB<4 || s.stage===1&&s.levelA===4&&s.levelB===4);
    p.blocks.push({arm,...clone(s)});
    if(choice.nextStage){s.stage=2;s.levelA=1;s.levelB=1;}else{s.levelA=choice.a;s.levelB=choice.b;}
    s.wave++;s.block++;s.blockId=newId();s.index=0;s.taper=false;
    if(extraWave)p.needsExtension={reason:'Повтор или удержание уровня: для исходного маршрута нужна дополнительная волна.',weeks:4};
  } else if(choice.action==='keep' && pending.type==='after-test'){s.index=0;s.taper=false;s.wave++;s.block++;s.blockId=newId();}
  s.pending=null;p.decisions.push({id:newId(),at:new Date().toISOString(),arm,pending,choice});p.revision++;
  if(Object.values(p.arms).every(s=>s.done)){p.status='completed';p.completionReason='goal';}
  refreshFuture(p);return p;
}
export function extend(program,weeks) {
  if(!Number.isInteger(weeks)||weeks<1||weeks>260)throw new Error('Добавь от 1 до 260 недель.');
  const p=clone(program), start=new Date(`${p.slots.at(-1).date}T12:00:00`);start.setDate(start.getDate()+1);
  const date=`${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;
  const count=p.slots.length;
  dateSequence(date,p.config.days,weeks*2).forEach((date,i)=>p.slots.push({id:newId(),index:count+i,week:Math.floor((count+i)/2)+1,date,status:'planned',closed:false,attempts:[],revision:0,revisions:[],applied:{}}));
  p.revision++;p.decisions.push({id:newId(),at:new Date().toISOString(),type:'extend',weeks});refreshFuture(p);return p;
}
