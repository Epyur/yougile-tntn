/**
 * Извлекает читаемое сообщение из значения, попавшего в `catch (e: unknown)`.
 * Правило `.rules`: `catch (e: any)` и обращение к `e.message` без проверки запрещены.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(e);
}
