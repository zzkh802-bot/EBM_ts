import path from "node:path";

export function piSessionDirectory(cwd: string, sessionId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error("invalid Pi session id");
  return path.join(cwd, "data", "sessions", sessionId);
}
