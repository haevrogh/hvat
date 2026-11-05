import { workloadCharts } from './block-charts.js';
import { today } from './block-view.js';
import { cycleLoadSeries } from './cycle-charts-model.js';

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

function chartButton(action, text, selected, attributes = '') {
  return `<button type="button" class="button ${selected ? 'button--primary' : 'button--quiet'}" data-cycle-action="${action}" aria-pressed="${selected}" ${attributes}>${text}</button>`;
}

export function cycleChartsView({ cycle, model, arm, source, workouts }) {
  const { series, firstWeek, lastWeek, hasTrace } = cycleLoadSeries({
    cycle, model, arm, source, workouts, today: today(),
  });
  const isPlan = source === 'plan';
  const options = { scope: 'cycle' };
  if (isPlan) options.label = point => `Нед. ${point.week}`;

  return `<section class="cycle-load" aria-labelledby="cycleLoadTitle">
    <div class="training-panel cycle-load-controls">
      <h3 id="cycleLoadTitle">Нагрузка цикла</h3>
      <div class="cycle-load-filters">
        <div class="cycle-view-switch" role="group" aria-label="Рука на графиках">
          ${chartButton('chart-arm', 'Левая рука', arm === 'left', 'data-arm="left"')}
          ${chartButton('chart-arm', 'Правая рука', arm === 'right', 'data-arm="right"')}
        </div>
        <div class="cycle-view-switch" role="group" aria-label="Источник нагрузки">
          ${chartButton('chart-source', 'План', isPlan, 'data-source="plan"')}
          ${chartButton('chart-source', 'Факт', !isPlan, 'data-source="actual"')}
        </div>
      </div>
      <p class="cycle-note">${isPlan
        ? `Недели ${firstWeek}–${lastWeek}. Для расчёта нагрузки занятия условно приходятся на 1-й и 4-й день недели.`
        : 'Выполненные рабочие подходы цикла за последние 26 календарных недель.'}</p>
    </div>
    ${hasTrace ? workloadCharts(series, arm, model, options) : `<p class="training-panel cycle-note" role="status">${isPlan
      ? 'Для выбранной руки нет доступных нагрузок в плане.'
      : 'Для выбранной руки пока нет записанных повторов за этот период.'}</p>`}
    <p class="cycle-note">Первый график суммирует повторы с учётом сопротивления. Второй показывает повторы от ${number.format(model.heavyThreshold)}% 1ПМ. Время снижения нагрузки вдвое и порог берутся из настроек «Плана блока».</p>
  </section>`;
}
