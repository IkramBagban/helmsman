import { describe, expect, it } from "bun:test";
import { splitDomain, toAbsoluteHost } from "../src/utils.js";

describe("splitDomain", () => {
  it("should split a normal apex domain", () => {
    expect(splitDomain("example.com")).toEqual({ sld: "example", tld: "com" });
  });

  it("should support common multi-label public suffixes", () => {
    expect(splitDomain("example.co.uk")).toEqual({
      sld: "example",
      tld: "co.uk",
    });
  });

  it("should throw for invalid values", () => {
    expect(() => splitDomain("localhost")).toThrow();
  });
});

describe("toAbsoluteHost", () => {
  it("should convert @ to apex", () => {
    expect(toAbsoluteHost("@", "example.com")).toBe("example.com");
  });

  it("should append domain for subdomain labels", () => {
    expect(toAbsoluteHost("api", "example.com")).toBe("api.example.com");
  });
});
