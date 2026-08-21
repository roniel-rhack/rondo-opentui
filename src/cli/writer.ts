/** Minimal writer abstraction so tests can capture command output. */
export interface Writer {
  write(s: string): void;
  readonly isTTY: boolean;
}

export function stdoutWriter(): Writer {
  return {
    write: (s) => process.stdout.write(s),
    get isTTY() {
      return Boolean(process.stdout.isTTY);
    },
  };
}

export function stderrWriter(): Writer {
  return {
    write: (s) => process.stderr.write(s),
    get isTTY() {
      return Boolean(process.stderr.isTTY);
    },
  };
}

export class BufferWriter implements Writer {
  private chunks: string[] = [];

  constructor(readonly isTTY = false) {}

  write(s: string): void {
    this.chunks.push(s);
  }

  toString(): string {
    return this.chunks.join("");
  }

  clear(): void {
    this.chunks = [];
  }
}
