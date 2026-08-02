import { createHash } from "node:crypto";

export function fingerprint(parts: string[]): string {
  return createHash("sha256")
    .update(parts.filter(Boolean).join("|"))
    .digest("hex")
    .slice(0, 24);
}
