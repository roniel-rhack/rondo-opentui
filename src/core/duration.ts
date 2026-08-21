/**
 * Durations are expressed in nanoseconds, like Go's time.Duration, because the
 * SQLite schema stores them that way.
 */

export type Duration = number;

export const Nanosecond: Duration = 1;
export const Microsecond: Duration = 1_000;
export const Millisecond: Duration = 1_000_000;
export const Second: Duration = 1_000_000_000;
export const Minute: Duration = 60 * Second;
export const Hour: Duration = 60 * Minute;

const UNITS: Record<string, Duration> = {
  ns: Nanosecond,
  us: Microsecond,
  "µs": Microsecond,
  "μs": Microsecond,
  ms: Millisecond,
  s: Second,
  m: Minute,
  h: Hour,
};

/**
 * Parses a Go duration string such as "1h30m", "45m" or "2h".
 * Returns null when the string is not a valid duration.
 */
export function parseGoDuration(s: string): Duration | null {
  let input = s;
  if (input === "") return null;

  let neg = false;
  if (input.startsWith("-") || input.startsWith("+")) {
    neg = input.startsWith("-");
    input = input.slice(1);
  }
  if (input === "0") return 0;
  if (input === "") return null;

  let total = 0;
  let matched = false;
  const re = /(\d+(?:\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h)/y;
  let pos = 0;
  while (pos < input.length) {
    re.lastIndex = pos;
    const m = re.exec(input);
    if (!m) return null;
    const unit = UNITS[m[2]!];
    if (unit === undefined) return null;
    total += Number(m[1]) * unit;
    pos = re.lastIndex;
    matched = true;
  }
  if (!matched) return null;
  return neg ? -total : total;
}

export function durationMinutes(d: Duration): number {
  return d / Minute;
}

export function durationSeconds(d: Duration): number {
  return d / Second;
}

export function durationMs(d: Duration): number {
  return d / Millisecond;
}
