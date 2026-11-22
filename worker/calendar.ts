export function jakartaToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function nextDate(date: string): string {
  return shiftDate(date, 1);
}

export function dayBounds(today: string): [number, number] {
  return [Date.parse(`${today}T00:00:00+07:00`) / 1000,
    Date.parse(`${nextDate(today)}T00:00:00+07:00`) / 1000];
}
