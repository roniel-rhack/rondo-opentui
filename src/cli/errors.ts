/** A requested resource was not found. Ids are numeric except journal
 * notes, which are addressed by date. */
export class NotFoundError extends Error {
  constructor(
    readonly type: "task" | "subtask" | "entry" | "note",
    readonly id: number | string,
  ) {
    super(
      typeof id === "number"
        ? `${type} #${id} not found`
        : `${type} ${id} not found`,
    );
    this.name = "NotFoundError";
  }
}

export function isNotFound(err: unknown): err is NotFoundError {
  return err instanceof NotFoundError;
}
