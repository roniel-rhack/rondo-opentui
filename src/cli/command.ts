/**
 * A tiny command framework mirroring the subset of Cobra used by RonDO:
 * subcommands with aliases, persistent flags, positional-argument validators
 * and "was this flag changed?" tracking.
 */

export type FlagType = "string" | "bool" | "int" | "stringSlice";

export interface FlagDef {
  type: FlagType;
  default?: string | boolean | number | string[];
  shorthand?: string;
  usage: string;
}

export class Flags {
  private readonly values = new Map<string, unknown>();
  private readonly changedFlags = new Set<string>();

  constructor(private readonly defs: Map<string, FlagDef>) {
    for (const [name, def] of defs) {
      this.values.set(name, def.default ?? defaultFor(def.type));
    }
  }

  set(name: string, value: unknown): void {
    const def = this.defs.get(name);
    if (def?.type === "stringSlice") {
      const prev = this.changedFlags.has(name)
        ? (this.values.get(name) as string[])
        : [];
      this.values.set(name, [...prev, ...(value as string[])]);
    } else {
      this.values.set(name, value);
    }
    this.changedFlags.add(name);
  }

  changed(name: string): boolean {
    return this.changedFlags.has(name);
  }

  string(name: string): string {
    return (this.values.get(name) as string | undefined) ?? "";
  }

  bool(name: string): boolean {
    return Boolean(this.values.get(name));
  }

  int(name: string): number {
    return (this.values.get(name) as number | undefined) ?? 0;
  }

  stringSlice(name: string): string[] {
    return (this.values.get(name) as string[] | undefined) ?? [];
  }
}

function defaultFor(type: FlagType): unknown {
  switch (type) {
    case "bool":
      return false;
    case "int":
      return 0;
    case "stringSlice":
      return [];
    default:
      return "";
  }
}

export type ArgsValidator = (args: string[], cmd: Command) => void;

export const noArgs: ArgsValidator = (args, cmd) => {
  if (args.length > 0) {
    throw new Error(`unknown command "${args[0]}" for "${cmd.name}"`);
  }
};

export const arbitraryArgs: ArgsValidator = () => {};

export function exactArgs(n: number): ArgsValidator {
  return (args, cmd) => {
    if (args.length !== n) {
      throw new Error(
        `accepts ${n} arg(s), received ${args.length}\n\nUsage: ${cmd.use}`,
      );
    }
  };
}

export function minimumNArgs(n: number): ArgsValidator {
  return (args, cmd) => {
    if (args.length < n) {
      throw new Error(
        `requires at least ${n} arg(s), only received ${args.length}\n\nUsage: ${cmd.use}`,
      );
    }
  };
}

export function maximumNArgs(n: number): ArgsValidator {
  return (args, cmd) => {
    if (args.length > n) {
      throw new Error(
        `accepts at most ${n} arg(s), received ${args.length}\n\nUsage: ${cmd.use}`,
      );
    }
  };
}

export function rangeArgs(min: number, max: number): ArgsValidator {
  return (args, cmd) => {
    if (args.length < min || args.length > max) {
      throw new Error(
        `accepts between ${min} and ${max} arg(s), received ${args.length}\n\nUsage: ${cmd.use}`,
      );
    }
  };
}

export interface CommandOptions {
  use: string;
  short: string;
  long?: string;
  aliases?: string[];
  args?: ArgsValidator;
  flags?: Record<string, FlagDef>;
  /** Flags inherited by every descendant command. */
  persistentFlags?: Record<string, FlagDef>;
  run?: (args: string[], flags: Flags, cmd: Command) => void;
  /** Runs before `run`, on the root command, for global flag handling. */
  persistentPreRun?: (flags: Flags, cmd: Command) => void;
}

export class Command {
  readonly use: string;
  readonly short: string;
  readonly long?: string;
  readonly aliases: string[];
  readonly argsValidator: ArgsValidator;
  readonly flagDefs: Map<string, FlagDef>;
  readonly persistentFlagDefs: Map<string, FlagDef>;
  readonly runFn?: (args: string[], flags: Flags, cmd: Command) => void;
  readonly persistentPreRun?: (flags: Flags, cmd: Command) => void;
  readonly subcommands: Command[] = [];
  parent: Command | null = null;

  constructor(opts: CommandOptions) {
    this.use = opts.use;
    this.short = opts.short;
    this.long = opts.long;
    this.aliases = opts.aliases ?? [];
    this.argsValidator = opts.args ?? arbitraryArgs;
    this.flagDefs = new Map(Object.entries(opts.flags ?? {}));
    this.persistentFlagDefs = new Map(
      Object.entries(opts.persistentFlags ?? {}),
    );
    this.runFn = opts.run;
    this.persistentPreRun = opts.persistentPreRun;
  }

  /** First word of `use`, e.g. "add" for `add "task title" [flags]`. */
  get name(): string {
    return this.use.split(" ")[0]!;
  }

  add(...cmds: Command[]): this {
    for (const cmd of cmds) {
      cmd.parent = this;
      this.subcommands.push(cmd);
    }
    return this;
  }

  find(name: string): Command | undefined {
    return this.subcommands.find(
      (c) => c.name === name || c.aliases.includes(name),
    );
  }

  path(): string {
    return this.parent ? `${this.parent.path()} ${this.name}` : this.name;
  }

  /** All flag definitions visible to this command, including inherited ones. */
  allFlagDefs(): Map<string, FlagDef> {
    const defs = new Map<string, FlagDef>();
    const chain: Command[] = [];
    for (let c: Command | null = this; c; c = c.parent) chain.unshift(c);
    for (const c of chain) {
      for (const [k, v] of c.persistentFlagDefs) defs.set(k, v);
    }
    for (const [k, v] of this.flagDefs) defs.set(k, v);
    return defs;
  }

  helpText(): string {
    const lines: string[] = [];
    if (this.long) lines.push(this.long, "");
    else if (this.short) lines.push(this.short, "");
    lines.push(`Usage:`, `  ${this.path()} ${this.use.split(" ").slice(1).join(" ")}`.trimEnd());
    if (this.subcommands.length > 0) {
      lines.push("", "Available Commands:");
      const width = Math.max(...this.subcommands.map((c) => c.name.length));
      for (const c of this.subcommands) {
        lines.push(`  ${c.name.padEnd(width)}  ${c.short}`);
      }
    }
    const defs = this.allFlagDefs();
    if (defs.size > 0) {
      lines.push("", "Flags:");
      for (const [name, def] of defs) {
        const short = def.shorthand ? `-${def.shorthand}, ` : "    ";
        lines.push(`  ${short}--${name.padEnd(18)} ${def.usage}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }
}

export interface ParsedInvocation {
  cmd: Command;
  args: string[];
  flags: Flags;
}

/** Resolves the target command, then parses its flags and positional args. */
export function parse(root: Command, argv: string[]): ParsedInvocation {
  let cmd = root;
  const rest: string[] = [];
  let i = 0;
  let resolving = true;

  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("-") && arg !== "-") {
      // Flags are parsed after resolution; keep them and skip a value when the
      // flag is known to take one.
      const consumed = collectFlagToken(cmd, argv, i, rest);
      i = consumed;
      continue;
    }
    if (resolving) {
      const sub = cmd.find(arg);
      if (sub) {
        cmd = sub;
        i++;
        continue;
      }
      resolving = false;
    }
    rest.push(arg);
    i++;
  }

  const defs = cmd.allFlagDefs();
  const flags = new Flags(defs);
  const positional = applyFlags(cmd, defs, flags, rest);
  return { cmd, args: positional, flags };
}

/** Keeps flag tokens (and their values) in `out` for the later parse pass. */
function collectFlagToken(
  cmd: Command,
  argv: string[],
  i: number,
  out: string[],
): number {
  const arg = argv[i]!;
  out.push(arg);
  if (arg.includes("=")) return i + 1;

  const defs = cmd.allFlagDefs();
  const name = flagName(arg, defs);
  const def = name ? defs.get(name) : undefined;
  if (def && def.type !== "bool" && i + 1 < argv.length) {
    out.push(argv[i + 1]!);
    return i + 2;
  }
  return i + 1;
}

function flagName(
  token: string,
  defs: Map<string, FlagDef>,
): string | undefined {
  if (token.startsWith("--")) return token.slice(2).split("=")[0];
  const short = token.slice(1).split("=")[0];
  for (const [name, def] of defs) {
    if (def.shorthand === short) return name;
  }
  return undefined;
}

function applyFlags(
  cmd: Command,
  defs: Map<string, FlagDef>,
  flags: Flags,
  tokens: string[],
): string[] {
  const positional: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i]!;
    if (!token.startsWith("-") || token === "-") {
      positional.push(token);
      i++;
      continue;
    }

    const eq = token.indexOf("=");
    const rawName = eq >= 0 ? token.slice(0, eq) : token;
    const name = flagName(rawName, defs);
    if (!name || !defs.has(name)) {
      throw new Error(`unknown flag: ${rawName}`);
    }
    const def = defs.get(name)!;

    if (def.type === "bool") {
      const value = eq >= 0 ? token.slice(eq + 1) : "true";
      flags.set(name, value === "true" || value === "1");
      i++;
      continue;
    }

    let value: string;
    if (eq >= 0) {
      value = token.slice(eq + 1);
      i++;
    } else {
      if (i + 1 >= tokens.length) {
        throw new Error(`flag needs an argument: ${rawName}`);
      }
      value = tokens[i + 1]!;
      i += 2;
    }

    switch (def.type) {
      case "int": {
        const n = Number(value);
        if (!Number.isInteger(n)) {
          throw new Error(`invalid argument "${value}" for "--${name}"`);
        }
        flags.set(name, n);
        break;
      }
      case "stringSlice":
        flags.set(
          name,
          value
            .split(",")
            .map((v) => v.trim())
            .filter((v) => v !== ""),
        );
        break;
      default:
        flags.set(name, value);
    }
  }

  cmd.argsValidator(positional, cmd);
  return positional;
}

/** Parses and runs, throwing on validation or execution errors. */
export function execute(root: Command, argv: string[]): void {
  const { cmd, args, flags } = parse(root, argv);
  if (root.persistentPreRun) root.persistentPreRun(flags, cmd);
  if (!cmd.runFn) {
    throw new Error(
      `no subcommand provided for "${cmd.path()}". Run '${cmd.path()} --help' for usage`,
    );
  }
  cmd.runFn(args, flags, cmd);
}
