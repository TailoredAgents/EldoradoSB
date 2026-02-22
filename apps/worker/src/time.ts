const DEFAULT_TIME_ZONE = "America/New_York";

export function getAppTimeZone(): string {
  return process.env.APP_TIME_ZONE ?? DEFAULT_TIME_ZONE;
}

type DateParts = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
};

function getPartsInTimeZone(date: Date, timeZone: string): DateParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = dtf.formatToParts(date);
  const out: Record<string, number> = {};
  for (const p of parts) {
    if (p.type === "year") out.year = Number(p.value);
    if (p.type === "month") out.month = Number(p.value);
    if (p.type === "day") out.day = Number(p.value);
    if (p.type === "hour") out.hour = Number(p.value);
    if (p.type === "minute") out.minute = Number(p.value);
    if (p.type === "second") out.second = Number(p.value);
  }

  if (
    !Number.isFinite(out.year) ||
    !Number.isFinite(out.month) ||
    !Number.isFinite(out.day) ||
    !Number.isFinite(out.hour) ||
    !Number.isFinite(out.minute) ||
    !Number.isFinite(out.second)
  ) {
    throw new Error(`Failed to compute zoned date parts for tz=${timeZone}`);
  }

  return out as DateParts;
}

function zonedTimeToUtc(parts: Omit<DateParts, "hour" | "minute" | "second"> & { hour?: number; minute?: number; second?: number }, timeZone: string): Date {
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const hour = parts.hour ?? 0;
  const minute = parts.minute ?? 0;
  const second = parts.second ?? 0;

  // Start with a UTC guess, then adjust based on how that instant formats in the target timezone.
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  for (let i = 0; i < 2; i += 1) {
    const actual = getPartsInTimeZone(guess, timeZone);
    const desiredUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const actualAsUtcMs = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const diffMs = desiredUtcMs - actualAsUtcMs;
    if (diffMs === 0) break;
    guess = new Date(guess.getTime() + diffMs);
  }
  return guess;
}

// Returns a Date representing midnight in the app's timezone, expressed as a UTC instant.
export function startOfDayApp(date: Date, timeZone = getAppTimeZone()): Date {
  const parts = getPartsInTimeZone(date, timeZone);
  return zonedTimeToUtc({ year: parts.year, month: parts.month, day: parts.day }, timeZone);
}

