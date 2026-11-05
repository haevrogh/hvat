import { blockAnalytics, blockEnd, performanceSeries, scenarioSeries, sessionStats } from './block-model.js';
import { counted } from './block-format.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const number = value => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
const day = value => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
const sources = { plan: 'План', actual: 'Факт', combined: 'План + факт' };
const pairCell = (plan, actual, unit = '') => `<strong>${number(plan)}${unit}</strong><small>факт ${number(actual)}${unit}</small>`;

function traceChart(series, key, title, unit, arm, { scope = 'block', label = point => day(point.date) } = {}) {
  const width = 700, height = 220, left = 46, right = 16, top = 16, bottom = 36;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const max = Math.max(1, ...series.map(point => point[key])) * 1.08;
  const x = index => left + index / Math.max(1, series.length - 1) * plotWidth;
  const y = value => top + plotHeight - value / max * plotHeight;
  const path = series.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(2)},${y(point[key]).toFixed(2)}`).join(' ');
  const ticks = Array.from({ length: 4 }, (_, index) => max * index / 3);
  const dateIndexes = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])].filter(index => index >= 0);
  const inputKey = key === 'volume' ? 'inputVolume' : 'inputHeavyReps';
  const titleId = `${scope}-chart-${arm}-${key}`;
  const labelAt = index => esc(label(series[index], index));
  return `<section class="block-chart"><div class="block-chart-heading"><h3>${title}</h3><span>${unit}</span></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${titleId}">
      <title id="${titleId}">${title}. От ${series.length ? labelAt(0) : 'начала'} до ${series.length ? labelAt(series.length - 1) : 'конца'}.</title>
      ${ticks.map(value => `<line class="block-chart-gridline" x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}"/><text class="block-chart-label" x="${left - 8}" y="${y(value) + 4}" text-anchor="end">${number(value)}</text>`).join('')}
      ${series.length ? `<path class="block-chart-area block-chart-${key}" d="${path} L${x(series.length - 1)},${y(0)} L${x(0)},${y(0)} Z"/><path class="block-chart-line block-chart-${key}" d="${path}"/>` : ''}
      ${series.map((point, index) => point[inputKey] > 0 ? `<circle class="block-chart-point block-chart-${key}" cx="${x(index)}" cy="${y(point[key])}" r="3"><title>${labelAt(index)}: вклад ${number(point[inputKey])}; след ${number(point[key])}</title></circle>` : '').join('')}
      ${dateIndexes.map(index => `<text class="block-chart-label" x="${x(index)}" y="${height - 10}" text-anchor="${index === 0 ? 'start' : index === series.length - 1 ? 'end' : 'middle'}">${labelAt(index)}</text>`).join('')}
    </svg></section>`;
}

export function workloadCharts(series, arm, model, options) {
  return `<div class="block-chart-grid">
    ${traceChart(series, 'volume', 'Относительный объём · все повторы', 'отн. повт.', arm, options)}
    ${traceChart(series, 'heavyReps', `Повторы ≥${number(model.heavyThreshold)}% 1ПМ`, 'условный остаток повторов', arm, options)}
  </div>`;
}

function distribution(title, plan, actual, valueKey, unit) {
  const max = Math.max(1, ...plan.map(item => item[valueKey]), ...actual.map(item => item[valueKey]));
  return `<section class="block-distribution"><h3>${title}</h3><p class="block-note">План / факт · ${unit}</p><div class="block-bars">${plan.map((item, index) => {
    const actualValue = actual[index]?.[valueKey] || 0;
    return `<div class="block-bar-row"><span>${esc(item.label === 'Неизвестно' ? 'Не указан' : item.label)}</span><svg class="block-bar-track" viewBox="0 0 160 20" aria-hidden="true"><rect class="block-bar-background" width="160" height="20" rx="3"/><rect class="block-bar-plan" width="${160 * item[valueKey] / max}" height="8" y="1" rx="2"/><rect class="block-bar-actual" width="${160 * actualValue / max}" height="8" y="11" rx="2"/></svg><strong>${number(item[valueKey])} / ${number(actualValue)}</strong></div>`;
  }).join('')}</div></section>`;
}

function weeksTable(analytics, threshold) {
  return `<div class="block-table-scroll"><table class="block-week-table"><caption>Недели от начала блока · план и факт</caption><thead><tr><th scope="col">Неделя блока</th><th scope="col">Подходы</th><th scope="col">Повторы</th><th scope="col">≥${number(threshold)}%</th><th scope="col">кг·повт.</th><th scope="col">Отн. объём</th><th scope="col">К прошлой</th></tr></thead><tbody>${analytics.weekly.map((week, index) => {
    const actual = analytics.actual.weekly[index], previous = analytics.weekly[index - 1];
    const delta = previous?.relativeVolume > 0 ? (week.relativeVolume / previous.relativeVolume - 1) * 100 : null;
    return `<tr><th scope="row">${week.week}<small>${day(week.start)}–${day(week.end)}</small></th><td>${pairCell(week.sets, actual.sets)}</td><td>${pairCell(week.repetitions, actual.repetitions)}</td><td>${pairCell(week.heavyReps, actual.heavyReps)}</td><td>${pairCell(week.tonnage, actual.tonnage)}</td><td>${pairCell(week.relativeVolume, actual.relativeVolume)}</td><td>${delta === null ? '—' : `${delta > 0 ? '+' : ''}${number(delta)}%`}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function rollingSummary(analytics, anchorDate) {
  const date = anchorDate >= analytics.start && anchorDate <= analytics.end ? anchorDate : analytics.end;
  const rolling = count => {
    const plan = analytics[`rolling${count}`].find(entry => entry.date === date), actual = analytics.actual[`rolling${count}`].find(entry => entry.date === date);
    return `<div><h3>${counted(count,'день','дня','дней')}</h3><strong>${number(plan.relativeVolume)} <small>отн. повт.</small></strong><p>${counted(plan.sets,'подход','подхода','подходов')} · ${counted(plan.repetitions,'повтор','повтора','повторов')}</p><p class="block-note">Факт: ${number(actual.relativeVolume)} отн. повт. · ${counted(actual.sets,'подход','подхода','подходов')} · ${counted(actual.repetitions,'повтор','повтора','повторов')}</p></div>`;
  };
  return `<section class="block-rolling"><div class="block-section-heading"><h3>Нагрузка за период</h3><label class="block-range">По дату<input type="date" data-block-control="anchor" min="${analytics.start}" max="${analytics.end}" value="${date}"></label></div><div class="block-rolling-grid">${rolling(7)}${rolling(21)}</div></section>`;
}

function performanceView(workouts, arm) {
  const all = performanceSeries(workouts, arm), best = new Map();
  for (const entry of all) {
    const key = `${entry.workoutId}:${entry.pair}`;
    if (!best.has(key) || best.get(key).reps < entry.reps) best.set(key, entry);
  }
  const entries = [...best.values()].slice(-6);
  return `<section class="block-performance"><h3>Работоспособность · факт</h3>${!entries.length
    ? '<p class="block-empty">В журнале пока нет выполненных рабочих подходов этой руки.</p>'
    : `<p class="block-note">Повторы на той же паре. Обычный диапазон — лучшие результаты 3–5 предыдущих занятий.</p><div class="block-table-scroll"><table class="block-week-table"><thead><tr><th scope="col">Дата</th><th scope="col">Пара / кг</th><th scope="col">Повторы</th><th scope="col">Обычный диапазон</th></tr></thead><tbody>${entries.map(entry => `<tr><th scope="row">${day(entry.date)}</th><td>${esc(entry.pair.replace('-', '/'))} · ${number(entry.kg)}</td><td>${number(entry.reps)}${entry.improvedReps ? '<small>Выше прежнего результата</small>' : ''}</td><td>${entry.usualLow === null ? `<small>Нужно ещё ${counted(Math.max(0, 3 - entry.baselineCount),'сопоставимое занятие','сопоставимых занятия','сопоставимых занятий')}</small>` : `${number(entry.usualLow)}–${number(entry.usualHigh)} повт.`}</td></tr>`).join('')}</tbody></table></div>`}</section>`;
}

export function analyticsView(block, workspace, arm, source, workouts, includeWarmup = false, anchorDate = '') {
  const model = workspace.model, analytics = blockAnalytics(block, workspace.profile, arm, model, workouts);
  const plan = analytics.totals, actual = analytics.actual.totals;
  const series = scenarioSeries(block, workspace.profile, arm, model, source, workouts, includeWarmup);
  const warmup = analytics.warmup?.totals || block.sessions.reduce((total, session) => {
    const stats = sessionStats(session, workspace.profile, arm, model.heavyThreshold).warmup;
    return { sets: total.sets + stats.sets, repetitions: total.repetitions + stats.repetitions };
  }, { sets: 0, repetitions: 0 });
  const hasTrace = series.some(point => point.volume || point.heavyReps);
  return `<div class="block-analytics"><div class="block-section-heading"><h2>Нагрузка блока</h2><span class="block-note">${arm === 'right' ? 'Правая рука' : 'Левая рука'}</span></div>
    <div class="block-metrics">
      <div><span>Рабочие подходы</span>${pairCell(plan.sets, actual.sets)}</div>
      <div><span>Рабочие повторы</span>${pairCell(plan.repetitions, actual.repetitions)}</div>
      <div><span>Повторы ≥${number(model.heavyThreshold)}%</span>${pairCell(plan.heavyReps, actual.heavyReps)}</div>
      <div><span>Относительный объём</span>${pairCell(plan.relativeVolume, actual.relativeVolume)}</div>
    </div>
    <p class="block-note">Разминка: план ${counted(warmup.sets,'подход','подхода','подходов')} · ${counted(warmup.repetitions,'повтор','повтора','повторов')}; факт ${counted(analytics.actualWarmup?.totals.sets,'подход','подхода','подходов')} · ${counted(analytics.actualWarmup?.totals.repetitions,'повтор','повтора','повторов')}. Рабочий объём: ${number(plan.tonnage)} кг·повт.; факт ${number(actual.tonnage)} кг·повт.</p>
    ${!plan.complete ? `<p class="block-warning" role="status">Не подобрано строк: ${plan.unavailableRows}. Их объём и интенсивность не включены в расчёт.</p>` : ''}
    ${!actual.complete ? `<p class="block-warning" role="status">Факт без сохранённого 1ПМ: ${counted(actual.unavailableRows,'подход','подхода','подходов')}. Объём в кг·повт. учтён; относительные показатели недоступны.</p>` : ''}
    <div class="block-section-heading"><h3>След нагрузки · ${sources[source] || sources.plan}</h3><span class="block-note">${includeWarmup ? 'С разминкой' : 'Рабочие подходы'}</span></div>
    ${hasTrace ? workloadCharts(series, arm, model) : `<p class="block-empty">${source === 'actual' ? actual.repetitions > 0 ? 'Для кривых факта нужны подходы с сохранённым 1ПМ.' : 'В выбранном блоке нет выполненных повторений этой руки.' : 'Добавьте доступные рабочие подходы для графика нагрузки.'}</p>`}
    <p class="block-note">Первый график учитывает все выбранные повторы, второй — только от ${number(model.heavyThreshold)}% 1ПМ по подобранному сопротивлению. Порог — фильтр нагрузки; состояние тканей не рассчитывается. Время снижения вдвое: ${number(model.volumeHalfLife)} / ${number(model.heavyHalfLife)} дн.</p>
    ${rollingSummary(analytics, anchorDate || blockEnd(block))}
    ${weeksTable(analytics, model.heavyThreshold)}
    <div class="block-distributions">${distribution('Относительное сопротивление', plan.intensityDistribution, actual.intensityDistribution, 'repetitions', 'повторы')}${distribution('Запас повторений', plan.rirDistribution, actual.rirDistribution, 'sets', 'рабочие подходы')}</div>
    ${performanceView(workouts, arm)}
  </div>`;
}
