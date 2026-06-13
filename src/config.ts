import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";

export interface Credentials {
  username: string;
  password: string;
}

export interface ResolvedCredentials extends Credentials {
  /** Where the credentials came from: an account name, "env", or "flags". */
  source: string;
}

interface Config {
  current: string;
  accounts: Record<string, Credentials>;
}

const dir = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "gidinet");
const file = join(dir, "config.json");

export function configPath(): string {
  return file;
}

/** Read config, normalising the legacy flat `{username,password}` form. */
function readConfig(): Config {
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { current: "default", accounts: {} };
  }
  // Legacy single-account file: { username, password }
  if (raw && typeof raw.username === "string" && !raw.accounts) {
    return { current: "default", accounts: { default: { username: raw.username, password: raw.password } } };
  }
  return {
    current: typeof raw?.current === "string" ? raw.current : "default",
    accounts: raw?.accounts && typeof raw.accounts === "object" ? raw.accounts : {},
  };
}

function writeConfig(config: Config): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
}

export interface AccountInfo {
  name: string;
  username: string;
  current: boolean;
}

export function listAccounts(): AccountInfo[] {
  const config = readConfig();
  return Object.entries(config.accounts).map(([name, creds]) => ({
    name,
    username: creds.username,
    current: name === config.current,
  }));
}

export function currentAccountName(): string {
  return readConfig().current;
}

/** Save (or overwrite) an account. Becomes current if it's the first one. */
export function saveAccount(name: string, creds: Credentials, makeCurrent = false): string {
  const config = readConfig();
  const first = Object.keys(config.accounts).length === 0;
  config.accounts[name] = creds;
  if (first || makeCurrent) config.current = name;
  writeConfig(config);
  return file;
}

/** Remove an account. Returns false if it didn't exist. */
export function removeAccount(name: string): boolean {
  const config = readConfig();
  if (!config.accounts[name]) return false;
  delete config.accounts[name];
  if (config.current === name) {
    config.current = Object.keys(config.accounts)[0] ?? "default";
  }
  writeConfig(config);
  return true;
}

export function setCurrentAccount(name: string): boolean {
  const config = readConfig();
  if (!config.accounts[name]) return false;
  config.current = name;
  writeConfig(config);
  return true;
}

/**
 * Resolve credentials. Precedence:
 *  - an explicitly requested `--account` (flags still fill individual fields);
 *  - otherwise flags, then `GIDINET_*` env vars, then the current account.
 *
 * Returns a string error message if a named account is missing.
 */
export function resolveCredentials(
  flags: { username?: string; password?: string },
  accountName?: string,
): ResolvedCredentials | string | null {
  const config = readConfig();

  if (accountName) {
    const acc = config.accounts[accountName];
    if (!acc) return `Account "${accountName}" not found. See \`gidinet accounts\`.`;
    const username = flags.username || acc.username;
    const password = flags.password || acc.password;
    if (!username || !password) return null;
    return { username, password, source: accountName };
  }

  const current = config.accounts[config.current];
  const username = flags.username || process.env.GIDINET_USERNAME || current?.username;
  const password = flags.password || process.env.GIDINET_PASSWORD || current?.password;
  if (!username || !password) return null;

  const source = flags.username
    ? "flags"
    : process.env.GIDINET_USERNAME
      ? "env"
      : config.current;
  return { username, password, source };
}
