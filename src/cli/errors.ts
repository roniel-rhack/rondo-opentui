/** A requested resource was not found. */
export class NotFoundError extends Error {
  constructor(
    readonly type: "task" | "subtask" | "entry" | "note",
    readonly id: number,
  ) {
    super(`${type} #${id} not found`);
    this.name = "NotFoundError";
  }
}

export function isNotFound(err: unknown): err is NotFoundError {
  return err instanceof NotFoundError;
}
