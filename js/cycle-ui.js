import { createCycle, cyclePlan, getCycleSession } from './cycle-model.js';
import { cycleAction, saveCycle } from './workout-db.js';
import { cycleDialog, cycleView, returnPreview } from './cycle-view.js';
import { showSection } from './navigation.js';

export function initCycleUI(bridge) {
  const root=document.getElementById('cycleRoot'),dialog=document.getElementById('cycleDialog'),message=document.getElementById('cycleMessage');
  let cycle=bridge.getState().endlessCycle,week=cycle?.week||1,day=cycle?.day||1,busy=false,revision=cycle?.revision,dialogRevision=null;
  let planView='sessions',overviewArm='right';
  let chartSource='plan';
  const fail=error=>{message.textContent=error.message||String(error);};
  function render(){
    const focused=root.contains(document.activeElement)?document.activeElement.closest('[data-cycle-action]'):null;
    const focusKey=focused?`[data-cycle-action="${focused.dataset.cycleAction}"]${['week','day','arm','source'].filter(key=>focused.dataset[key]).map(key=>`[data-${key}="${focused.dataset[key]}"]`).join('')}`:null;
    const { active, workouts, blockWorkspace } = bridge.getState();
    root.innerHTML=cycleView({cycle,week,day,busy,planView,overviewArm,chartSource,active,workouts,loadModel:blockWorkspace.model});
    if(focusKey&&!dialog.open&&!document.getElementById('sectionCycle').classList.contains('hidden')){
      (root.querySelector(focusKey)||root.querySelector('.cycle-current-actions button'))?.focus({preventScroll:true});
    }
  }
  function refresh(){const latest=bridge.getState().endlessCycle;if(latest?.revision!==revision||latest?.id!==cycle?.id){week=latest?.week||1;day=latest?.day||1;}cycle=latest;revision=cycle?.revision;render();}
  async function mutate(action){await cycleAction(action,cycle.revision);await bridge.reload();refresh();}
  function open(kind){dialogRevision=cycle?.revision??null;dialog.innerHTML=cycleDialog(kind,cycle);dialog.showModal();dialog.querySelector('input,select')?.focus();}
  async function action(target){
    const type=target.dataset.cycleAction;message.textContent='';
    if(type==='close'){dialog.close();return;}
    if(['settings','return','skip'].includes(type)){open(type);return;}
    if(type==='view-sessions'||type==='view-overview'){planView=type==='view-overview'?'overview':'sessions';return;}
    if(type==='view-charts'){planView='charts';return;}
    if(type==='overview-arm'||type==='chart-arm'){overviewArm=target.dataset.arm;return;}
    if(type==='chart-source'){chartSource=target.dataset.source;return;}
    if(type==='select-week'){week=Number(target.dataset.week);day=week===cycle.week?cycle.day:1;planView='sessions';return;}
    if(type==='select-day'){day=Number(target.dataset.day);render();return;}
    if(type==='page-prev'||type==='page-next'){week=Math.max(1,Math.floor((week-1)/5)*5+1+(type==='page-next'?5:-5));day=1;render();return;}
    if(type==='current'){week=cycle.week;day=cycle.day;render();return;}
    if(type==='resume-workout'){bridge.resume();return;}
    if(type==='pause'){await mutate({type:'pause'});return;}
    if(type==='start'){const session=getCycleSession(cycle);await bridge.start({title:`Цикл 4+1 · неделя ${cycle.week} · ${cycle.day===1?'сила':'объём'}`,restSec:0,sets:cyclePlan(cycle),sourceTemplateId:null,cycleId:cycle.id,cycleRevision:cycle.revision,cycleWeek:cycle.week,cycleDay:cycle.day,cycleContext:{label:session.label,light:session.light,maxima:session.maxima}});}
  }
  root.addEventListener('click',async e=>{
    const target=e.target.closest('[data-cycle-action]');
    if(!target||busy)return;
    const opensPreview=planView==='overview'&&target.dataset.cycleAction==='select-week';
    busy=true;
    try{await action(target);}catch(error){fail(error);}finally{
      busy=false;render();
      if(opensPreview)root.querySelector('#cycleWeekPreview')?.focus();
    }
  });
  dialog.addEventListener('click',e=>{if(e.target.closest('[data-cycle-action="close"]'))dialog.close();});
  dialog.addEventListener('change',e=>{if(e.target.name==='weeksBack'){try{dialog.querySelector('#cycleReturnPreview').innerHTML=returnPreview(cycle,Number(e.target.value));}catch(error){dialog.querySelector('[data-cycle-error]').textContent=error.message;}}});
  dialog.addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;
    const form=e.target,data=new FormData(form),type=form.dataset.cycleForm;busy=true;form.querySelector('button[type=submit]').disabled=true;
    try{
      if(type==='settings'){const maxima={right:Number(data.get('right')),left:Number(data.get('left'))};if(cycle)await cycleAction({type:'maxima',...maxima},dialogRevision);else await saveCycle(createCycle(maxima));}
      else await cycleAction(type==='return'?{type:'return',weeksBack:Number(data.get('weeksBack'))}:{type:'skip'},dialogRevision);
      dialog.close();await bridge.reload();refresh();
    }catch(error){form.querySelector('[data-cycle-error]').textContent=error.message||String(error);}
    finally{busy=false;form.querySelector('button[type=submit]').disabled=false;render();}
  });
  document.getElementById('sectionCycleButton').addEventListener('click',()=>{showSection('Cycle');refresh();});
  function openHash(){if(location.hash==='#cycle'){showSection('Cycle');refresh();}}
  window.addEventListener('hashchange',openHash);openHash();render();
  return {refresh};
}
