#!/usr/bin/env node
import { Command, Option } from "commander";
import pc from "picocolors";
import { GidinetClient, DNS_RECORD_TYPES, type DnsRecord } from "./client.js";
import { GidinetError } from "./soap.js";
import { resolveCredentials, saveCredentials, clearCredentials, configPath } from "./config.js";
import { prompt, promptHidden, confirm, isInteractive } from "./prompt.js";
import {
  table,
  print,
  json,
  ok,
  warn,
  fail,
  dim,
  errorOut,
  colourDays,
  shortDate,
  type Column,
} from "./format.js";

const program = new Command();

program
  .name("gidinet")
  .description("Modern CLI for GiDiNet / QuickServiceBox — domains, DNS, contacts and renewals.")
  .version("0.1.0")
  .option("--json", "output raw JSON instead of tables")
  .option("-u, --username <username>", "reseller account username (overrides env/config)")
  .option("-p, --password <password>", "reseller account password (overrides env/config)")
  .option("--no-color", "disable coloured output");

interface GlobalOpts {
  json?: boolean;
  username?: string;
  password?: string;
  color?: boolean;
}

/** Build an authenticated client or exit with a helpful message. */
function client(cmd: Command): GidinetClient {
  const opts = cmd.optsWithGlobals() as GlobalOpts;
  if (opts.color === false) (pc as any).isColorSupported = false;
  const creds = resolveCredentials(opts);
  if (!creds) {
    errorOut("No credentials found. Run `gidinet login`, set GIDINET_USERNAME / GIDINET_PASSWORD, or pass -u/-p.");
    process.exit(1);
  }
  return new GidinetClient(creds);
}

function wantsJson(cmd: Command): boolean {
  return (cmd.optsWithGlobals() as GlobalOpts).json === true;
}

/** Run an action, turning API/network errors into clean stderr output. */
function run(action: (...args: any[]) => Promise<void>) {
  return async (...args: any[]) => {
    try {
      await action(...args);
    } catch (e) {
      if (e instanceof GidinetError) {
        const detail = e.resultCode >= 0 ? dim(` (code ${e.resultCode}/${e.resultSubCode})`) : "";
        errorOut(e.message + detail);
      } else {
        errorOut((e as Error).message);
      }
      process.exit(1);
    }
  };
}

// ---- auth -----------------------------------------------------------------

program
  .command("login")
  .description("save reseller credentials to the local config file")
  .action(
    run(async (_o: unknown, cmd: Command) => {
      const opts = cmd.optsWithGlobals() as GlobalOpts;
      const username = opts.username || (await prompt("Username: "));
      const password = opts.password || (await promptHidden("Password: "));
      if (!username || !password) {
        errorOut("Username and password are required.");
        process.exit(1);
      }
      process.stdout.write(dim("Verifying… "));
      await new GidinetClient({ username, password }).contacts();
      process.stdout.write(pc.green("ok\n"));
      const path = saveCredentials({ username, password });
      print(ok(`Credentials saved to ${dim(path)}`));
    }),
  );

program
  .command("logout")
  .description("remove the saved credentials")
  .action(
    run(async () => {
      print(clearCredentials() ? ok("Credentials removed.") : warn("No saved credentials."));
    }),
  );

program
  .command("whoami")
  .description("show the active account and where credentials come from")
  .action(
    run(async (_o: unknown, cmd: Command) => {
      const opts = cmd.optsWithGlobals() as GlobalOpts;
      const creds = resolveCredentials(opts);
      if (!creds) {
        errorOut("Not logged in.");
        process.exit(1);
      }
      const source = opts.username
        ? "flag"
        : process.env.GIDINET_USERNAME
          ? "environment"
          : "config file";
      if (wantsJson(cmd)) return json({ username: creds.username, source, configPath: configPath() });
      print(`${pc.bold(creds.username)} ${dim(`(via ${source})`)}`);
      print(dim(`config: ${configPath()}`));
    }),
  );

// ---- check ----------------------------------------------------------------

program
  .command("check")
  .argument("<domains...>", "one or more domains to check, e.g. example.com example.it")
  .description("check domain availability (read-only, no charge)")
  .action(
    run(async (domains: string[], _o: unknown, cmd: Command) => {
      const results = await client(cmd).check(domains);
      if (wantsJson(cmd)) return json(results);
      for (const r of results) {
        print(r.available ? `${ok(pc.bold(r.domain))} ${dim("available")}` : `${fail(pc.bold(r.domain))} ${dim("taken")}`);
      }
    }),
  );

// ---- domains --------------------------------------------------------------

program
  .command("domains")
  .description("list the domains on the account")
  .option("-f, --filter <text>", "filter by domain name")
  .option("--page <n>", "page number (when not using --all)", "1")
  .option("--size <n>", "page size", "100")
  .option("--all", "fetch every page")
  .option("--gidinet-dns", "only domains using GiDiNet nameservers")
  .action(
    run(async (o: any, cmd: Command) => {
      const gd = client(cmd);
      let items;
      let meta = "";
      if (o.all) {
        items = await gd.allDomains(o.filter ?? "");
      } else {
        const res = await gd.domains(Number(o.page), Number(o.size), o.filter ?? "");
        items = res.items;
        meta = dim(`page ${res.page}/${res.totalPages} · ${res.total} total`);
      }
      if (o.gidinetDns) items = items.filter((d) => d.usesGidinetDns);
      if (wantsJson(cmd)) return json(items);
      if (items.length === 0) return print(dim("No domains."));

      const columns: Column<(typeof items)[number]>[] = [
        { header: "DOMAIN", get: (d) => pc.bold(d.fqdn) },
        { header: "EXPIRES", get: (d) => shortDate(d.expiresAt) },
        { header: "GROUP", get: (d) => d.group || dim("—") },
        { header: "DNS", get: (d) => (d.usesGidinetDns ? pc.green("gidinet") : dim("external")) },
        { header: "NAMESERVERS", get: (d) => d.nameservers.join(", ") || dim("—") },
      ];
      print(table(items, columns));
      if (meta) print("\n" + meta);
    }),
  );

// ---- expiring -------------------------------------------------------------

program
  .command("expiring")
  .description("list services approaching expiry, soonest first")
  .option("--days <n>", "only services expiring within N days")
  .action(
    run(async (o: any, cmd: Command) => {
      let services = await client(cmd).expiring();
      if (o.days !== undefined) {
        const limit = Number(o.days);
        services = services.filter((s) => s.daysLeft !== null && s.daysLeft <= limit);
      }
      if (wantsJson(cmd)) return json(services);
      if (services.length === 0) return print(dim("Nothing expiring."));

      const columns: Column<(typeof services)[number]>[] = [
        { header: "SERVICE", get: (s) => pc.bold(s.key) },
        { header: "TYPE", get: (s) => s.productKey || dim("—") },
        { header: "ENDS", get: (s) => shortDate(s.endsAt) },
        { header: "LEFT", get: (s) => colourDays(s.daysLeft), align: "right" },
        { header: "RENEWAL", get: (s) => (s.renewalCost ? `${s.renewalCost.toFixed(2)} ${s.currency}` : dim("—")), align: "right" },
        { header: "AUTO", get: (s) => (s.autoRenew ? pc.green("yes") : dim("no")) },
      ];
      print(table(services, columns));
    }),
  );

// ---- contacts -------------------------------------------------------------

program
  .command("contacts")
  .description("list the contacts (anagrafiche) on the account")
  .action(
    run(async (_o: unknown, cmd: Command) => {
      const contacts = await client(cmd).contacts();
      if (wantsJson(cmd)) return json(contacts);
      if (contacts.length === 0) return print(dim("No contacts."));
      const columns: Column<(typeof contacts)[number]>[] = [
        { header: "ID", get: (c) => String(c.id), align: "right" },
        { header: "NAME", get: (c) => pc.bold(c.displayName) },
        { header: "TYPE", get: (c) => (c.isPerson ? "person" : "org") },
        { header: "VAT/CF", get: (c) => c.vatNumber || c.fiscalCode || dim("—") },
        { header: "EMAIL", get: (c) => c.email || dim("—") },
      ];
      print(table(contacts, columns));
    }),
  );

// ---- nameservers ----------------------------------------------------------

program
  .command("ns")
  .argument("<domain>", "the domain, e.g. example.com")
  .argument("<nameservers...>", "the new authoritative nameservers")
  .option("-y, --yes", "skip the confirmation prompt")
  .description("replace the authoritative nameservers for a domain")
  .action(
    run(async (domain: string, nameservers: string[], o: any, cmd: Command) => {
      const gd = client(cmd);
      if (!o.yes) {
        print(`${warn("About to set nameservers for")} ${pc.bold(domain)}:`);
        for (const ns of nameservers) print(`  ${ns}`);
        if (!isInteractive()) {
          errorOut("Refusing to change nameservers non-interactively without --yes.");
          process.exit(1);
        }
        if (!(await confirm("Proceed?"))) return print(dim("Aborted."));
      }
      await gd.changeNameservers(domain, nameservers);
      print(ok(`Nameservers updated for ${pc.bold(domain)}.`));
    }),
  );

// ---- dns ------------------------------------------------------------------

const dns = program.command("dns").description("manage DNS records");

dns
  .command("list")
  .alias("ls")
  .argument("<domain>", "the domain, e.g. example.com")
  .description("list DNS records for a domain")
  .action(
    run(async (domain: string, _o: unknown, cmd: Command) => {
      const records = await client(cmd).dnsList(domain);
      if (wantsJson(cmd)) return json(records);
      if (records.length === 0) return print(dim("No records."));
      const columns: Column<DnsRecord>[] = [
        { header: "HOST", get: (r) => pc.bold(r.host) },
        { header: "TYPE", get: (r) => pc.cyan(r.type) },
        { header: "DATA", get: (r) => r.data },
        { header: "TTL", get: (r) => String(r.ttl), align: "right" },
        { header: "PRIO", get: (r) => (r.type === "MX" || r.type === "SRV" ? String(r.priority) : dim("—")), align: "right" },
      ];
      print(table(records, columns));
    }),
  );

function recordFromArgs(domain: string, type: string, host: string, data: string, o: { ttl: string; priority: string }, gd: GidinetClient) {
  const upper = type.toUpperCase();
  if (!DNS_RECORD_TYPES.includes(upper as any)) {
    errorOut(`Unsupported record type "${type}". Allowed: ${DNS_RECORD_TYPES.join(", ")}`);
    process.exit(1);
  }
  return {
    domain,
    hostName: gd.hostName(host, domain),
    type: upper,
    data,
    ttl: Number(o.ttl),
    priority: Number(o.priority),
  };
}

dns
  .command("add")
  .argument("<domain>", "the domain, e.g. example.com")
  .argument("<type>", `record type (${DNS_RECORD_TYPES.join(", ")})`)
  .argument("<host>", 'host relative to the domain ("@" for the apex, "www", …)')
  .argument("<data>", "record value (IP, hostname, text, …)")
  .option("--ttl <seconds>", "time to live", "3600")
  .option("--priority <n>", "priority (MX/SRV)", "0")
  .description("add a DNS record")
  .action(
    run(async (domain: string, type: string, host: string, data: string, o: any, cmd: Command) => {
      const gd = client(cmd);
      const record = recordFromArgs(domain, type, host, data, o, gd);
      await gd.dnsAdd(record);
      print(ok(`Added ${pc.cyan(record.type)} ${pc.bold(host)} → ${data}`));
    }),
  );

dns
  .command("delete")
  .alias("rm")
  .argument("<domain>", "the domain, e.g. example.com")
  .argument("<type>", `record type (${DNS_RECORD_TYPES.join(", ")})`)
  .argument("<host>", 'host relative to the domain ("@" for the apex)')
  .argument("<data>", "record value to match")
  .option("--ttl <seconds>", "time to live of the record to match", "3600")
  .option("--priority <n>", "priority of the record to match", "0")
  .option("-y, --yes", "skip the confirmation prompt")
  .description("delete a DNS record")
  .action(
    run(async (domain: string, type: string, host: string, data: string, o: any, cmd: Command) => {
      const gd = client(cmd);
      const record = recordFromArgs(domain, type, host, data, o, gd);
      if (!o.yes) {
        print(`${warn("About to delete")} ${pc.cyan(record.type)} ${pc.bold(host)} → ${data} ${dim(`(${domain})`)}`);
        if (!isInteractive()) {
          errorOut("Refusing to delete non-interactively without --yes.");
          process.exit(1);
        }
        if (!(await confirm("Proceed?"))) return print(dim("Aborted."));
      }
      await gd.dnsDelete(record);
      print(ok(`Deleted ${pc.cyan(record.type)} ${pc.bold(host)}`));
    }),
  );

program.parseAsync(process.argv);
