import type { LpiItem } from '../types/lpi';

export function isCompleted(item: LpiItem): boolean {
  return !!item.protocol_date && item.protocol_date.trim() !== '' && item.protocol_date !== '—';
}

export function statusDisplay(item: LpiItem): string {
  if (isCompleted(item)) return 'Завершена';
  return 'Активна';
}

export const METHOD_NAMES: Record<string, string> = {
  'method1': 'Группа горючести',
  'method2': 'Группа воспламеняемости',
  'method3': 'Группа распространения пламени',
  'method4': 'Кислородный индекс',
  'g56027': 'Малое пламя',
  'g56927': 'Малое пламя',
};

export function getMethodDisplayName(abbr: string): string {
  return METHOD_NAMES[abbr] || abbr;
}

export function getProtocolDate(item: LpiItem): string {
  if (isCompleted(item)) return item.protocol_date || '';
  return '—';
}

export function isBeforeCutoff(item: LpiItem): boolean {
  const id = parseInt(item.application_external_id, 10);
  return !isNaN(id) && id < 642;
}
