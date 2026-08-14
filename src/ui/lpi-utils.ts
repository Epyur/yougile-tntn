import type { LpiItem, LpiTaskDescription } from '../types/lpi';

/** Безопасно разбирает `description` задачи YouGile как LPI-описание. */
export function parseLpiDescription(description: string | undefined): LpiTaskDescription | null {
  if (!description) return null;
  try {
    const parsed: unknown = JSON.parse(description);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as LpiTaskDescription;
  } catch {
    return null;
  }
}

/** Является ли задача YouGile носителем данных LPI-заявки. */
export function isLpiTaskDescription(desc: LpiTaskDescription | null): desc is LpiTaskDescription {
  return !!desc && (desc.type === 'lpi_data' || desc.type === 'lpi_completed');
}

/** Значение поля заявки, прочитанного по динамическому ключу (config-driven UI). */
export type LpiFieldValue = string | number | null | undefined;

/**
 * Читает поле заявки по строковому ключу из конфигурации.
 * Единственная точка приведения типов вместо `(item as any)[key]` по всему коду.
 */
export function getLpiField(item: LpiItem, key: string): LpiFieldValue {
  const value = (item as unknown as Record<string, unknown>)[key];
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number') return value;
  return String(value);
}

/** Записывает поле заявки по строковому ключу из конфигурации. */
export function setLpiField(item: LpiItem, key: string, value: string | number | null): void {
  (item as unknown as Record<string, string | number | null>)[key] = value;
}

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

export function toMonthKey(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const s = dateStr.trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}/.test(s)) return s.substring(0, 7);
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}`;
  return '';
}

export function isBeforeCutoff(item: LpiItem): boolean {
  const id = parseInt(item.application_external_id, 10);
  return !isNaN(id) && id < 642;
}
