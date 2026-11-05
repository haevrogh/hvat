import { getCycleSession, getCycleWeeks, transitionCycle } from './cycle-model.js';
import { cycleChartsView } from './cycle-charts.js';

export const escapeCycle = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const weightFormat = new Intl.NumberFormat('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1});
const maximumFormat = new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
export const cycleNumber = value => weightFormat.format(value);
const armNames={left:'Левая',right:'Правая'};
const btn=(action,text,extra='',primary=false)=>`<button type="button" class="button ${primary?'button--primary':'button--quiet'}" data-cycle-action="${action}" ${extra}>${text}</button>`;
const notation = row => row.pair ? `${cycleNumber(row.pair.kg)}×${row.reps}×${row.sets}` : `Нет пары для ${cycleNumber(row.targetKg)} кг`;
const sessionSummary = (session,arm) => session.arms[arm].map(row=>escapeCycle(notation(row))).join(' + ');
const weeksFrom = (first,count) => Array.from({length:count},(_,i)=>first+i);

function armView(arm,session) {
  const rows=session.arms[arm];
  const renderRow=row=>`<tr><th scope="row">${row.role==='backoff'?'Добор':'Основа'}<small>${Math.round(row.percent*100)}% ПМ</small></th><td><strong>${escapeCycle(notation(row))}</strong>${row.pair?`<small>Пружины ${row.pair.i} / ${row.pair.j}</small>`:''}</td><td>${row.restSec} с</td></tr>`;
  return `<section class="training-panel cycle-arm"><div class="cycle-panel-heading"><h3>${armNames[arm]} рука</h3><span>ПМ ${cycleNumber(session.maxima[arm])} кг</span></div><table class="cycle-sets"><caption class="cycle-caption">Вес × повторы × подходы</caption><thead><tr><th>Часть</th><th>Нагрузка, кг</th><th>Отдых</th></tr></thead><tbody>${rows.map(renderRow).join('')}</tbody></table></section>`;
}

function sessionsView(cycle,week,day) {
  const selected=getCycleSession(cycle,week,day),pageStart=Math.floor((week-1)/5)*5+1;
  const isCurrent=week===cycle.week&&day===cycle.day;
  return `<div class="cycle-panel-heading cycle-week-navigation"><div class="cycle-pager">${btn('page-prev','←',`aria-label="Предыдущие пять недель" ${pageStart===1?'disabled':''}`)}<span>Недели ${pageStart}–${pageStart+4}</span>${btn('page-next','→','aria-label="Следующие пять недель"')}</div></div><div class="cycle-weeks">${getCycleWeeks(cycle,weeksFrom(pageStart,5)).map(w=>`<button type="button" class="cycle-week ${w.week===week?'is-selected':''} ${w.light?'is-light':''}" data-cycle-action="select-week" data-week="${w.week}" aria-pressed="${w.week===week}"><small>Неделя ${w.week}${w.week===cycle.week?' · сейчас':''}</small><strong>${w.light?'Лёгкая':escapeCycle(w.label)}</strong></button>`).join('')}</div>
  <div class="cycle-preview-heading"><div><h3 id="cycleWeekPreview" tabindex="-1">Неделя ${week}${selected.light?' · лёгкая':''}</h3><p class="cycle-note">Вес × повторы × подходы. Пары подобраны вниз.</p></div>${!isCurrent?btn('current','К текущему занятию'):''}</div><div class="cycle-days" role="group" aria-label="Занятие недели">${[1,2].map(n=>`<button type="button" class="button ${day===n?'button--primary':'button--quiet'}" data-cycle-action="select-day" data-day="${n}" aria-pressed="${day===n}">${n===1?'1 · Силовая':'2 · Объёмная'}${selected.light?' · легче':''}</button>`).join('')}</div>
  ${selected.warnings.length?`<p class="cycle-warning" role="status">${selected.warnings.map(escapeCycle).join(' ')}</p>`:''}<div class="cycle-arm-grid">${['left','right'].map(a=>armView(a,selected)).join('')}</div>`;
}

function overviewView(cycle,arm) {
  const weeks=getCycleWeeks(cycle,weeksFrom(1,26));
  const handButtons=['left','right'].map(key=>btn('overview-arm',`${armNames[key]} рука`,`data-arm="${key}" aria-pressed="${arm===key}"`,arm===key)).join('');
  return `<div class="training-panel cycle-overview"><div class="cycle-panel-heading"><h3>Недели 1–26</h3><div class="cycle-view-switch" role="group" aria-label="Рука в таблице">${handButtons}</div></div>
  <p class="cycle-note" id="cycleOverviewNote">Вес × повторы × подходы. Нажмите на номер недели, чтобы увидеть пары пружин и время отдыха.</p>
  <table class="cycle-overview-table" aria-label="План на 26 недель: ${armNames[arm].toLowerCase()} рука" aria-describedby="cycleOverviewNote"><thead><tr><th scope="col">Неделя</th><th scope="col">ПМ, кг</th><th scope="col">День 1</th><th scope="col">День 2</th></tr></thead><tbody>${weeks.map(w=>`<tr class="${w.light?'is-light ':''}${w.week===cycle.week?'is-current':''}"><th scope="row">${btn('select-week',w.week,`data-week="${w.week}" aria-label="Открыть неделю ${w.week}"${w.week===cycle.week?' aria-current="step"':''}`)}${w.light?'<small>Лёгкая</small>':''}${w.week===cycle.week?'<small>Сейчас</small>':''}</th><td>${maximumFormat.format(w.maxima[arm])}</td>${w.sessions.map(session=>`<td>${sessionSummary(session,arm)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function cycleView({cycle,week,day,active,workouts,busy,planView='sessions',overviewArm='right',chartSource='plan',loadModel}) {
  if(!cycle)return `<div class="training-heading"><h1>Цикл 4+1</h1></div><section class="training-panel cycle-welcome"><p class="eyebrow">ДВЕ ТРЕНИРОВКИ В НЕДЕЛЮ</p><h2>Укажите ПМ — тренировки готовы</h2><p>Четыре силовые недели: 5×5, 4×4, 3×3, 2×2. Затем лёгкая неделя и новый круг. Вторая тренировка — на объём.</p><p>План растёт на 0,5% за тренировочную неделю. Пропущенное время не увеличивает веса.</p>${btn('settings','Ввести ПМ обеих рук','',true)}</section>`;
  const current=getCycleSession(cycle),linked=!!active?.cycleId,disabled=busy?'disabled':'';
  let planContent;
  if (planView === 'charts') {
    planContent = cycleChartsView({ cycle, model: loadModel, arm: overviewArm, source: chartSource, workouts });
  } else if (planView === 'overview') {
    planContent = overviewView(cycle,overviewArm);
  } else {
    planContent = sessionsView(cycle,week,day);
  }
  const history=workouts.filter(w=>w.cycleId===cycle.id).sort((a,b)=>b.endedAt.localeCompare(a.endedAt)).slice(0,4);
  return `<div class="training-heading cycle-heading"><div><p class="eyebrow">СИЛА И ОБЪЁМ · БЕЗ ДАТЫ ОКОНЧАНИЯ</p><h1>Цикл 4+1</h1></div>${btn('settings','Изменить ПМ',`${disabled} ${linked?'disabled':''}`)}</div>
  <section class="training-panel cycle-current"><div><span class="cycle-state">${cycle.status==='paused'?'На паузе':'Следующая тренировка'}</span><h2>Неделя ${cycle.week} · занятие ${cycle.day}</h2><p>${escapeCycle(current.label)}</p><div class="cycle-maxima"><span>Левая: <b>${cycleNumber(current.maxima.left)} кг</b></span><span>Правая: <b>${cycleNumber(current.maxima.right)} кг</b></span></div></div><div class="cycle-current-actions">${active?btn('resume-workout','Продолжить тренировку','',true):cycle.status==='paused'?btn('return','Продолжить после перерыва',disabled,true):btn('start','Начать тренировку',`${disabled} ${current.available?'':'disabled'}`,true)}${!active&&cycle.status!=='paused'?btn('pause','Пауза',disabled):''}${!active&&cycle.status!=='paused'?btn('return','Вернуться после перерыва',disabled):''}${!active&&cycle.status!=='paused'?btn('skip','Пропустить занятие',disabled):''}</div></section>
  <p class="cycle-note">Веса растут по номеру тренировочной недели. Календарный перерыв ничего не сдвигает. После двух занятий начинается следующая неделя.</p>
  <section class="cycle-program" aria-labelledby="cyclePlanTitle"><div class="cycle-panel-heading cycle-program-heading"><h2 id="cyclePlanTitle">Готовые тренировки</h2><div class="cycle-view-switch" role="group" aria-label="Вид плана">${btn('view-sessions','По неделям',`aria-pressed="${planView==='sessions'}"`,planView==='sessions')}${btn('view-overview','Таблица на 26 недель',`aria-pressed="${planView==='overview'}"`,planView==='overview')}${btn('view-charts','Графики',`aria-pressed="${planView==='charts'}"`,planView==='charts')}</div></div>
  ${planContent}</section>
  <details class="training-panel cycle-rules"><summary>Как устроен цикл</summary><p>5×5 на 75% + 1×10 на 70%; 4×4 на 80% + 2×10 на 70%; 3×3 на 85% + 2×10 на 70%; 2×2 на 90% + 2×10 на 70%.</p><p>Вторая тренировка: 4×10 на 65%. Лёгкая неделя: 2×5 на 60% и 2×10 на 55%, без добора, с большим запасом повторов.</p><p>Проценты и ритм 4+1 — условия этого плана для HVAT. Прибавка 0,5% — расчётная, её нужно сверять с выполнением тренировок. Процент сам по себе не определяет близость к отказу.</p><p>Пауза сохраняет следующее занятие. Возврат назад снижает расчётный ПМ и повторяет прежние недели. История сохраняется. Частичное занятие не продвигает цикл.</p><p>ПМ в настройках — исходный. Изменение пересчитывает будущие назначения; сохранённые тренировки остаются прежними.</p></details>
  <details class="training-panel cycle-history"><summary>История цикла</summary>${history.length?history.map(w=>`<p>${escapeCycle(new Date(w.endedAt).toLocaleDateString('ru-RU'))} · неделя ${w.cycleWeek}, занятие ${w.cycleDay}${w.partial?' · частично':''}</p>`).join(''):'<p>Выполненные тренировки появятся здесь и в общем журнале.</p>'}${cycle.events.slice(-5).reverse().map(event=>`<p class="cycle-note">${escapeCycle(new Date(event.at).toLocaleDateString('ru-RU'))} · ${escapeCycle({advance:'Занятие завершено',skip:'Занятие пропущено',pause:'Пауза',resume:'Продолжение',return:'Возврат к нагрузке',maxima:'Изменены исходные ПМ'}[event.type]||event.type)} · неделя ${event.to.week}, занятие ${event.to.day}</p>`).join('')}</details>`;
}

export function returnPreview(cycle,back) {
  const next=transitionCycle(cycle,{type:'return',weeksBack:back}),s=getCycleSession(next);
  return `<h3>Неделя ${next.week} · занятие ${next.day}</h3><p>${escapeCycle(s.label)}</p>${['left','right'].map(a=>`<p><b>${armNames[a]}:</b> ${sessionSummary(s,a)}<small class="cycle-note">Расчётный ПМ ${cycleNumber(s.maxima[a])} кг</small></p>`).join('')}<p class="cycle-note">Сохранённые результаты останутся в истории.</p>`;
}

export function cycleDialog(kind,cycle) {
  let title='',body='',submit='Сохранить';
  if(kind==='settings'){
    title=cycle?'Исходные ПМ':'Начать цикл';body=`<p>Полное закрытие на один повтор. Веса для каждой руки рассчитываются отдельно.</p><div class="cycle-form-grid">${['left','right'].map(a=>`<label class="field">${armNames[a]} рука · ПМ, кг<input name="${a}" type="number" min="0.1" max="120.4" step="0.1" value="${cycle?.initialMaxima[a]??''}" required inputmode="decimal"></label>`).join('')}</div><p class="cycle-note">Рост 0,5% за тренировочную неделю. Четыре рабочие недели и одна лёгкая.${cycle?' Это исходная база: текущая неделя пересчитывается с учётом накопленной прибавки.':''}</p>`;submit=cycle?'Сохранить ПМ':'Создать тренировки';
  }else if(kind==='return'){
    title='Вернуться после перерыва';body=`<p>Выберите, с какой нагрузки продолжить. Длительность отпуска сама по себе не меняет цикл.</p><label class="field">Шаг назад<select name="weeksBack"><option value="0">Продолжить с текущего занятия</option>${[1,2,3,4,5].filter(n=>n<cycle.week).map(n=>`<option value="${n}">На ${n} ${n===1?'неделю':n<5?'недели':'недель'} назад</option>`).join('')}${cycle.week>6?`<option value="${cycle.week-1}">К первой неделе</option>`:''}</select></label><div id="cycleReturnPreview" class="cycle-return-preview" aria-live="polite">${returnPreview(cycle,0)}</div>`;submit='Продолжить с этой нагрузки';
  }else if(kind==='skip'){
    const next=transitionCycle(cycle,{type:'skip'});title='Пропустить занятие';body=`<p>Неделя ${cycle.week}, занятие ${cycle.day} будет отмечено как пропущенное.</p><p>Следующее: <b>неделя ${next.week}, занятие ${next.day}</b>.</p><p class="cycle-note">Если нужен отпуск, используйте паузу: она сохраняет очередь тренировок без продвижения.</p>`;submit='Пропустить это занятие';
  }
  return `<form data-cycle-form="${kind}"><div class="dialog-heading"><h2 id="cycleDialogTitle">${title}</h2><button type="button" class="icon-button" data-cycle-action="close" aria-label="Закрыть">×</button></div>${body}<p class="form-error" data-cycle-error role="alert"></p><div class="dialog-actions">${btn('close','Отмена')}<button type="submit" class="button button--primary">${submit}</button></div></form>`;
}
