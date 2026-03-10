import { AppError } from "@helmsman/shared";
import type { NamecheapConfig } from "../../types.js";

const DEFAULT_BASE_URL = "https://api.sandbox.namecheap.com/xml.response";


const getAttribute = (tag: string, attribute: string): string | undefined => {
  const match = tag.match(new RegExp(`${attribute}="([^"]*)"`, "i"));
  return match?.[1];
};

export class NamecheapClient {
  private readonly config: NamecheapConfig;

  public constructor(config: NamecheapConfig) {
    this.config = config;
  }

  public async call(command: string, extraParams: Record<string, string>): Promise<string> {
    const baseUrl = this.config.apiBaseUrl ?? DEFAULT_BASE_URL;
    const params = new URLSearchParams({
      ApiUser: this.config.apiUser,
      ApiKey: this.config.apiKey,
      UserName: this.config.username,
      ClientIp: this.config.clientIp,
      Command: command,
      ...extraParams,
    });

    const response = await fetch(`${baseUrl}?${params.toString()}`);
    if (!response.ok) {
      throw new AppError("DNS_PROVIDER_HTTP_ERROR", "Namecheap API call failed.", {
        status: response.status,
        command,
      });
    }

    const xml = await response.text();
    const statusMatch = xml.match(/<ApiResponse[^>]*Status="([^"]+)"/i);
    if (!statusMatch || statusMatch[1] !== "OK") {
      const errorMatch = xml.match(/<Error[^>]*>([\s\S]*?)<\/Error>/i);
      throw new AppError("DNS_PROVIDER_ERROR", "Namecheap API returned an error.", {
        command,
        providerMessage: errorMatch?.[1]?.trim(),
      });
    }

    return xml;
  }

  public parseHosts(xml: string): readonly {
    host: string;
    type: string;
    value: string;
    ttl: number;
    mxPref?: number;
  }[] {
    const matches = [...xml.matchAll(/<host\s+[^>]*\/>/gi)];

    return matches.map((match) => {
      const tag = match[0];
      const host = getAttribute(tag, "Name") ?? "@";
      const type = getAttribute(tag, "Type") ?? "A";
      const value = getAttribute(tag, "Address") ?? "";
      const ttl = Number(getAttribute(tag, "TTL") ?? "60");
      const mxPrefRaw = getAttribute(tag, "MXPref");

      return {
        host,
        type,
        value,
        ttl,
        mxPref: mxPrefRaw ? Number(mxPrefRaw) : undefined,
      };
    });
  }

  public buildSetHostsParams(
    sld: string,
    tld: string,
    records: readonly { host: string; type: string; value: string; ttl: number; mxPref?: number }[],
  ): Record<string, string> {
    const params: Record<string, string> = {
      SLD: sld,
      TLD: tld,
    };

    records.forEach((record, index) => {
      const idx = index + 1;
      params[`HostName${idx}`] = record.host;
      params[`RecordType${idx}`] = record.type;
      params[`Address${idx}`] = record.value;
      params[`TTL${idx}`] = String(record.ttl);
      if (record.mxPref !== undefined) {
        params[`MXPref${idx}`] = String(record.mxPref);
      }
    });

    return params;
  }
}
