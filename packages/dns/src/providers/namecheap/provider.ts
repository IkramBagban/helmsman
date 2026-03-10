import type { DnsProvider } from "../base-provider.js";
import type { DnsRecord, NamecheapConfig } from "../../types.js";
import { splitDomain } from "../../utils.js";
import { NamecheapClient } from "./client.js";

const equalsIgnoreCase = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

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

  public async createRecord(domain: string, record: DnsRecord): Promise<readonly DnsRecord[]> {
    const existing = await this.listRecords(domain);
    const updated = [...existing, record];
    await this.setHosts(domain, updated);
    return updated;
  }

  public async updateRecord(domain: string, record: DnsRecord): Promise<readonly DnsRecord[]> {
    const existing = await this.listRecords(domain);
    const updated = existing.map((item) => {
      if (equalsIgnoreCase(item.host, record.host) && equalsIgnoreCase(item.type, record.type)) {
        return record;
      }
      return item;
    });

    await this.setHosts(domain, updated);
    return updated;
  }

  public async deleteRecord(domain: string, target: Pick<DnsRecord, "host" | "type">): Promise<readonly DnsRecord[]> {
    const existing = await this.listRecords(domain);
    const updated = existing.filter(
      (item) => !(equalsIgnoreCase(item.host, target.host) && equalsIgnoreCase(item.type, target.type)),
    );

    await this.setHosts(domain, updated);
    return updated;
  }

  private async setHosts(domain: string, records: readonly DnsRecord[]): Promise<void> {
    const { sld, tld } = splitDomain(domain);
    const params = this.client.buildSetHostsParams(sld, tld, records);
    await this.client.call("namecheap.domains.dns.setHosts", params);
  }
}
