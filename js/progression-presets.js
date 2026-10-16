export const PRESET_VERSION = 'hvat-four-periods-1';
export const PERIODS = Object.freeze([
  { key: 'endurance', label: 'Выносливость', min: 6, max: 20, reps: [8, 12], rest: 180, cue: 'Контролируемое закрытие и возвращение. Набираем объём.' },
  { key: 'strength', label: 'Сила', min: 6, max: 12, reps: [4, 6], rest: 240, cue: 'Полное закрытие без помощи. Контролируемое возвращение.' },
  { key: 'speed', label: 'Быстрота', min: 6, max: 10, reps: [2, 5], rest: 240, cue: 'Закрывай быстро, возвращай контролируемо. Скорость приложение не измеряет.' },
  { key: 'peak', label: 'Пик силы', min: 8, max: 10, reps: [1, 4], rest: 300, cue: 'Полное закрытие. Объём снижается перед целевой датой.' },
]);
export const DAYS = Object.freeze(['Тяжёлое', 'Лёгкое', 'Среднее']);
// Entries: fraction of the weekly calculation base, sets, repetitions.
export const BASE_LOADS = Object.freeze({
  endurance: [[.60, 4, 10], [.35, 2, 12], [.45, 3, 10]],
  strength: [[.70, 5, 5], [.40, 2, 6], [.60, 4, 5]],
  speed: [[.70, 5, 3], [.40, 3, 3], [.60, 4, 3]],
});
export const INTENSITY_WAVE = Object.freeze([.95, 1, 1.05, .9]);
export const SET_WAVE = Object.freeze([.8, 1, 1.2, .5]);
export const ROLES = Object.freeze({ warmup: 'Разминка', main: 'Рабочий', test: 'Контроль' });
