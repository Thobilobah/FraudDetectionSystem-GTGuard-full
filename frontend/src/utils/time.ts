// API timestamps are naive ISO strings produced in UTC (the backend runs on
// Vercel, whose clock is UTC). JavaScript parses naive date-times in the
// browser's local zone, which renders every row a full UTC offset away from
// the real event (e.g. 18:59 UTC displayed as 18:59 WAT while the wall clock
// reads 19:59). Treat a missing offset as UTC so displayed times match the
// wall clock; strings that already carry Z or +HH:MM pass through untouched.
export const parseApiTimestamp = (value: string): Date =>
  new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
