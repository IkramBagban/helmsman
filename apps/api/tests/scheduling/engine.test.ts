import { describe, expect, it } from "bun:test";

import { __internal } from "@helmsman/scheduling";

describe("SchedulerEngine http_ping target validation", () => {
  it("blocks non-https URLs", async () => {
    const result = await __internal.validateHttpPingTarget("http://example.com/health");
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toContain("https://");
    }
  });

  it("blocks localhost destinations", async () => {
    const result = await __internal.validateHttpPingTarget("https://localhost/health");
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toContain("Localhost");
    }
  });

  it("blocks private IPv4 destinations", async () => {
    const result = await __internal.validateHttpPingTarget("https://10.0.0.10/health");
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toContain("Private");
    }
  });

  it("allows public IPv4 https destinations", async () => {
    const result = await __internal.validateHttpPingTarget("https://1.1.1.1/health");
    expect(result.safe).toBe(true);
  });
});

describe("SchedulerEngine private IP detection", () => {
  it("detects private IPv4 and IPv6 addresses", () => {
    expect(__internal.isPrivateIpAddress("10.0.0.1")).toBe(true);
    expect(__internal.isPrivateIpAddress("172.20.0.1")).toBe(true);
    expect(__internal.isPrivateIpAddress("192.168.1.1")).toBe(true);
    expect(__internal.isPrivateIpAddress("127.0.0.1")).toBe(true);
    expect(__internal.isPrivateIpAddress("::1")).toBe(true);
    expect(__internal.isPrivateIpAddress("fd00::1")).toBe(true);
    expect(__internal.isPrivateIpAddress("fe80::1")).toBe(true);
  });

  it("allows public IPv4 addresses", () => {
    expect(__internal.isPrivateIpAddress("8.8.8.8")).toBe(false);
  });
});
