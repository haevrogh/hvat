import { actualWorkloadEntries, addBlockDays, validBlockDate, workloadSeries } from './block-model.js';
import { getCycleWeeks } from './cycle-model.js';

const WEEK_COUNT = 26;
const DAY_COUNT = WEEK_COUNT * 7;

export function cycleLoadSeries({ cycle, model, arm, source = 'plan', workouts = [], today }) {
  if (arm !== 'right' && arm !== 'left') throw new Error('Выбери руку для графика.');
  if (!validBlockDate(today)) throw new Error('Некорректная дата графика.');
  if (source !== 'plan' && source !== 'actual') throw new Error('Неизвестный источник нагрузки цикла.');

  let series;
  let firstWeek = null;
  let lastWeek = null;
  if (source === 'plan') {
    firstWeek = cycle.week;
    lastWeek = firstWeek + WEEK_COUNT - 1;
    const weeks = getCycleWeeks(cycle, Array.from({ length: WEEK_COUNT }, (_, index) => firstWeek + index));
    // Dates anchor the decay model only. Both sessions belong to the projection
    // for each training week, regardless of the current session cursor.
    const planned = weeks.flatMap((week, index) => week.sessions.map(session => ({
      date: addBlockDays(today, index * 7 + (session.day === 1 ? 0 : 3)),
      rows: session.arms[arm].map(group => ({
        role: group.role,
        sets: group.sets,
        totalReps: group.sets * group.reps,
        actualKg: group.pair?.kg ?? null,
        intensity: group.pair ? group.pair.kg / session.maxima[arm] * 100 : null,
        available: group.available,
      })),
    })));
    series = workloadSeries({ start: today, end: addBlockDays(today, DAY_COUNT - 1), model, planned })
      .map((point, index) => ({ ...point, week: firstWeek + Math.floor(index / 7), trainingDay: index % 7 + 1 }));
  } else {
    const oldestVisibleDate = addBlockDays(today, 1 - DAY_COUNT);
    const actual = actualWorkloadEntries(workouts.filter(workout => workout.cycleId === cycle.id), arm);
    let firstDate;
    for (const entry of actual) {
      if (entry.date < oldestVisibleDate || entry.date > today || entry.role === 'warmup') continue;
      if (!firstDate || entry.date < firstDate) firstDate = entry.date;
    }
    // Keep earlier rows for the decayed carryover, even when they predate the
    // visible window. A tail on its own does not establish visible fact.
    series = firstDate ? workloadSeries({ start: firstDate, end: today, model, actual }) : [];
  }

  return { series, firstWeek, lastWeek, hasTrace: series.some(point => point.inputVolume > 0 || point.inputHeavyReps > 0) };
}
