// CC-074: today's date in the user's own time zone (YYYY-MM-DD). new Date().toISOString() gives the UTC date, which in
// Cairo (UTC+2 / +3) is still yesterday between midnight and 02:00-03:00 local time, so entries recorded then were dated
// a day early.
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
