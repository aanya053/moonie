export function toApiDateTime(localValue: string): string | null {
  if (!localValue) return null;
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function fromApiDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

export function isToday(value: string | null, now = new Date()): boolean {
  if (!value) return false;
  const date = new Date(value);
  return date.toLocaleDateString() === now.toLocaleDateString();
}

export function isUpcoming(value: string | null, now = new Date()): boolean {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() > now.getTime() && !isToday(value, now);
}
