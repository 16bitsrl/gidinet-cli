import { createInterface } from "node:readline";
import pc from "picocolors";

export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

/** Read a line without echoing it (for passwords). */
export function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw ?? false;
    stdin.setRawMode?.(true);
    stdin.resume();
    let value = "";
    const onData = (chunk: Buffer) => {
      const code = chunk[0];
      if (chunk.includes(0x0d) || chunk.includes(0x0a) || code === 0x04) {
        // Enter / EOT
        stdin.setRawMode?.(wasRaw);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(value);
      } else if (code === 0x03) {
        // Ctrl-C
        process.stdout.write("\n");
        process.exit(130);
      } else if (code === 0x7f || code === 0x08) {
        // Backspace / DEL
        value = value.slice(0, -1);
      } else {
        value += chunk.toString("utf8");
      }
    };
    stdin.on("data", onData);
  });
}

export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? pc.dim(" [Y/n] ") : pc.dim(" [y/N] ");
  const answer = (await prompt(question + hint)).toLowerCase();
  if (answer === "") return defaultYes;
  return answer === "y" || answer === "yes";
}
