import { describe, expect, it } from "bun:test";
import { createDnsProviderPackage } from "../src/tools.js";

describe("createDnsProviderPackage", () => {
  it("should expose public observer tools without provider config", () => {
    const providerPackage = createDnsProviderPackage({});

    const observerIds = providerPackage.observerTools.map(
      (tool: { id?: string }) => tool.id,
    );

    expect(observerIds).toContain("dns_inspect_records");
    expect(observerIds).toContain("dns_debug_resolution");
    expect(observerIds).toContain("dns_domain_details");
    expect(observerIds).toContain("dns_check_domain_availability");
  });
});
