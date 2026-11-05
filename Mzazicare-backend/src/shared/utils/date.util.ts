export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export const addMinutes = (date: Date, minutes: number) =>
  new Date(date.getTime() + minutes * MINUTE_MS);

export const minutesBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / MINUTE_MS);

export const startOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const endOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

/** Two [start, end) ranges overlap — used for booking clash detection. */
export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
  aStart < bEnd && bStart < aEnd;
