import { createHash } from "node:crypto";
import path from "node:path";

export function attachmentUserDirectory(rootDir: string, userId: string): string {
  const ownerHash = createHash("sha256").update(userId).digest("hex").slice(0, 20);
  return path.join(rootDir, "data", "attachments", ownerHash);
}

export function attachmentMetadataPath(rootDir: string, userId: string, attachmentId: string): string {
  return path.join(attachmentUserDirectory(rootDir, userId), attachmentId, "metadata.json");
}
