import { Status } from "./task.ts";

/**
 * Depth-first cycle detection. Returns true when adding blockerIds as blockers
 * of taskId would create a dependency cycle.
 */
export function hasCycle(
  taskId: number,
  blockerIds: readonly number[] | null,
  getBlockers: (id: number) => number[],
): boolean {
  if (!blockerIds) return false;

  for (const bid of blockerIds) {
    const visited = new Set<number>();
    if (reaches(bid, taskId, visited, getBlockers)) return true;
  }
  return false;
}

function reaches(
  id: number,
  target: number,
  visited: Set<number>,
  getBlockers: (id: number) => number[],
): boolean {
  if (id === target) return true;
  if (visited.has(id)) return false;
  visited.add(id);
  for (const dep of getBlockers(id) ?? []) {
    if (reaches(dep, target, visited, getBlockers)) return true;
  }
  return false;
}

/** True when any blocker is not Done. */
export function isBlocked(
  blockedByIds: readonly number[] | null,
  getStatus: (id: number) => Status,
): boolean {
  if (!blockedByIds) return false;
  return blockedByIds.some((id) => getStatus(id) !== Status.Done);
}
