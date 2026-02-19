import { startOfDayUtc } from "../time";

export function getRunIndexUtc(slotMinutes: number): number {
  const now = new Date();
  const start = startOfDayUtc(now).getTime();
  const minutesSince = Math.floor((now.getTime() - start) / (60 * 1000));
  return Math.floor(minutesSince / slotMinutes);
}

