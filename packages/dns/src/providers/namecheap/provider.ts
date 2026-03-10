import { AppError } from "@helmsman/shared";
import type { DnsProvider } from "../base-provider.js";
import type { DnsRecord, NamecheapConfig } from "../../types.js";
import { splitDomain } from "../../utils.js";
import { NamecheapClient } from "./client.js";

export class NamecheapDnsProvider implements DnsProvider {
  private readonly client: NamecheapClient;

  public constructor(config: NamecheapConfig) {
    this.client = new NamecheapClient(config);
  }

  public async listRecords(domain: string): Promise<readonly DnsRecord[]> {
    const { sld, tld } = splitDomain(domain);
    const xml = await this.client.call("namecheap.domains.dns.getHosts", {
      SLD: sld,
      TLD: tld,
    });

    return this.client.parseHosts(xml);
  }

  public async getRecord(domain: string, recordId: string): Promise<DnsRecord> {
    const records = await this.listRecords(domain);
    const record = records.find((item) => item.id === recordId);

    if (!record) {
      throw new AppError("DNS_RECORD_NOT_FOUND", "DNS record was not found.", {
        domain,
        recordId,
      });
    }

    return record;
  }

  public async createRecord(
    domain: string,
    record: Omit<DnsRecord, "id">,
  ): Promise<DnsRecord> {
    const existing = await this.listRecords(domain);
    const updated = [...existing, record];

    await this.setHosts(domain, updated);
    const next = await this.listRecords(domain);
    const created = next[next.length - 1];

    if (!created) {
      throw new AppError(
        "DNS_RECORD_CREATE_FAILED",
        "Record creation could not be verified after provider update.",
        { domain, host: record.host, type: record.type },
      );
    }

    return created;
  }

  public async updateRecord(
    domain: string,
    recordId: string,
    patch: Partial<Omit<DnsRecord, "id">>,
  ): Promise<DnsRecord> {
    const existing = await this.listRecords(domain);
    const index = existing.findIndex((item) => item.id === recordId);

    if (index < 0) {
      throw new AppError("DNS_RECORD_NOT_FOUND", "DNS record was not found.", {
        domain,
        recordId,
      });
    }

    const current = existing[index] as DnsRecord;
    const nextRecord: DnsRecord = {
      ...current,
      ...patch,
      id: current.id,
      type: (patch.type ?? current.type).toUpperCase() as DnsRecord["type"],
    };

    const updated = [...existing];
    updated[index] = nextRecord;

    await this.setHosts(domain, updated);

    const persisted = await this.getRecord(domain, recordId);
    return persisted;
  }

  public async deleteRecord(domain: string, recordId: string): Promise<void> {
    const existing = await this.listRecords(domain);
    const index = existing.findIndex((item) => item.id === recordId);

    if (index < 0) {
      throw new AppError("DNS_RECORD_NOT_FOUND", "DNS record was not found.", {
        domain,
        recordId,
      });
    }

    const updated = existing.filter((item) => item.id !== recordId);
    await this.setHosts(domain, updated);
  }

  public async checkDomainAvailability(domain: string) {
    const xml = await this.client.call("namecheap.domains.check", {
      DomainList: domain,
    });

    return this.client.parseDomainAvailability(xml, domain);
  }

  public async getDomainPricing(tld: string) {
    const normalizedTld = tld.startsWith(".") ? tld.slice(1) : tld;

    const xml = await this.client.call("namecheap.users.getPricing", {
      ProductType: "DOMAIN",
      ProductCategory: "register",
      ActionName: "register",
      ProductName: normalizedTld,
    });

    return this.client.parseDomainPricing(xml, normalizedTld);
  }

  private async setHosts(
    domain: string,
    records: readonly DnsRecord[],
  ): Promise<void> {
    const { sld, tld } = splitDomain(domain);
    const params = this.client.buildSetHostsParams(sld, tld, records);
    await this.client.call("namecheap.domains.dns.setHosts", params);
  }
}
