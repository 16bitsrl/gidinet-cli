import pc from "picocolors";

/** Strip ANSI codes so width math counts visible characters only. */
function visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export interface Column<T> {
  header: string;
  get: (row: T) => string;
  align?: "left" | "right";
}

/** Render a compact, aligned table. Returns "" for an empty row set. */
export function table<T>(rows: T[], columns: Column<T>[]): string {
  if (rows.length === 0) return "";
  const cells = rows.map((r) => columns.map((c) => c.get(r) ?? ""));
  const widths = columns.map((c, i) =>
    Math.max(visibleLength(c.header), ...cells.map((row) => visibleLength(row[i] ?? ""))),
  );

  const pad = (text: string, width: number, align?: "left" | "right") => {
    const gap = width - visibleLength(text);
    if (gap <= 0) return text;
    return align === "right" ? " ".repeat(gap) + text : text + " ".repeat(gap);
  };

  const header = columns.map((c, i) => pc.bold(pc.cyan(pad(c.header, widths[i]!, c.align)))).join("  ");
  const body = cells.map((row) => row.map((cell, i) => pad(cell, widths[i]!, columns[i]!.align)).join("  ")).join("\n");
  return `${header}\n${body}`;
}

export function print(s: string): void {
  process.stdout.write(s + "\n");
}

export function json(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

export const ok = (msg: string) => pc.green("✓ ") + msg;
export const warn = (msg: string) => pc.yellow("! ") + msg;
export const fail = (msg: string) => pc.red("✗ ") + msg;
export const dim = (s: string) => pc.dim(s);

export function errorOut(message: string): void {
  process.stderr.write(fail(message) + "\n");
}

/** Colour the days-left figure: red ≤14, yellow ≤45, green otherwise. */
export function colourDays(days: number | null): string {
  if (days === null) return dim("—");
  const label = days < 0 ? `${days}d (expired)` : `${days}d`;
  if (days <= 14) return pc.red(label);
  if (days <= 45) return pc.yellow(label);
  return pc.green(label);
}

export function shortDate(iso: string | null): string {
  if (!iso) return dim("—");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
