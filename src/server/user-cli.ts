// Create a user (and, implicitly, a tenant). Usage:
//   NEW_USER_PASSWORD='...' npm run user:create -- <email> "<Full name>" <admin|viewer> [tenant-id]
// Without NEW_USER_PASSWORD a random password is generated and printed once.
import { randomBytes } from "node:crypto";
import { openDb } from "./db";
import { createUser } from "./auth";

const [email, name, role, tenant = "default"] = process.argv.slice(2);
if (!email || !name || (role !== "admin" && role !== "viewer")) {
  console.error('Usage: npm run user:create -- <email> "<Full name>" <admin|viewer> [tenant-id]');
  process.exit(1);
}
const password = process.env.NEW_USER_PASSWORD || randomBytes(9).toString("base64url");
if (password.length < 10) { console.error("Password must be at least 10 characters."); process.exit(1); }
const db = openDb();
try {
  const u = createUser(db, email, name, role, password, tenant);
  console.log(`Created ${u.role} ${u.email} in tenant "${u.tenantId}".`);
  if (!process.env.NEW_USER_PASSWORD) console.log(`Generated password (shown once): ${password}`);
} catch (e) {
  console.error(String((e as Error).message).includes("UNIQUE") ? "That email already exists." : (e as Error).message);
  process.exit(1);
}
