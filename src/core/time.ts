/**
 * Go-compatible time handling.
 *
 * The original RonDO is written in Go and its persistence format, CLI output
 * and configuration all rely on Go's reference-layout formatting
 * ("2006-01-02", "Jan 02, 2006", "3:04 PM", ...) and on `time.Time` semantics
 * such as location-aware wall clocks and `AddDate` overflow normalization.
 *
 * `GoTime` reproduces that behaviour on top of the JavaScript Date so the port
 * keeps byte-for-byte compatible output and database contents.
 */

export type Loc = "utc" | "local";

export interface DateParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  /** 0 = Sunday */
  weekday: number;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const DateOnly = "2006-01-02";
export const RFC3339 = "2006-01-02T15:04:05Z07:00";

function pad(value: number, width: number): string {
  return String(Math.abs(value)).padStart(width, "0");
}

export class GoTime {
  private constructor(
    readonly ms: number,
    readonly loc: Loc,
  ) {}

  static fromMs(ms: number, loc: Loc = "local"): GoTime {
    return new GoTime(ms, loc);
  }

  static fromDate(d: Date, loc: Loc = "local"): GoTime {
    return new GoTime(d.getTime(), loc);
  }

  static now(): GoTime {
    return new GoTime(Date.now(), "local");
  }

  static utcNow(): GoTime {
    return new GoTime(Date.now(), "utc");
  }

  /** Mirrors Go's time.Date: out-of-range components normalize forward. */
  static date(
    year: number,
    month: number,
    day: number,
    hour = 0,
    minute = 0,
    second = 0,
    millisecond = 0,
    loc: Loc = "local",
  ): GoTime {
    return new GoTime(
      buildMs({ year, month, day, hour, minute, second, millisecond }, loc),
      loc,
    );
  }

  /** Zero value, used where Go would carry an unset time.Time. */
  static zero(loc: Loc = "utc"): GoTime {
    return GoTime.date(1, 1, 1, 0, 0, 0, 0, loc);
  }

  get parts(): DateParts {
    const d = new Date(this.ms);
    if (this.loc === "utc") {
      return {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
        second: d.getUTCSeconds(),
        millisecond: d.getUTCMilliseconds(),
        weekday: d.getUTCDay(),
      };
    }
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
      millisecond: d.getMilliseconds(),
      weekday: d.getDay(),
    };
  }

  /** Offset from UTC in minutes for this instant in this location. */
  get offsetMinutes(): number {
    if (this.loc === "utc") return 0;
    return -new Date(this.ms).getTimezoneOffset();
  }

  year(): number {
    return this.parts.year;
  }

  toDate(): Date {
    return new Date(this.ms);
  }

  in(loc: Loc): GoTime {
    return new GoTime(this.ms, loc);
  }

  utc(): GoTime {
    return this.in("utc");
  }

  local(): GoTime {
    return this.in("local");
  }

  /** Adds nanoseconds, matching time.Time.Add. */
  add(ns: number): GoTime {
    return new GoTime(this.ms + ns / 1e6, this.loc);
  }

  addMs(ms: number): GoTime {
    return new GoTime(this.ms + ms, this.loc);
  }

  /** Mirrors time.Time.AddDate, including calendar overflow normalization. */
  addDate(years: number, months: number, days: number): GoTime {
    const p = this.parts;
    return new GoTime(
      buildMs(
        {
          year: p.year + years,
          month: p.month + months,
          day: p.day + days,
          hour: p.hour,
          minute: p.minute,
          second: p.second,
          millisecond: p.millisecond,
        },
        this.loc,
      ),
      this.loc,
    );
  }

  /** Difference in nanoseconds (this - other), like time.Time.Sub. */
  sub(other: GoTime): number {
    return (this.ms - other.ms) * 1e6;
  }

  before(other: GoTime): boolean {
    return this.ms < other.ms;
  }

  after(other: GoTime): boolean {
    return this.ms > other.ms;
  }

  equal(other: GoTime): boolean {
    return this.ms === other.ms;
  }

  /** time.Time.Truncate(24h): truncation is relative to the zero time in UTC. */
  truncateDay(): GoTime {
    const day = 24 * 60 * 60 * 1000;
    return new GoTime(Math.floor(this.ms / day) * day, this.loc);
  }

  format(layout: string): string {
    return formatGo(this, layout);
  }

  toString(): string {
    return this.format(RFC3339);
  }
}

function buildMs(
  p: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    millisecond: number;
  },
  loc: Loc,
): number {
  if (loc === "utc") {
    return Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
      p.millisecond,
    );
  }
  const d = new Date(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
    p.millisecond,
  );
  // Years 0-99 are mapped to 1900-1999 by the Date constructor.
  if (p.year >= 0 && p.year <= 99) d.setFullYear(p.year);
  return d.getTime();
}

/** Layout tokens, longest first so that scanning is greedy like Go's. */
const TOKENS = [
  "2006",
  "January",
  "Jan",
  "Monday",
  "Mon",
  "-07:00",
  "-0700",
  "Z07:00",
  "Z0700",
  ".000000000",
  ".000000",
  ".000",
  "15",
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "_2",
  "PM",
  "pm",
  "MST",
  "1",
  "2",
  "3",
  "4",
  "5",
] as const;

type Token = (typeof TOKENS)[number];

function tokenAt(layout: string, i: number): Token | null {
  for (const tok of TOKENS) {
    if (layout.startsWith(tok, i)) return tok;
  }
  return null;
}

function hour12(hour: number): number {
  const h = hour % 12;
  return h === 0 ? 12 : h;
}

export function formatGo(t: GoTime, layout: string): string {
  const p = t.parts;
  const offset = t.offsetMinutes;
  let out = "";
  let i = 0;

  while (i < layout.length) {
    const tok = tokenAt(layout, i);
    if (!tok) {
      out += layout[i];
      i += 1;
      continue;
    }
    i += tok.length;

    switch (tok) {
      case "2006":
        out += p.year < 0 ? `-${pad(p.year, 4)}` : pad(p.year, 4);
        break;
      case "06":
        out += pad(p.year % 100, 2);
        break;
      case "January":
        out += MONTH_NAMES[p.month - 1];
        break;
      case "Jan":
        out += MONTH_NAMES[p.month - 1]!.slice(0, 3);
        break;
      case "Monday":
        out += DAY_NAMES[p.weekday];
        break;
      case "Mon":
        out += DAY_NAMES[p.weekday]!.slice(0, 3);
        break;
      case "01":
        out += pad(p.month, 2);
        break;
      case "1":
        out += String(p.month);
        break;
      case "02":
        out += pad(p.day, 2);
        break;
      case "_2":
        out += String(p.day).padStart(2, " ");
        break;
      case "2":
        out += String(p.day);
        break;
      case "15":
        out += pad(p.hour, 2);
        break;
      case "03":
        out += pad(hour12(p.hour), 2);
        break;
      case "3":
        out += String(hour12(p.hour));
        break;
      case "04":
        out += pad(p.minute, 2);
        break;
      case "4":
        out += String(p.minute);
        break;
      case "05":
        out += pad(p.second, 2);
        break;
      case "5":
        out += String(p.second);
        break;
      case "PM":
        out += p.hour < 12 ? "AM" : "PM";
        break;
      case "pm":
        out += p.hour < 12 ? "am" : "pm";
        break;
      case ".000":
        out += `.${pad(p.millisecond, 3)}`;
        break;
      case ".000000":
        out += `.${pad(p.millisecond, 3)}000`;
        break;
      case ".000000000":
        out += `.${pad(p.millisecond, 3)}000000`;
        break;
      case "MST":
        out += t.loc === "utc" ? "UTC" : localZoneName(t);
        break;
      case "Z07:00":
        out += offset === 0 ? "Z" : formatOffset(offset, true);
        break;
      case "Z0700":
        out += offset === 0 ? "Z" : formatOffset(offset, false);
        break;
      case "-07:00":
        out += formatOffset(offset, true);
        break;
      case "-0700":
        out += formatOffset(offset, false);
        break;
    }
  }
  return out;
}

function formatOffset(minutes: number, colon: boolean): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = pad(Math.floor(abs / 60), 2);
  const mm = pad(abs % 60, 2);
  return colon ? `${sign}${hh}:${mm}` : `${sign}${hh}${mm}`;
}

function localZoneName(t: GoTime): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
    .formatToParts(t.toDate())
    .find((part) => part.type === "timeZoneName")?.value;
  return name ?? "Local";
}

/**
 * Parses "YYYY-MM-DD" in the given location, mirroring
 * time.ParseInLocation(time.DateOnly, ...).
 */
export function parseDateOnly(s: string, loc: Loc = "utc"): GoTime {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`parsing time "${s}" as "2006-01-02"`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) throw new Error(`month out of range: ${s}`);
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`day out of range: ${s}`);
  }
  return GoTime.date(year, month, day, 0, 0, 0, 0, loc);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Parses an RFC3339 timestamp, keeping UTC when the offset is "Z"/+00:00. */
export function parseRFC3339(s: string): GoTime {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|z|[+-]\d{2}:\d{2})$/.exec(
      s.trim(),
    );
  if (!m) throw new Error(`parsing time "${s}" as RFC3339`);
  const [, y, mo, d, h, mi, sec, frac, zone] = m;
  const millis = frac ? Math.round(Number(frac) * 1000) : 0;
  const utcMs =
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(sec),
      millis,
    ) - zoneOffsetMinutes(zone!) * 60_000;
  const loc: Loc = zoneOffsetMinutes(zone!) === 0 ? "utc" : "local";
  return GoTime.fromMs(utcMs, loc);
}

function zoneOffsetMinutes(zone: string): number {
  if (zone === "Z" || zone === "z") return 0;
  const sign = zone.startsWith("-") ? -1 : 1;
  const hh = Number(zone.slice(1, 3));
  const mm = Number(zone.slice(4, 6));
  return sign * (hh * 60 + mm);
}

/** True when both times fall on the same calendar day in their own location. */
export function sameDay(a: GoTime, b: GoTime): boolean {
  const pa = a.parts;
  const pb = b.parts;
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}
