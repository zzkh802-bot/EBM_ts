import { describe, expect, it } from "vitest";
import { jinaReaderUrl, validateOutboundUrl } from "../src/tools/urlSafety.js";

describe("URL safety", () => {
  it("rejects metadata and private IP literals", () => {
    expect(validateOutboundUrl("http://169.254.169.254/latest/meta-data")).toEqual({ ok: false, reason: "metadata/local host is blocked" });
    expect(validateOutboundUrl("http://127.0.0.1:8000")).toMatchObject({ ok: false });
    expect(validateOutboundUrl("http://10.0.0.8")).toEqual({ ok: false, reason: "private IP literal is blocked" });
    expect(validateOutboundUrl("http://[::ffff:127.0.0.1]:8080")).toEqual({ ok: false, reason: "private IP literal is blocked" });
    expect(validateOutboundUrl("http://[::ffff:7f00:1]:8080")).toEqual({ ok: false, reason: "private IP literal is blocked" });
  });

  it("allows public IPv6 literals", () => {
    expect(validateOutboundUrl("https://[2606:4700:4700::1111]/dns-query")).toMatchObject({ ok: true });
  });

  it("preserves https scheme for Jina Reader", () => {
    expect(jinaReaderUrl("https://example.com/a?q=1", "https://r.jinaai.cn")).toBe("https://r.jinaai.cn/https://example.com/a?q=1");
  });
});
