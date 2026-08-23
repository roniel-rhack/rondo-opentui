import { useEffect, useState } from "react";
import { GoTime } from "../../core/time.ts";

/**
 * A "now" that only changes every `intervalMs`. Due labels and the day
 * grouping read the calendar date, so a coarse clock keeps the memoized list
 * from reconciling on every render while the identity still follows the day.
 */
export function useClock(intervalMs = 15_000): GoTime {
  const [now, setNow] = useState(() => GoTime.now());
  useEffect(() => {
    const id = setInterval(() => setNow(GoTime.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
