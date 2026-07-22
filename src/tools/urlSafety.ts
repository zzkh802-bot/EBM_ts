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

function ipv4FromMappedIpv6(address: string): string | undefined {
  const mapped = address.match(/^::ffff:(.+)$/i)?.[1];
  if (!mapped) return undefined;
  if (mapped.includes(".")) return mapped;
  const parts = mapped.split(":");
  if (parts.length !== 2) return undefined;
  const high = Number.parseInt(parts[0]!, 16);
  const low = Number.parseInt(parts[1]!, 16);
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || high > 0xffff || low < 0 || low > 0xffff) return undefined;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

export function isPrivateAddress(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!isIP(normalized)) return false;
  const mappedIpv4 = ipv4FromMappedIpv6(normalized);
  const address = mappedIpv4 ?? normalized;
  return privateCidrs.some((pattern) => pattern.test(address));
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
