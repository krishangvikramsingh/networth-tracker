/** Date helpers using ISO yyyy-mm-dd strings in UTC to keep behaviour deterministic. */
export type ISODate = string;

export function toDate(iso: ISODate): Date {
  return new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
}
export function isoOf(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}
export function addDays(iso: ISODate, n: number): ISODate {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoOf(d);
}
export function addMonths(iso: ISODate, n: number): ISODate {
  const d = toDate(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return isoOf(d);
}
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}
export function monthKey(iso: ISODate): string {
  return iso.slice(0, 7);
}
export function startOfMonth(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`;
}
export function endOfMonth(iso: ISODate): ISODate {
  const d = toDate(iso);
  return isoOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}
export function isValidISODate(s: unknown): s is ISODate {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = toDate(s);
  return !Number.isNaN(d.getTime()) && isoOf(d) === s;
}
export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m) - 1]} ${y.slice(2)}`;
}
export function todayISO(): ISODate {
  return isoOf(new Date());
}
