const plurals = new Intl.PluralRules('ru');
const numbers = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export function counted(value, one, few, many) {
  const count = Number(value || 0), form = plurals.select(count);
  return `${numbers.format(count)} ${form === 'one' ? one : form === 'many' ? many : few}`;
}
