import { describe, expect, it } from "bun:test";

import { __internal } from "@helmsman/transport";

describe("sender internals", () => {
  it("should escape html", () => {
    expect(__internal.escapeHtml("<hello> & \"test\"")).toBe("&lt;hello&gt; &amp; &quot;test&quot;");
  });

  it("should split long text", () => {
    const text = "a".repeat(5000);
    const chunks = __internal.splitMessage(text, 4096);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.length).toBe(4096);
  });
});
