import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, chmodSync } from "node:fs";

export interface Credentials {
  username: string;
  password: string;
}

const dir = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "gidinet");
const file = join(dir, "config.json");

export function configPath(): string {
  return file;
}

function readFile(): Partial<Credentials> {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function saveCredentials(creds: Credentials): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

export function clearCredentials(): boolean {
  if (existsSync(file)) {
    rmSync(file);
    return true;
  }
  return false;
}

/**
 * Resolve credentials from (highest priority first): explicit flags, the
 * environment, then the saved config file.
 */
export function resolveCredentials(flags: { username?: string; password?: string }): Credentials | null {
  const stored = readFile();
  const username = flags.username || process.env.GIDINET_USERNAME || stored.username;
  const password = flags.password || process.env.GIDINET_PASSWORD || stored.password;
  if (!username || !password) return null;
  return { username, password };
}
