/**
 * Refuse an unauthenticated bind outside the local machine. The web beta may
 * intentionally run without auth during local development, but that mode must
 * not become the default for a public/reverse-proxied deployment.
 */
export function assertSafeBind(host: string, accessKey: string | undefined): void {
  if (isLoopbackHost(host) || accessKey?.trim()) return;
  throw new Error("EBM_INTERNAL_ACCESS_KEY is required when DP_XUNYI_TS_HOST is not loopback; refusing unauthenticated network bind.");
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}
