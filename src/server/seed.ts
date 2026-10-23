import type { DB } from "./db";
import { tx } from "./db";
import { createUser } from "./auth";
import { buildCases, buildPriya, CASE_IDS, PRIYA_ID } from "../shared/fixtures";
import { deleteClient, ensureGlobalMappings, saveFixture } from "./repo";
import { randomBytes } from "node:crypto";
import { refresh } from "./service";

export const DEMO_CLIENT_IDS = [PRIYA_ID, CASE_IDS.A, CASE_IDS.B, CASE_IDS.C];

export function seedIfEmpty(db: DB): { adminPassword?: string; viewerPassword?: string } {
  const out: { adminPassword?: string; viewerPassword?: string } = {};
  ensureGlobalMappings(db);
  const nUsers = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (nUsers === 0) {
    const prod = process.env.NODE_ENV === "production";
    const adminPw = process.env.DEMO_ADMIN_PASSWORD || (prod ? randomBytes(9).toString("base64url") : "Demo@2026-Advisor");
    const viewerPw = process.env.DEMO_VIEWER_PASSWORD || (prod ? randomBytes(9).toString("base64url") : "Demo@2026-Viewer");
    createUser(db, process.env.DEMO_ADMIN_EMAIL || "advisor@demo.local", "Demo Advisor", "admin", adminPw);
    createUser(db, process.env.DEMO_VIEWER_EMAIL || "viewer@demo.local", "Demo Viewer (read-only)", "viewer", viewerPw);
    out.adminPassword = adminPw; out.viewerPassword = viewerPw;
  }
  const nClients = (db.prepare("SELECT COUNT(*) AS n FROM clients").get() as { n: number }).n;
  if (nClients === 0) {
    saveFixture(db, buildPriya(), true);
    for (const c of buildCases()) saveFixture(db, c, true);
    for (const id of DEMO_CLIENT_IDS) refresh(db, id);
  }
  return out;
}

/** Restore fixture clients to their original state. Only demo-flagged fixture rows are touched; user-created clients are never affected. */
export function resetDemo(db: DB, only?: string): string[] {
  const fixtures = [buildPriya(), ...buildCases()];
  const targets = only ? fixtures.filter((f) => f.client.id === only) : fixtures;
  if (only && targets.length === 0) throw Object.assign(new Error("Only demonstration clients can be reset."), { status: 422 });
  tx(db, () => {
    for (const f of targets) {
      const row = db.prepare("SELECT is_demo FROM clients WHERE id = ?").get(f.client.id) as { is_demo: number } | undefined;
      if (row && row.is_demo !== 1) continue; // never overwrite a real client that happens to share an id
      deleteClient(db, f.client.id);
      saveFixture(db, f, true);
    }
  });
  return targets.map((t) => t.client.id);
}
