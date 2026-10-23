import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db";

/**
 * Authenticated encryption (AES-256-GCM) for small secrets stored in the database, such as two-factor seeds.
 * The key comes from DATA_ENCRYPTION_KEY (any string; hashed to 32 bytes). Without it, a random key is kept in a
 * 0600 file next to the database, so a copied database file alone does not reveal the secrets. Prefer the
 * environment variable in production: a key file on the same disk protects against a leaked dump, not a stolen disk.
 */
const keys = new WeakMap<DB, Buffer>();
const PREFIX = "enc1:";

function keyFor(db: DB): Buffer {
  const cached = keys.get(db); if (cached) return cached;
  let key: Buffer;
  if (process.env.DATA_ENCRYPTION_KEY) key = createHash("sha256").update(process.env.DATA_ENCRYPTION_KEY).digest();
  else {
    const file = (db.prepare("PRAGMA database_list").get() as { file?: string } | undefined)?.file;
    if (!file) key = randomBytes(32); // in-memory database: the key lives and dies with it
    else {
      const kf = path.join(path.dirname(file), `${path.basename(file)}.key`);
      if (fs.existsSync(kf)) key = Buffer.from(fs.readFileSync(kf, "utf8").trim(), "hex");
      else { key = randomBytes(32); fs.writeFileSync(kf, key.toString("hex"), { mode: 0o600 }); }
    }
  }
  keys.set(db, key); return key;
}
export const isSealed = (s: string) => s.startsWith(PREFIX);
export function seal(db: DB, plain: string): string {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", keyFor(db), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${PREFIX}${[iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".")}`;
}
/** Plain text from a sealed value; a value stored before encryption existed is returned as is. */
export function open(db: DB, stored: string): string {
  if (!isSealed(stored)) return stored;
  const [iv, tag, ct] = stored.slice(PREFIX.length).split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", keyFor(db), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
/** Encrypt any two-factor seed stored in the clear (run at startup). Returns how many were converted. */
export function sealLegacySecrets(db: DB): number {
  const rows = db.prepare("SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL AND totp_secret NOT LIKE 'enc1:%'").all() as Array<{ id: string; totp_secret: string }>;
  for (const r of rows) db.prepare("UPDATE users SET totp_secret = ? WHERE id = ?").run(seal(db, r.totp_secret), r.id);
  return rows.length;
}
