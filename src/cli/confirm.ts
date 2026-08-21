import { theme } from "../core/ui/colors.ts";
import { fg } from "../core/ui/ansi.ts";
import type { CLIContext } from "./context.ts";

/**
 * Asks for confirmation on stderr and reads the answer from stdin.
 * Returns true immediately when `force` is set; errors when stdin is not a TTY.
 */
export function confirm(
  ctx: CLIContext,
  prompt: string,
  force: boolean,
): boolean {
  if (force) return true;
  if (!process.stdin.isTTY) {
    throw new Error("stdin is not a TTY: use --force to skip confirmation");
  }

  const styled = ctx.stderr.isTTY
    ? `${fg(theme.yellow, "?")} ${prompt} ${fg(theme.gray, "[y/N]")}`
    : `${prompt} [y/N]`;
  ctx.stderr.write(`${styled}: `);

  const answer = readLineSync().trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

function readLineSync(): string {
  const buf = Buffer.alloc(1024);
  try {
    const bytes = require("node:fs").readSync(0, buf, 0, buf.length, null);
    return buf.toString("utf8", 0, bytes);
  } catch {
    return "";
  }
}
