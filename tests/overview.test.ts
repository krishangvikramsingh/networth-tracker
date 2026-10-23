import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, nowISO, uid, type DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { seedIfEmpty } from "../src/server/seed";
import { createUser, resetThrottle } from "../src/server/auth";
import { crore } from "../src/shared/money";

process.env.LOG_LEVEL = "silent";
let db: DB, server: Server, base: string;
const tmp = path.join(os.tmpdir(), `nw-overview-${process.pid}.db`);
class Session {
  cookie = "";
  async req(method: string, url: string, body?: unknown) {
    const r = await fetch(base + url, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), "X-Requested-With": "networth", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    return { status: r.status, data: (await r.json()) as any };
  }
}
const A = new Session(), B = new Session();

beforeAll(async () => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true });
  db = openDb(tmp); seedIfEmpty(db); createUser(db, "b@acme.test", "B", "admin", "Acme-Admin-2026!", "acme");
  server = createApp(db).listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  resetThrottle(db);
  await A.req("POST", "/api/auth/login", { email: "advisor@demo.local", password: "Demo@2026-Advisor" });
  await B.req("POST", "/api/auth/login", { email: "b@acme.test", password: "Acme-Admin-2026!" });
});
afterAll(() => { server.close(); db.close(); for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true }); });

describe("clients overview", () => {
  it("lists the live client first, then the case studies, with figures matching the client's own state", async () => {
    const o = (await A.req("GET", "/api/overview")).data;
    expect(o.clients.map((c: any) => c.kind)).toEqual(["live", "case", "case", "case"]);
    const priya = o.clients[0], state = (await A.req("GET", "/api/clients/client_priya/state")).data;
    expect(priya.id).toBe("client_priya"); expect(priya.grossAssets).toBe(crore(8.63)); expect(priya.grossAssets).toBe(state.evaluation.portfolio.grossAssets);
    expect(priya.healthScore).toBe(state.evaluation.health.overall);
  });
  it("shows 'not assessed' as null, never 0", async () => {
    const priya = (await A.req("GET", "/api/overview")).data.clients[0];
    expect(priya.netWorth).toBeNull(); // liabilities not assessed
    expect(priya.nominationCoveredPct).toBeNull(); expect(priya.riskProfile).toBeNull();
  });
  it("totals count real clients only and leave case studies out of assets", async () => {
    const t = (await A.req("GET", "/api/overview")).data.totals;
    expect(t).toEqual({ liveClients: 1, caseStudies: 3, liveGrossAssets: crore(8.63) });
  });
  it("picks up a recorded risk profile and nomination coverage", async () => {
    await A.req("POST", "/api/clients/client_priya/risk-profile", { answers: { t_drop: 3, t_range: 3, t_exp: 3, t_goal: 3, c_horizon: 3, c_income: 3, c_reserve: 3, c_obligations: 3 } });
    const nid = (await A.req("POST", "/api/clients/client_priya/nominees", { name: "P", relationship: "Spouse" })).data.nominee.id;
    const rows = (await A.req("GET", "/api/clients/client_priya/estate")).data.coverage.rows.filter((r: any) => r.entity === "holding");
    await A.req("PUT", "/api/clients/client_priya/nominations", { entity: "holding", entityId: rows[0].entityId, shares: [{ nomineeId: nid, shareBps: 10000 }] });
    const p = (await A.req("GET", "/api/overview")).data.clients[0];
    expect(p.riskProfile).toBe("aggressive"); expect(p.nominationCoveredPct).toBeGreaterThan(0); expect(p.nominationCoveredPct).toBeLessThan(100);
  });
  it("counts open alerts per severity, leaving out data-gap notices, acknowledged and resolved alerts", async () => {
    const add = (status: string, kind: string, sev: string, subj: string) => { const id = uid("alt"), n = nowISO(); db.prepare(`INSERT INTO alerts (id, client_id, rule_key, fingerprint, kind, status, severity, subject, current_label, threshold_label, why, action, records, first_detected_at, last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, "case_a_aggressive", "equity_allocation_max", `fp-${id}`, kind, status, sev, subj, "", "", "", "", "[]", n, n); return id; };
    db.exec("DELETE FROM alerts WHERE client_id = 'case_a_aggressive'");
    add("open", "breach", "critical", "CRIT-1"); add("open", "breach", "critical", "CRIT-2"); add("open", "breach", "high", "HIGH-1"); add("open", "possible", "warning", "WARN-1");
    add("open", "data_gap", "info", "GAP"); add("acknowledged", "breach", "critical", "ACK"); add("resolved", "breach", "critical", "RES");
    const o = (await A.req("GET", "/api/overview")).data;
    expect(o.clients.find((c: any) => c.id === "case_a_aggressive").openAlerts).toEqual({ critical: 2, high: 1, warning: 1, info: 0 });
    const subjects = o.attention.filter((a: any) => a.clientId === "case_a_aggressive").map((a: any) => a.subject);
    expect(subjects).toEqual(expect.arrayContaining(["CRIT-1", "CRIT-2", "HIGH-1", "WARN-1"])); expect(subjects).not.toContain("GAP"); expect(subjects).not.toContain("ACK"); expect(subjects).not.toContain("RES");
  });
  it("the attention queue is ordered most severe first and capped at 15", async () => {
    for (let i = 0; i < 20; i++) { const id = uid("alt"), n = nowISO(); db.prepare(`INSERT INTO alerts (id, client_id, rule_key, fingerprint, kind, status, severity, subject, current_label, threshold_label, why, action, records, first_detected_at, last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, "case_b_conservative", "idle_cash", `fp-${id}`, "breach", "open", "info", `N${i}`, "", "", "", "", "[]", n, n); }
    const q = (await A.req("GET", "/api/overview")).data.attention;
    expect(q.length).toBe(15);
    const order = ["info", "warning", "high", "critical"];
    for (let i = 1; i < q.length; i++) expect(order.indexOf(q[i - 1].severity)).toBeGreaterThanOrEqual(order.indexOf(q[i].severity));
    expect(q[0].severity).toBe("critical");
  });
  it("a different tenant sees none of these clients, totals or alerts", async () => {
    const o = (await B.req("GET", "/api/overview")).data;
    expect(o.clients).toEqual([]); expect(o.attention).toEqual([]); expect(o.totals).toEqual({ liveClients: 0, caseStudies: 0, liveGrossAssets: null });
  });
  it("requires sign-in", async () => { expect((await new Session().req("GET", "/api/overview")).status).toBe(401); });
});
