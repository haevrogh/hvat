import { sessionStats, resolveRow } from './block-model.js';
import { analyticsView } from './block-charts.js';
import { counted } from './block-format.js';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
export const num = value => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
export const addDate = (date, days) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); };
export const dateLabel = date => new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'short', timeZone:'UTC' }).format(new Date(`${date}T12:00:00Z`));
const armLabel = { right:'Правая', left:'Левая' };
const opt = (value, selected, label=value) => `<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(label)}</option>`;
export const action = (name, text, extra='', primary=false) => `<button type="button" class="button ${primary?'button--primary':'button--quiet'}" data-block-action="${name}" ${extra}>${text}</button>`;
const field = (label, name, value, attributes='') => `<label class="field">${label}<input name="${name}" value="${esc(value)}" ${attributes}></label>`;

export function calendarLayout(block) {
  const offset=(new Date(`${block.start}T12:00:00Z`).getUTCDay()+6)%7;
  return {start:addDate(block.start,-offset),end:addDate(block.start,block.weeks*7-1),weeks:Math.ceil((offset+block.weeks*7)/7)};
}
export function calendarWeekSessions(block, week) {
  const start=addDate(calendarLayout(block).start,week*7),end=addDate(start,6);
  return block.sessions.filter(s=>s.date>=start&&s.date<=end);
}
export function canRepeatCalendarWeek(block, source, target) {
  const layout=calendarLayout(block),sessions=calendarWeekSessions(block,source);
  return Number.isInteger(target)&&target>=0&&target<layout.weeks&&target!==source&&sessions.length>0
    &&sessions.every(s=>{const date=addDate(s.date,(target-source)*7);return date>=block.start&&date<=layout.end;});
}

function calendar(state, block) {
  const layout=calendarLayout(block), count = state.range === 'all' ? layout.weeks : Number(state.range);
  const startWeek = state.range === 'all' ? 0 : Math.min(state.week, Math.max(0,layout.weeks-count));
  const weeks = Array.from({length:Math.min(count,layout.weeks-startWeek)},(_,i)=>i+startWeek);
  const headings = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
  return `<section class="training-panel block-calendar" aria-labelledby="calendarTitle"><div class="block-panel-heading"><div><p class="eyebrow">РАСПИСАНИЕ</p><h2 id="calendarTitle">Календарь занятий</h2></div><label class="block-range">Показать<select data-block-control="range">${opt('1',state.range,'Неделю')}${opt('3',state.range,'Три недели')}${opt('all',state.range,'Весь блок')}</select></label></div>
    <div class="block-calendar-controls">${action('week-prev','←','aria-label="Предыдущие недели" '+(startWeek===0?'disabled':''))}<span>${startWeek+1===Math.min(layout.weeks,startWeek+count)?`Календарная неделя ${startWeek+1}`:`Календарные недели ${startWeek+1}–${Math.min(layout.weeks,startWeek+count)}`} из ${layout.weeks}</span>${action('week-next','→','aria-label="Следующие недели" '+(startWeek+count>=layout.weeks?'disabled':''))}</div>
    <div class="block-calendar-scroll"><div class="block-calendar-body">
    ${weeks.map(w=>`<div class="block-week-label"><span>${dateLabel(addDate(layout.start,w*7))} — ${dateLabel(addDate(layout.start,w*7+6))}</span>${action('repeat-week','Повторить неделю',`data-week="${w}" ${Array.from({length:layout.weeks},(_,target)=>target).some(target=>canRepeatCalendarWeek(block,w,target))?'':'disabled'}`)}</div><div class="block-day-headings">${headings.map(h=>`<span>${h}</span>`).join('')}</div><div class="block-calendar-week">${Array.from({length:7},(_,d)=>{
      const date=addDate(layout.start,w*7+d),sessions=block.sessions.filter(s=>s.date===date);
      if(date<block.start||date>layout.end)return `<div class="block-calendar-day is-outside" data-date="${date}" aria-label="${dateLabel(date)}, вне блока"><span class="block-day-date"><time datetime="${date}">${dateLabel(date)}</time></span></div>`;
      return `<div class="block-calendar-day${date===today()?' is-today':''}" data-date="${date}"><button type="button" class="block-day-date" data-block-action="add-session" data-date="${date}" aria-label="Добавить занятие ${headings[d].toLowerCase()}, ${dateLabel(date)}"><time datetime="${date}">${dateLabel(date)}</time><span aria-hidden="true">+</span></button>${sessions.map(s=>{
        const stats=sessionStats(s,state.workspace.profile,state.arm,state.workspace.model.heavyThreshold).main;
        const done=state.workouts.filter(x=>x.blockSessionId===s.id), completed=done.some(x=>!x.partial);
        return `<button type="button" class="block-session${s.id===state.sessionId?' is-selected':''}" data-block-action="select-session" data-id="${s.id}" aria-pressed="${s.id===state.sessionId}"><strong>${esc(s.title)}</strong><span>${num(stats.sets)} подх. · ${num(stats.repetitions)} повт.</span><span class="block-session-intensity">${stats.meanIntensity?num(stats.meanIntensity)+'% 1ПМ':'Без нагрузки'}</span>${done.length?`<small>${completed?'Выполнено':'Есть факт'} · ${done.length}</small>`:''}${stats.unavailableRows?'<small>Проверьте нагрузку</small>':''}</button>`;
      }).join('')}</div>`;
    }).join('')}</div>`).join('')}</div></div><p class="block-note">Нажмите на дату, чтобы добавить занятие. ${armLabel[state.arm]} рука.</p></section>`;
}

function rowView(row, arm, profile, index, total) {
  const r=resolveRow(row,profile[arm]);
  const input=(key,label,attrs)=>`<label>${label}<input data-row-field="${key}" value="${esc(row[key])}" ${attrs}></label>`;
  return `<div class="block-row" data-row-id="${row.id}" data-row-arm="${arm}"><div class="block-row-heading"><strong>${index+1}</strong><label class="block-sr-only" for="role-${row.id}">Тип подхода ${index+1}</label><select id="role-${row.id}" data-row-field="role">${opt('warmup',row.role,'Разминка')}${opt('main',row.role,'Рабочий')}</select><div class="block-row-actions">${action('row-up','↑',`aria-label="Поднять строку ${index+1}" ${index===0?'disabled':''}`)}${action('row-down','↓',`aria-label="Опустить строку ${index+1}" ${index===total-1?'disabled':''}`)}${action('row-copy','⧉',`aria-label="Копировать строку ${index+1}"`)}${action('row-delete','×',`aria-label="Удалить строку ${index+1}"`)}</div></div>
    <div class="block-row-fields">${input('sets','Подходы','type="number" min="1" max="20" step="1" required')}${input('reps','Повторы','type="number" min="1" max="999" step="1" required')}<label>Цель<select data-row-field="mode">${opt('percent',row.mode,'% 1ПМ')}${opt('kg',row.mode,'кг')}</select></label>${input('value',row.mode==='percent'?'% 1ПМ':'кг','type="number" min="0.1" max="'+(row.mode==='percent'?300:500)+'" step="0.1" required')}<label>Запас<select data-row-field="rir">${opt('unknown',row.rir,'Не указан')}${['0','1','2','3','4'].map(v=>opt(v,row.rir,v==='4'?'4+':v)).join('')}</select></label>${input('restSec','Отдых, с','type="number" min="0" max="3600" step="1" required')}</div>
    <output class="block-row-result${!r.available?' is-unavailable':''}">${r.available?`<strong>${num(r.actualKg)} кг · ${num(r.intensity)}% 1ПМ</strong><span>Пружины ${r.pair.i}/${r.pair.j} · цель ${num(r.targetKg)} кг${Math.abs(r.actualKg-r.targetKg)>.049?' · Δ '+num(r.actualKg-r.targetKg)+' кг':''}</span>`:esc(r.reason||'Укажите 1ПМ руки')}</output></div>`;
}

function editor(state, block) {
  const s=block.sessions.find(x=>x.id===state.sessionId);
  if(!s)return `<aside class="training-panel block-editor block-empty"><p class="eyebrow">ЗАНЯТИЕ</p><h2>Соберите тренировку</h2><p>Выберите дату в календаре и добавьте разминку, рабочие и облегчённые подходы.</p>${action('add-session','Добавить занятие',`data-date="${block.start}"`,true)}</aside>`;
  const done=state.workouts.filter(w=>w.blockSessionId===s.id), arms=state.editArms==='both'?['right','left']:[state.editArms];
  const hasRows=Object.values(s.arms).some(rows=>rows.length), unavailable=['right','left'].some(a=>s.arms[a].some(r=>!resolveRow(r,state.workspace.profile[a]).available));
  return `<aside class="training-panel block-editor" aria-labelledby="editorTitle"><div class="block-panel-heading"><div><p class="eyebrow">ЗАНЯТИЕ</p><h2 id="editorTitle">Редактор</h2></div>${action('close-editor','×','aria-label="Закрыть редактор"')}</div>
    <div class="block-editor-title"><label class="field">Название<input data-session-field="title" maxlength="100" value="${esc(s.title)}" required></label><label class="field">Дата<input data-session-field="date" type="date" min="${block.start}" max="${addDate(block.start,block.weeks*7-1)}" value="${s.date}" required></label></div>
    <div class="block-editor-toolbar"><label>Редактировать<select data-block-control="edit-arms">${opt('right',state.editArms,'Правую руку')}${opt('left',state.editArms,'Левую руку')}${opt('both',state.editArms,'Обе руки')}</select></label>${action('copy-hand','Скопировать на другую руку',` ${state.editArms==='both'?'disabled':''}`)}</div>
    <details class="block-presets"><summary>Быстрые заготовки</summary><p class="block-note">Редактируемые примеры с подводящими и облегчёнными подходами.</p><div class="block-actions">${['5×5','4×4','3×3','2×2'].map((label,i)=>action('preset',label,`data-count="${5-i}"`)).join('')}</div></details>
    ${arms.map(a=>`<section class="block-arm-editor"><div class="block-panel-heading"><h3>${armLabel[a]} рука</h3><span>${state.workspace.profile[a].maxKg?num(state.workspace.profile[a].maxKg)+' кг · 1ПМ':'1ПМ не указан'}</span></div>${s.arms[a].map((r,i)=>rowView(r,a,state.workspace.profile,i,s.arms[a].length)).join('')}${action('add-row','+ Строка подходов',`data-arm="${a}"`)}</section>`).join('')}
    <div class="block-editor-footer">${action('start-session',done.length?'Повторить в журнале':'Начать тренировку',(unavailable||!hasRows?'disabled':''),true)}${action('copy-session','Копировать')}${action('delete-session','Удалить')}</div>${done.length?`<p class="block-note">В журнале: ${counted(done.length,'тренировка','тренировки','тренировок')}. Изменение плана сохраняет прежний факт.</p>`:''}${unavailable?'<p class="block-note">Для запуска укажите 1ПМ и доступные нагрузки.</p>':''}</aside>`;
}

export function blockView(state) {
  const { workspace:ws }=state, block=ws.blocks.find(b=>b.id===state.blockId);
  return `<div class="block-heading"><div><p class="eyebrow">КИСТЕВОЙ ЭСПАНДЕР</p><h1>План блока</h1></div><div class="block-actions">${action('profile','Профиль')}${action('export','Экспорт')}${action('import','Импорт')}${action('new-block','Новый блок','',true)}</div></div>
    <div class="block-profile-strip"><span>Правая <strong>${ws.profile.right.maxKg?num(ws.profile.right.maxKg)+' кг':'1ПМ не указан'}</strong></span><span>Левая <strong>${ws.profile.left.maxKg?num(ws.profile.left.maxKg)+' кг':'1ПМ не указан'}</strong></span><span id="blockSaveStatus" role="status">${esc(state.saveStatus||'Сохранено на устройстве')}</span></div>
    ${!block?`<section class="training-panel block-welcome"><p class="eyebrow">РУЧНОЙ КОНСТРУКТОР</p><h2>От одного занятия до большого блока</h2><p>Расставьте тренировки, задайте нагрузку для каждой руки и сравните недели.</p><div class="block-actions">${action('new-block','Создать блок','',true)}${action('profile','Указать 1ПМ')}</div></section>`:`<div class="training-panel block-toolbar"><div><label class="block-label" for="blockSelect">Блок</label><select id="blockSelect" data-block-control="block">${ws.blocks.map(b=>opt(b.id,block.id,b.name)).join('')}</select><p>${dateLabel(block.start)} — ${dateLabel(addDate(block.start,block.weeks*7-1))} · ${block.weeks} нед. · ${counted(block.sessions.length,'занятие','занятия','занятий')}</p></div><div class="block-actions">${action('edit-block','Параметры блока')}${action('copy-block','Копировать')}${action('delete-block','Удалить')}</div></div>
    <div class="block-analysis-controls"><div class="block-segment" aria-label="Рука для анализа">${['right','left'].map(a=>action('analysis-arm',armLabel[a],`data-arm="${a}" aria-pressed="${state.arm===a}"`)).join('')}</div><label>След нагрузки<select data-block-control="source">${opt('combined',state.source,'План + факт')}${opt('plan',state.source,'Только план')}${opt('actual',state.source,'Только факт')}</select></label><label class="block-check"><input type="checkbox" data-block-control="warmup" ${state.includeWarmup?'checked':''}>Включить разминку в кривые</label>${action('model','Параметры модели')}</div>
    <div class="block-planning-grid">${calendar(state,block)}${editor(state,block)}</div>${analyticsView(block,ws,state.arm,state.source,state.workouts,state.includeWarmup,state.anchorDate)}`}`;
}

export function dialogView(kind, state, extra={}) {
  const ws=state.workspace, b=ws.blocks.find(x=>x.id===state.blockId), s=b?.sessions.find(x=>x.id===state.sessionId);
  let title='',body='',submit='Сохранить';
  if(kind==='profile'){
    title='Профиль';body=`<p class="block-note">Актуальное полное закрытие на один повтор. Для каждой руки отдельно.</p><div class="block-form-grid">${['right','left'].map(a=>`<fieldset><legend>${armLabel[a]} рука</legend>${field('1ПМ, кг',a+'-max',ws.profile[a].maxKg??'','type="number" min="0.1" max="120.4" step="0.1"')}${field('Дата максимума',a+'-date',ws.profile[a].date,'type="date" max="'+today()+'"')}</fieldset>`).join('')}</div><details><summary>Дополнительно</summary><div class="block-form-grid"><label class="field">Пол<select name="sex">${opt('',ws.profile.sex,'Не указан')}${opt('female',ws.profile.sex,'Женский')}${opt('male',ws.profile.sex,'Мужской')}${opt('other',ws.profile.sex,'Другой')}</select></label>${field('Возраст', 'age', ws.profile.age??'', 'type="number" min="1" max="120" step="1"')}</div><p class="block-note">Пол и возраст сохраняются в профиле и не меняют расчёт нагрузки.</p></details>`;
  }else if(kind==='new-block'||kind==='edit-block'){
    const edit=kind==='edit-block';title=edit?'Параметры блока':'Новый блок';body=field('Название','name',edit?b.name:'Новый блок','maxlength="100" required')+`<div class="block-form-grid">${field('Начало','start',edit?b.start:today(),'type="date" required')}${field('Длительность, недель','weeks',edit?b.weeks:3,'type="number" min="1" max="52" step="1" required')}</div>`; if(edit)body+='<p class="block-note">Изменение начала сдвигает даты занятий вместе с блоком.</p>';
  }else if(kind==='model'){
    title='Параметры модели';body=`<p class="block-note">Кривые показывают наложение тренировок при выбранной скорости затухания.</p><div class="block-form-grid">${field('Время снижения объёма вдвое, дней','volumeHalfLife',ws.model.volumeHalfLife,'type="number" min="0.25" max="30" step="0.25" required')}${field('Время снижения второго графика вдвое, дней','heavyHalfLife',ws.model.heavyHalfLife,'type="number" min="0.25" max="30" step="0.25" required')}</div>${field('Порог второго графика, % 1ПМ','heavyThreshold',ws.model.heavyThreshold,'type="number" min="1" max="150" step="0.1" required')}<p class="block-note">Сценарные настройки, а не сроки восстановления. Начальные значения: 2 и 5 дней. Порог фильтрует повторы второго графика; вся выбранная работа остаётся на первом.</p>`;
  }else if(kind==='copy-session'){
    title='Копировать занятие';body=field('Название','title',s.title,'maxlength="100" required')+field('Дата','date',s.date,`type="date" min="${b.start}" max="${addDate(b.start,b.weeks*7-1)}" required`);submit='Копировать';
  }else if(kind==='repeat-week'){
    const layout=calendarLayout(b),targets=Array.from({length:layout.weeks},(_,i)=>i).filter(i=>canRepeatCalendarWeek(b,extra.week,i));
    title='Повторить неделю';body=`<p>Занятия за ${dateLabel(addDate(layout.start,extra.week*7))} — ${dateLabel(addDate(layout.start,extra.week*7+6))} будут скопированы с сохранением дней недели.</p><label class="field">Неделя назначения<select name="targetWeek" required>${targets.map(i=>opt(i,targets.find(target=>target>extra.week)??targets[0],`${dateLabel(addDate(layout.start,i*7))} — ${dateLabel(addDate(layout.start,i*7+6))}`)).join('')}</select></label>`;submit='Повторить';
  }else if(kind==='delete-block'||kind==='delete-session'){
    title=kind==='delete-block'?'Удалить блок?':'Удалить занятие?';body=`<p>${esc(kind==='delete-block'?b.name:s.title)}</p><p class="block-note">Записанные тренировки останутся в журнале.</p>`;submit='Удалить';
  }
  return `<form id="blockDialogForm"><div class="dialog-heading"><h2>${title}</h2>${action('close-dialog','×','aria-label="Закрыть"')}</div>${body}<p id="blockDialogError" class="form-error" role="alert"></p><div class="dialog-actions">${action('close-dialog','Отмена')}<button type="submit" class="button button--primary">${submit}</button></div></form>`;
}
