import { AppError } from "@helmsman/shared";
import type {
  DomainAvailabilityResult,
  DomainPricingResult,
  NamecheapConfig,
  RecordType,
} from "../../types.js";

const DEFAULT_BASE_URL = "https://api.sandbox.namecheap.com/xml.response";

const getAttribute = (tag: string, attribute: string): string | undefined => {
  const match = tag.match(new RegExp(`${attribute}="([^"]*)"`, "i"));
  return match?.[1];
};

const parseNumber = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export class NamecheapClient {
  private readonly config: NamecheapConfig;

  public constructor(config: NamecheapConfig) {
    this.config = config;
  }

  public async call(
    command: string,
    extraParams: Record<string, string>,
  ): Promise<string> {
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
      throw new AppError(
        "DNS_PROVIDER_HTTP_ERROR",
        "Namecheap API call failed.",
        {
          status: response.status,
          command,
        },
      );
    }

    const xml = await response.text();
    const statusMatch = xml.match(/<ApiResponse[^>]*Status="([^"]+)"/i);
    if (!statusMatch || statusMatch[1] !== "OK") {
      const errorMatch = xml.match(/<Error[^>]*>([\s\S]*?)<\/Error>/i);
      throw new AppError(
        "DNS_PROVIDER_ERROR",
        "Namecheap API returned an error.",
        {
          command,
          providerMessage: errorMatch?.[1]?.trim(),
        },
      );
    }

    return xml;
  }

  public parseHosts(xml: string): readonly {
    id: string;
    host: string;
    type: RecordType;
    value: string;
    ttl: number;
    mxPref?: number;
  }[] {
    const matches = [...xml.matchAll(/<host\s+[^>]*\/>/gi)];

    return matches.map((match, index) => {
      const tag = match[0];
      const host = getAttribute(tag, "Name") ?? "@";
      const type = (
        getAttribute(tag, "Type") ?? "A"
      ).toUpperCase() as RecordType;
      const value = getAttribute(tag, "Address") ?? "";
      const ttl = Number(getAttribute(tag, "TTL") ?? "60");
      const mxPrefRaw = getAttribute(tag, "MXPref");

      return {
        id: String(index),
        host,
        type,
        value,
        ttl,
        mxPref: mxPrefRaw ? Number(mxPrefRaw) : undefined,
      };
    });
  }

  public parseDomainAvailability(
    xml: string,
    domain: string,
  ): DomainAvailabilityResult {
    const resultTag = [...xml.matchAll(/<DomainCheckResult\s+[^>]*\/>/gi)].find(
      (match) =>
        (getAttribute(match[0], "Domain") ?? "").toLowerCase() ===
        domain.toLowerCase(),
    )?.[0];

    if (!resultTag) {
      throw new AppError(
        "DNS_PROVIDER_PARSE_ERROR",
        "Namecheap availability response did not include requested domain.",
        { domain },
      );
    }

    const availableRaw = getAttribute(resultTag, "Available") ?? "false";
    const isPremiumRaw = getAttribute(resultTag, "IsPremiumName") ?? "false";
    const description = getAttribute(resultTag, "Description");

    return {
      domain,
      available: availableRaw.toLowerCase() === "true",
      source: "namecheap",
      isPremium: isPremiumRaw.toLowerCase() === "true",
      premiumRegistrationPrice: parseNumber(
        getAttribute(resultTag, "PremiumRegistrationPrice"),
      ),
      premiumRenewalPrice: parseNumber(
        getAttribute(resultTag, "PremiumRenewalPrice"),
      ),
      premiumRestorePrice: parseNumber(
        getAttribute(resultTag, "PremiumRestorePrice"),
      ),
      icannFee: parseNumber(getAttribute(resultTag, "IcannFee")),
      eapFee: parseNumber(getAttribute(resultTag, "EapFee")),
      message: description,
    };
  }

  public parseDomainPricing(xml: string, tld: string): DomainPricingResult {
    const tagMatch = [...xml.matchAll(/<ProductPrice\s+[^>]*\/>/gi)].find(
      (match) => {
        const tag = match[0];
        const duration = getAttribute(tag, "Duration");
        const durationType = getAttribute(tag, "DurationType");
        return duration === "1" && (!durationType || durationType === "YEAR");
      },
    );

    if (!tagMatch) {
      return {
        tld,
        source: "namecheap",
        note: "Pricing data not present in provider response.",
      };
    }

    const tag = tagMatch[0];
    return {
      tld,
      source: "namecheap",
      currency: getAttribute(tag, "Currency"),
      registration: parseNumber(getAttribute(tag, "RegisterPrice")),
      renewal: parseNumber(getAttribute(tag, "RenewPrice")),
      transfer: parseNumber(getAttribute(tag, "TransferPrice")),
      restore: parseNumber(getAttribute(tag, "RestorePrice")),
    };
  }

  public buildSetHostsParams(
    sld: string,
    tld: string,
    records: readonly {
      host: string;
      type: string;
      value: string;
      ttl: number;
      mxPref?: number;
    }[],
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
