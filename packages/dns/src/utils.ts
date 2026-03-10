import { AppError } from "@helmsman/shared";
import type { DomainSplit } from "./types.js";

const MULTI_LABEL_TLDS = new Set<string>([
  "co.uk",
  "org.uk",
  "gov.uk",
  "ac.uk",
  "co.in",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "com.sg",
]);

export const splitDomain = (domain: string): DomainSplit => {
  const normalized = domain.trim().toLowerCase();
  const labels = normalized.split(".").filter(Boolean);

  if (labels.length < 2) {
    throw new AppError(
      "DNS_INVALID_DOMAIN",
      "Domain must include at least one dot.",
      { domain },
    );
  }

  if (labels.length >= 3) {
    const candidateTld = `${labels[labels.length - 2]}.${labels[labels.length - 1]}`;
    if (MULTI_LABEL_TLDS.has(candidateTld)) {
      return {
        sld: labels[labels.length - 3] as string,
        tld: candidateTld,
      };
    }
  }

  return {
    sld: labels[labels.length - 2] as string,
    tld: labels[labels.length - 1] as string,
  };
};

export const toAbsoluteHost = (host: string, domain: string): string => {
  if (host === "@") {
    return domain;
  }

  if (host.endsWith(`.${domain}`)) {
    return host;
  }

  return `${host}.${domain}`;
};
