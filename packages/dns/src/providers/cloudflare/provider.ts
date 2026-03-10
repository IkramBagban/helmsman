import { AppError } from "@helmsman/shared";
import type { DnsProvider } from "../base-provider.js";
import type { CloudflareConfig, DnsRecord, RecordType } from "../../types.js";

interface CloudflareResponse<T> {
  readonly success: boolean;
  readonly result: T;
  readonly errors?: readonly { readonly message?: string }[];
}

interface CloudflareZone {
  readonly id: string;
  readonly name: string;
}

interface CloudflareDnsRecord {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly content: string;
  readonly ttl: number;
  readonly priority?: number;
}

const DEFAULT_BASE_URL = "https://api.cloudflare.com/client/v4";

const normalizeRecordType = (type: string): RecordType =>
  type.toUpperCase() as RecordType;

const toRecordHost = (recordName: string, zoneName: string): string => {
  if (recordName === zoneName) {
    return "@";
  }

  const suffix = `.${zoneName}`;
  if (recordName.endsWith(suffix)) {
    return recordName.slice(0, -suffix.length);
  }

  return recordName;
};

const toFqdn = (host: string, zoneName: string): string =>
  host === "@" ? zoneName : `${host}.${zoneName}`;

export class CloudflareDnsProvider implements DnsProvider {
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly zoneMap: Record<string, string>;

  public constructor(config: CloudflareConfig) {
    this.apiToken = config.apiToken;
    this.baseUrl = config.apiBaseUrl ?? DEFAULT_BASE_URL;
    this.zoneMap = { ...(config.zoneMap ?? {}) };
  }

  public async listRecords(domain: string): Promise<readonly DnsRecord[]> {
    const zone = await this.getZone(domain);
    const response = await this.call<CloudflareDnsRecord[]>(
      `/zones/${zone.id}/dns_records?per_page=500`,
    );

    return response.result.map((record) => ({
      id: record.id,
      host: toRecordHost(record.name, zone.name),
      type: normalizeRecordType(record.type),
      value: record.content,
      ttl: record.ttl,
      mxPref: record.priority,
    }));
  }

  public async getRecord(domain: string, recordId: string): Promise<DnsRecord> {
    const zone = await this.getZone(domain);
    const response = await this.call<CloudflareDnsRecord>(
      `/zones/${zone.id}/dns_records/${recordId}`,
    );

    const record = response.result;
    return {
      id: record.id,
      host: toRecordHost(record.name, zone.name),
      type: normalizeRecordType(record.type),
      value: record.content,
      ttl: record.ttl,
      mxPref: record.priority,
    };
  }

  public async createRecord(
    domain: string,
    record: Omit<DnsRecord, "id">,
  ): Promise<DnsRecord> {
    const zone = await this.getZone(domain);

    const response = await this.call<CloudflareDnsRecord>(
      `/zones/${zone.id}/dns_records`,
      {
        method: "POST",
        body: JSON.stringify({
          type: record.type,
          name: toFqdn(record.host, zone.name),
          content: record.value,
          ttl: record.ttl,
          ...(record.mxPref !== undefined ? { priority: record.mxPref } : {}),
        }),
      },
    );

    const created = response.result;
    return {
      id: created.id,
      host: toRecordHost(created.name, zone.name),
      type: normalizeRecordType(created.type),
      value: created.content,
      ttl: created.ttl,
      mxPref: created.priority,
    };
  }

  public async updateRecord(
    domain: string,
    recordId: string,
    patch: Partial<Omit<DnsRecord, "id">>,
  ): Promise<DnsRecord> {
    const zone = await this.getZone(domain);
    const current = await this.getRecord(domain, recordId);

    const merged: Omit<DnsRecord, "id"> = {
      host: patch.host ?? current.host,
      type: patch.type ?? current.type,
      value: patch.value ?? current.value,
      ttl: patch.ttl ?? current.ttl,
      mxPref: patch.mxPref ?? current.mxPref,
    };

    const response = await this.call<CloudflareDnsRecord>(
      `/zones/${zone.id}/dns_records/${recordId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          type: merged.type,
          name: toFqdn(merged.host, zone.name),
          content: merged.value,
          ttl: merged.ttl,
          ...(merged.mxPref !== undefined ? { priority: merged.mxPref } : {}),
        }),
      },
    );

    const updated = response.result;
    return {
      id: updated.id,
      host: toRecordHost(updated.name, zone.name),
      type: normalizeRecordType(updated.type),
      value: updated.content,
      ttl: updated.ttl,
      mxPref: updated.priority,
    };
  }

  public async deleteRecord(domain: string, recordId: string): Promise<void> {
    const zone = await this.getZone(domain);
    await this.call<CloudflareDnsRecord>(
      `/zones/${zone.id}/dns_records/${recordId}`,
      {
        method: "DELETE",
      },
    );
  }

  private async getZone(domain: string): Promise<CloudflareZone> {
    const normalized = domain.trim().toLowerCase();
    const cachedId = this.zoneMap[normalized];

    if (cachedId) {
      return { id: cachedId, name: normalized };
    }

    const candidates = this.buildZoneCandidates(normalized);
    for (const candidate of candidates) {
      const response = await this.call<CloudflareZone[]>(
        `/zones?name=${encodeURIComponent(candidate)}&per_page=1`,
      );
      const zone = response.result[0];
      if (zone) {
        this.zoneMap[zone.name.toLowerCase()] = zone.id;
        return zone;
      }
    }

    throw new AppError(
      "DNS_PROVIDER_ZONE_NOT_FOUND",
      "Cloudflare zone was not found.",
      {
        domain,
        candidates,
      },
    );
  }

  private buildZoneCandidates(domain: string): readonly string[] {
    const labels = domain.split(".").filter(Boolean);
    const candidates: string[] = [];

    for (let i = 0; i <= labels.length - 2; i += 1) {
      candidates.push(labels.slice(i).join("."));
    }

    return [...new Set(candidates)];
  }

  private async call<T>(
    path: string,
    init?: RequestInit,
  ): Promise<CloudflareResponse<T>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: init?.body,
    });

    if (!response.ok) {
      throw new AppError(
        "DNS_PROVIDER_HTTP_ERROR",
        "Cloudflare API call failed.",
        {
          status: response.status,
          path,
        },
      );
    }

    const json = (await response.json()) as CloudflareResponse<T>;
    if (!json.success) {
      throw new AppError(
        "DNS_PROVIDER_ERROR",
        "Cloudflare API returned an error.",
        {
          path,
          errors: json.errors,
        },
      );
    }

    return json;
  }
}
