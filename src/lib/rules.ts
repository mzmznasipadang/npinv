export type Status = "draft" | "sent" | "paid";
export type DisplayStatus = Status | "overdue";

const TIME_ZONE = "Asia/Jakarta";

/** Today's date as YYYY-MM-DD in the business time zone. */
export function today(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "2026-10-12" to "12 October 2026". */
export function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** Overdue means sent and due before today. Due today is not overdue. */
export function displayStatus(status: Status, dueDate: string, todayDate: string): DisplayStatus {
  return status === "sent" && dueDate < todayDate ? "overdue" : status;
}

export function formatNumber(prefix: string, year: string, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(3, "0")}`;
}

/** One above the highest sequence already used for this prefix and year. */
export function nextSequence(numbers: readonly string[], prefix: string, year: string): number {
  const head = `${prefix}-${year}-`;
  let max = 0;
  for (const n of numbers) {
    if (!n.startsWith(head)) continue;
    const tail = n.slice(head.length);
    if (/^\d+$/.test(tail)) max = Math.max(max, Number(tail));
  }
  return max + 1;
}
