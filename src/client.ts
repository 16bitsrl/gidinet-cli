import { soapCall, listOf, type SoapEndpoint, type CallOptions } from "./soap.js";

const CORE: SoapEndpoint = {
  url: "https://api.quickservicebox.com/API/Beta/CoreAPI.asmx",
  namespace: "http://api.quickservicebox.com/API/Beta/CoreAPI",
};
const DNS: SoapEndpoint = {
  url: "https://api.quickservicebox.com/API/Beta/DNSAPI.asmx",
  namespace: "https://api.quickservicebox.com/DNS/DNSAPI",
};

export const DNS_RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];

export interface DomainSummary {
  id: number;
  name: string;
  extension: string;
  fqdn: string;
  expiresAt: string | null;
  deletesAt: string | null;
  group: string;
  nameservers: string[];
  statusCode: number;
  usesGidinetDns: boolean;
}

export interface DomainCheckResult {
  domain: string;
  available: boolean;
  code: number;
}

export interface DnsRecord {
  domain: string;
  hostName: string;
  host: string;
  type: string;
  data: string;
  ttl: number;
  priority: number;
  readOnly: boolean;
  suspended: boolean;
}

export interface Contact {
  id: number;
  isPerson: boolean;
  name: string;
  orgName: string;
  vatNumber: string;
  fiscalCode: string;
  email: string;
  displayName: string;
}

export interface ExpiringService {
  serviceId: number;
  key: string;
  productKey: string;
  group: string;
  endsAt: string | null;
  deletesAt: string | null;
  daysLeft: number | null;
  renewalCost: number;
  currency: string;
  autoRenew: boolean;
}

const str = (v: unknown, fallback = ""): string => (v === undefined || v === null ? fallback : String(v));
const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: unknown): boolean => v === true || v === "true" || v === "1" || v === 1;

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (Number.isNaN(end)) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Math.round((end - start.getTime()) / 86_400_000);
}

export class GidinetClient {
  constructor(private readonly auth: CallOptions) {}

  private core(method: string, params: Record<string, any> = {}) {
    return soapCall(CORE, method, params, this.auth);
  }
  private dns(method: string, params: Record<string, any> = {}) {
    return soapCall(DNS, method, params, this.auth);
  }

  /** Check availability for one or more domains (read-only, no charge). */
  async check(domains: string[]): Promise<DomainCheckResult[]> {
    const clean = domains.map((d) => d.trim()).filter(Boolean);
    if (clean.length === 0) return [];
    const result = await this.core("domainCheck", {
      domainList: { string: clean },
      opType: 0,
      opFlags: 0,
    });
    return listOf(result.resultItems?.DomainCheckResultItem).map((item: any) => ({
      domain: str(item.domain),
      available: bool(item.opAllowed),
      code: num(item.additionalDetails),
    }));
  }

  /** Paginated domain list for the reseller account. */
  async domains(page = 1, pageSize = 100, filter = ""): Promise<{ items: DomainSummary[]; total: number; totalPages: number; page: number }> {
    const result = await this.core("domainGetList", {
      orderFieldId: 0,
      orderMode: 0,
      pageSize,
      pageNumber: Math.max(1, page),
      groupFilter: 0,
      domainFilter: filter,
      registrantContactID: 0,
      techContactID: 0,
    });
    const items = listOf(result.resultItems?.DomainListItem).map((item: any): DomainSummary => {
      const nameservers = str(item.nameservers).split(";").map((s) => s.trim()).filter(Boolean);
      const name = str(item.domainName);
      const extension = str(item.domainExtension);
      return {
        id: num(item.domainId),
        name,
        extension,
        fqdn: `${name}.${extension}`,
        expiresAt: item.expireDate ? str(item.expireDate) : null,
        deletesAt: item.deletionDate ? str(item.deletionDate) : null,
        group: str(item.groupName),
        nameservers,
        statusCode: num(item.statusCode),
        usesGidinetDns: nameservers.some((ns) => ns.includes("gidinet.com")),
      };
    });
    return {
      items,
      total: num(result.totalDomains, items.length),
      totalPages: num(result.totalPages, 1),
      page: num(result.currentPageNumber, page),
    };
  }

  /** Walk every page of the domain list. */
  async allDomains(filter = ""): Promise<DomainSummary[]> {
    const first = await this.domains(1, 200, filter);
    const all = [...first.items];
    for (let p = 2; p <= first.totalPages; p++) {
      const next = await this.domains(p, 200, filter);
      all.push(...next.items);
    }
    return all;
  }

  /** Raw master data for a single domain. */
  async domainInfo(fqdn: string): Promise<any> {
    return this.core("domainInfo", { domain: fqdn });
  }

  /** Replace the authoritative nameservers for a domain. */
  async changeNameservers(fqdn: string, nameservers: string[]): Promise<void> {
    const clean = nameservers.map((n) => n.trim()).filter(Boolean);
    // The API expects a comma-separated list (note: domainGetList returns
    // nameservers semicolon-separated — the two directions differ).
    await this.core("domainNameServersChange", {
      domain: fqdn,
      nameservers: clean.join(","),
    });
  }

  /** Contacts (anagrafiche) on the account. */
  async contacts(): Promise<Contact[]> {
    const result = await this.core("contactGetList");
    return listOf(result.resultItems?.ContactListItem).map((item: any): Contact => {
      const orgName = str(item.orgName);
      const isPerson = orgName === "" || orgName === "N/A";
      const name = str(item.registrantAdminFullName);
      return {
        id: num(item.contactId),
        isPerson,
        name,
        orgName: isPerson ? "" : orgName,
        vatNumber: str(item.orgVATNumber),
        fiscalCode: str(item.registrantFiscalOrIdCode),
        email: str(item.eMail),
        displayName: isPerson ? name : orgName || name,
      };
    });
  }

  /** Services (domains) approaching expiry, soonest first. */
  async expiring(): Promise<ExpiringService[]> {
    const result = await this.core("listExpiringServices", { additionalParameters: { string: [] } });
    const services = listOf(result.resultItems?.ExpiringServiceEntry).map((item: any): ExpiringService => {
      const params: Record<string, string> = {};
      for (const pair of listOf(item.serviceParams?.string)) {
        const [k, v = ""] = String(pair).split("=");
        if (k) params[k] = v;
      }
      const endsAt = item.serviceEndDateUtc ? str(item.serviceEndDateUtc) : null;
      return {
        serviceId: num(item.serviceId),
        key: str(item.serviceKey),
        productKey: str(item.productKey),
        group: str(item.customerCustomLabel),
        endsAt,
        deletesAt: item.serviceDeletionDateUtc ? str(item.serviceDeletionDateUtc) : null,
        daysLeft: daysUntil(endsAt),
        renewalCost: num(item.renewalCost),
        currency: str(item.renewalCostCurrency, "EUR"),
        autoRenew: params.autoRenew === "1",
      };
    });
    services.sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));
    return services;
  }

  // ---- DNS ---------------------------------------------------------------

  async dnsList(fqdn: string): Promise<DnsRecord[]> {
    const result = await this.dns("recordGetList", { domainName: fqdn });
    return listOf(result.resultItems?.DNSRecordListItem).map((item: any): DnsRecord => {
      const domain = str(item.DomainName);
      const hostName = str(item.HostName);
      let host = "@";
      if (hostName && hostName !== domain) {
        host = hostName.replace(new RegExp(`\\.?${domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "") || "@";
      }
      return {
        domain,
        hostName,
        host,
        type: str(item.RecordType),
        data: str(item.Data),
        ttl: num(item.TTL, 3600),
        priority: num(item.Priority),
        readOnly: bool(item.ReadOnly),
        suspended: bool(item.Suspended),
      };
    });
  }

  /** Turn a relative host ("@", "www") into the absolute name the API wants. */
  hostName(host: string, fqdn: string): string {
    const h = host.trim();
    if (h === "" || h === "@") return fqdn;
    return h.endsWith(fqdn) ? h : `${h}.${fqdn}`;
  }

  private recordPayload(r: { domain: string; hostName: string; type: string; data: string; ttl: number; priority: number }) {
    return {
      DomainName: r.domain,
      HostName: r.hostName,
      RecordType: r.type,
      Data: r.data,
      TTL: r.ttl,
      Priority: r.priority,
    };
  }

  async dnsAdd(record: { domain: string; hostName: string; type: string; data: string; ttl: number; priority: number }): Promise<void> {
    await this.dns("recordAdd", { record: this.recordPayload(record) });
  }

  async dnsDelete(record: { domain: string; hostName: string; type: string; data: string; ttl: number; priority: number }): Promise<void> {
    await this.dns("recordDelete", { record: this.recordPayload(record) });
  }

  async dnsUpdate(
    oldRecord: { domain: string; hostName: string; type: string; data: string; ttl: number; priority: number },
    newRecord: { domain: string; hostName: string; type: string; data: string; ttl: number; priority: number },
  ): Promise<void> {
    await this.dns("recordUpdate", {
      oldRecord: this.recordPayload(oldRecord),
      newRecord: this.recordPayload(newRecord),
    });
  }
}
