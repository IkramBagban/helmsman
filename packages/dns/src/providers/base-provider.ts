import type { DnsRecord } from "../types.js";

export interface DnsProvider {
  listRecords(domain: string): Promise<readonly DnsRecord[]>;
  createRecord(domain: string, record: DnsRecord): Promise<readonly DnsRecord[]>;
  updateRecord(domain: string, record: DnsRecord): Promise<readonly DnsRecord[]>;
  deleteRecord(domain: string, target: Pick<DnsRecord, "host" | "type">): Promise<readonly DnsRecord[]>;
}
