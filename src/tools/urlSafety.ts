import { isIP } from "node:net";

const privateCidrs = [
  /^10\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^::1$/i,
  /^fc/i,
  /^fd/i,
  /^fe80:/i,
];

const metadataHosts = new Set([
  "metadata.google.internal",
  "metadata.google.com",
  "localhost",
  "localhost.localdomain",
]);

export type UrlSafetyResult = { ok: true; url: URL } | { ok: false; reason: string };

export function isPrivateAddress(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!isIP(normalized)) return false;
  return privateCidrs.some((pattern) => pattern.test(normalized));
}

export function validateOutboundUrl(input: string): UrlSafetyResult {
  let url: URL;
  try {
    url = new URL(input.includes("://") ? input : `https://${input}`);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, reason: "only http/https URLs are allowed" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "embedded credentials are not allowed" };
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (metadataHosts.has(host) || /^169\.254\.169\.254$/.test(host) || /^100\.100\.100\.20[0-4]$/.test(host)) {
    return { ok: false, reason: "metadata/local host is blocked" };
  }
  if (isPrivateAddress(host)) {
    return { ok: false, reason: "private IP literal is blocked" };
  }

  return { ok: true, url };
}

export function jinaReaderUrl(target: string, readerBase = process.env.JINA_READER_BASE_URL || "https://r.jinaai.cn"): string {
  const checked = validateOutboundUrl(target);
  if (!checked.ok) throw new Error(checked.reason);
  return `${readerBase.replace(/\/$/, "")}/${checked.url.toString()}`;
}
