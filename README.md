# gidinet

A modern, simple CLI for [GiDiNet](https://www.gidinet.com/) / QuickServiceBox
reseller accounts. Manage your domains, DNS records, contacts and renewals
straight from the terminal.

```
$ gidinet expiring --days 30
SERVICE            TYPE    ENDS        LEFT  RENEWAL    AUTO
onlyinitaly.it     domain  2026-05-27  -16d  12.20 EUR  no
beyondthelines.it  domain  2026-06-15    3d   6.70 EUR  no
mattiatrapani.com  domain  2026-07-02   19d  13.20 EUR  yes
```

## Install

```bash
npm install -g @16bit/gidinet
```

Or run it without installing:

```bash
npx @16bit/gidinet domains
```

Requires Node.js 20 or newer.

## Authentication

The CLI talks to the QuickServiceBox reseller API and needs your reseller
**username** and **password**. Credentials are resolved in this order:

1. `-u/--username` and `-p/--password` flags
2. `GIDINET_USERNAME` / `GIDINET_PASSWORD` environment variables
3. The saved config file (`gidinet login`)

The quickest way to get going:

```bash
gidinet login          # prompts for username + password, verifies, saves them
```

Credentials are stored at `~/.config/gidinet/config.json` with `0600`
permissions. Remove them with `gidinet logout`.

### Multiple accounts

If you manage more than one reseller account, save each under a name and switch
between them:

```bash
gidinet login --name personal     # saves and selects "personal"
gidinet login --name work         # saves and selects "work"

gidinet accounts                  # list them (● marks the current one)
gidinet accounts use personal     # switch the default account
gidinet accounts rm work          # forget one

gidinet -a work domains           # run a single command against "work"
```

`-a/--account` picks a saved account for one command without changing the
current one.

## Commands

| Command | Description |
| --- | --- |
| `gidinet login` | Save and verify reseller credentials |
| `gidinet logout` | Remove saved credentials |
| `gidinet whoami` | Show the active account and credential source |
| `gidinet check <domains...>` | Check domain availability (read-only, no charge) |
| `gidinet domains` | List the domains on the account |
| `gidinet domain <domain>` | Show full detail for one domain (status, dates, contacts) |
| `gidinet expiring` | List services approaching expiry, soonest first |
| `gidinet contacts` | List the contacts (anagrafiche) on the account |
| `gidinet accounts` | List, switch (`use`) and remove (`rm`) saved accounts |
| `gidinet ns <domain> <ns...>` | Replace a domain's authoritative nameservers |
| `gidinet dns list <domain>` | List DNS records |
| `gidinet dns add <domain> <type> <host> <data>` | Add a DNS record |
| `gidinet dns delete <domain> <type> <host> <data>` | Delete a DNS record |

Add `--json` to any command for machine-readable output, ideal for scripting:

```bash
gidinet --json expiring | jq '.[] | select(.daysLeft < 14) | .key'
```

### Examples

```bash
# Is a domain free?
gidinet check mycoolstartup.com mycoolstartup.it

# All domains using GiDiNet's own nameservers
gidinet domains --gidinet-dns

# Every domain, across all pages, filtered by name
gidinet domains --all --filter waste

# DNS records for a zone
gidinet dns list example.com

# Point www at an IP
gidinet dns add example.com A www 203.0.113.10 --ttl 3600

# A mail record with priority
gidinet dns add example.com MX @ mail.example.com --priority 10

# Delete a record (asks for confirmation, or pass -y)
gidinet dns delete example.com A www 203.0.113.10 -y

# Move a domain onto GiDiNet nameservers
gidinet ns example.com dnsl1.gidinet.com dnsl2.gidinet.com
```

Destructive operations (`dns add/delete`, `ns`) ask for confirmation when run
interactively and refuse to run non-interactively unless you pass `-y/--yes`.

## How it works

GiDiNet exposes a SOAP API (CoreAPI + DNSAPI). This CLI builds the SOAP
envelopes directly over `fetch` — no WSDL round-trip per call — so it starts
fast and ships with a tiny dependency footprint.

## License

MIT © 16bit Srl
