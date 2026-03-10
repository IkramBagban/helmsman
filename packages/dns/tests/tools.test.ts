import { describe, expect, it } from "bun:test";
import { createDnsProviderPackage } from "../src/tools.js";

describe("createDnsProviderPackage", () => {
  it("should expose DNS observer tools without provider config", () => {
    const providerPackage = createDnsProviderPackage({});

    const observerIds = providerPackage.observerTools.map(
      (tool: { id?: string }) => tool.id,
    );

    expect(observerIds).toContain("dns_inspect_records");
    expect(observerIds).toContain("dns_debug_resolution");
    expect(observerIds).toContain("dns_check_propagation");
    expect(observerIds).toContain("dns_check_email_health");
    expect(observerIds).toContain("dns_domain_details");
    expect(observerIds).toContain("dns_check_domain_availability");
    expect(observerIds).toContain("dns_check_domain_pricing");
  });

  it("should expose create/update/delete tools", () => {
    const providerPackage = createDnsProviderPackage({});

    const operatorIds = providerPackage.operatorTools.map(
      (tool: { id?: string }) => tool.id,
    );
    const commanderIds = providerPackage.commanderTools.map(
      (tool: { id?: string }) => tool.id,
    );

    expect(operatorIds).toContain("dns_create_record");
    expect(operatorIds).toContain("dns_update_record");
    expect(commanderIds).toContain("dns_delete_record");
  });
});
