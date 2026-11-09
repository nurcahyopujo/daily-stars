export function jakartaToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function nextDate(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function dayBounds(today: string): [number, number] {
  return [Date.parse(`${today}T00:00:00+07:00`) / 1000,
    Date.parse(`${nextDate(today)}T00:00:00+07:00`) / 1000];
}
