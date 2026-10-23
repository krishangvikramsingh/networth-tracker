import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, type DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { seedIfEmpty } from "../src/server/seed";
import { createUser, resetThrottle } from "../src/server/auth";

process.env.LOG_LEVEL = "silent";
let db: DB, server: Server, base: string;
let adv = "", viewer = "", acme = "", acmeClient = "", colleagueId = "", acmeUserId = "";
const tmp = path.join(os.tmpdir(), `nw-tasks-${process.pid}.db`);
const P = "client_priya";

async function call(method: string, url: string, body?: unknown, cookie = "") {
  const r = await fetch(base + url, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), "X-Requested-With": "networth", cookie }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie"); const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, cookie: sc ? sc.split(";")[0] : "", data: ct.includes("json") ? ((await r.json()) as any) : await r.text() };
}
const sign = async (email: string, password: string) => (await call("POST", "/api/auth/login", { email, password })).cookie;

beforeAll(async () => {
  for (const x of ["", "-wal", "-shm", ".key"]) fs.rmSync(tmp + x, { force: true });
  db = openDb(tmp); seedIfEmpty(db);
  colleagueId = createUser(db, "colleague@demo.local", "Colleague Advisor", "admin", "Colleague-Pass-1").id;
  acmeUserId = createUser(db, "boss@acme.example", "Acme Boss", "admin", "Acme-Boss-Pass-1", "acme").id;
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  resetThrottle(db);
  adv = await sign("advisor@demo.local", "Demo@2026-Advisor"); viewer = await sign("viewer@demo.local", "Demo@2026-Viewer"); acme = await sign("boss@acme.example", "Acme-Boss-Pass-1");
  acmeClient = (await call("POST", "/api/clients", { name: "Acme Client" }, acme)).data.id;
});
afterAll(() => { server.close(); db.close(); for (const x of ["", "-wal", "-shm", ".key"]) fs.rmSync(tmp + x, { force: true }); });

describe("task queue", () => {
  it("an advisor creates a task tied to an alert, assigns it, and it shows with the alert's details", async () => {
    const alert = (await call("GET", `/api/clients/${P}/state`, undefined, adv)).data.alerts.find((a: any) => a.kind !== "data_gap");
    const r = await call("POST", "/api/tasks", { title: "Call Priya about the drift", clientId: P, alertId: alert.id, assigneeId: colleagueId, dueDate: "2026-11-01", note: "Bring the rebalancing scenario" }, adv);
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ title: "Call Priya about the drift", status: "open", clientName: "Priya Ramanathan", assigneeName: "Colleague Advisor", alertSeverity: alert.severity, overdue: false });
    expect(r.data.alertRule).toContain(alert.subject);
    const list = (await call("GET", "/api/tasks", undefined, adv)).data;
    expect(list.tasks.map((t: any) => t.id)).toContain(r.data.id);
    expect(list.assignees.map((a: any) => a.id)).toContain(colleagueId);
    expect(list.counts.open).toBeGreaterThanOrEqual(1);
  });
  it("moves through open, in progress and done; done stamps the time and reopening clears it", async () => {
    const id = (await call("POST", "/api/tasks", { title: "Collect nominee details", clientId: P }, adv)).data.id;
    expect((await call("PATCH", `/api/tasks/${id}`, { status: "in_progress" }, adv)).data.status).toBe("in_progress");
    const done = (await call("PATCH", `/api/tasks/${id}`, { status: "done" }, adv)).data;
    expect(done.status).toBe("done"); expect(done.completedAt).not.toBeNull();
    expect((await call("PATCH", `/api/tasks/${id}`, { status: "open" }, adv)).data.completedAt).toBeNull();
  });
  it("flags overdue tasks, but never a finished one", async () => {
    const id = (await call("POST", "/api/tasks", { title: "Old follow-up", clientId: P, dueDate: "2020-01-01" }, adv)).data.id;
    expect((await call("GET", "/api/tasks?status=active", undefined, adv)).data.tasks.find((t: any) => t.id === id).overdue).toBe(true);
    expect((await call("GET", "/api/tasks", undefined, adv)).data.counts.overdue).toBeGreaterThanOrEqual(1);
    expect((await call("PATCH", `/api/tasks/${id}`, { status: "done" }, adv)).data.overdue).toBe(false);
  });
  it("filters by assignee and status", async () => {
    const mine = await call("POST", "/api/tasks", { title: "Mine for filtering", clientId: P, assigneeId: (await call("GET", "/api/auth/me", undefined, adv)).data.user.id }, adv);
    const un = await call("POST", "/api/tasks", { title: "Nobody yet", clientId: P }, adv);
    const meList = (await call("GET", "/api/tasks?assignee=me&status=active", undefined, adv)).data.tasks.map((t: any) => t.id);
    expect(meList).toContain(mine.data.id); expect(meList).not.toContain(un.data.id);
    expect((await call("GET", "/api/tasks?assignee=unassigned", undefined, adv)).data.tasks.map((t: any) => t.id)).toContain(un.data.id);
    expect((await call("GET", `/api/tasks?client=${P}&status=done`, undefined, adv)).data.tasks.every((t: any) => t.status === "done")).toBe(true);
  });
  it("validates: short title, bad date, an alert from another client, an assignee outside the organisation", async () => {
    expect((await call("POST", "/api/tasks", { title: "x", clientId: P }, adv)).status).toBe(422);
    expect((await call("POST", "/api/tasks", { title: "Fine title", clientId: P, dueDate: "2026-13-45" }, adv)).status).toBe(422);
    const caseAlert = (await call("GET", "/api/clients/case_a_aggressive/state", undefined, adv)).data.alerts[0];
    expect((await call("POST", "/api/tasks", { title: "Wrong alert", clientId: P, alertId: caseAlert.id }, adv)).status).toBe(422);
    expect((await call("POST", "/api/tasks", { title: "Outside assignee", clientId: P, assigneeId: acmeUserId }, adv)).status).toBe(422);
  });
  it("read-only viewers can read the queue but not change it", async () => {
    const id = (await call("POST", "/api/tasks", { title: "Viewer cannot touch", clientId: P }, adv)).data.id;
    expect((await call("GET", "/api/tasks", undefined, viewer)).status).toBe(200);
    expect((await call("POST", "/api/tasks", { title: "Nope nope", clientId: P }, viewer)).status).toBe(403);
    expect((await call("PATCH", `/api/tasks/${id}`, { status: "done" }, viewer)).status).toBe(403);
    expect((await call("DELETE", `/api/tasks/${id}`, undefined, viewer)).status).toBe(403);
  });
  it("is isolated between organisations: no listing, reading, editing, deleting or tasks on another's client", async () => {
    const mine = (await call("POST", "/api/tasks", { title: "Priya's private follow-up", clientId: P }, adv)).data.id;
    const theirs = (await call("POST", "/api/tasks", { title: "Acme's follow-up", clientId: acmeClient }, acme)).data.id;
    const acmeList = (await call("GET", "/api/tasks", undefined, acme)).data;
    expect(acmeList.tasks.map((t: any) => t.id)).toEqual([theirs]);
    expect(acmeList.assignees.map((a: any) => a.id)).toEqual([acmeUserId]);
    expect((await call("GET", "/api/tasks", undefined, adv)).data.tasks.map((t: any) => t.id)).not.toContain(theirs);
    for (const m of ["PATCH", "DELETE"]) expect((await call(m, `/api/tasks/${mine}`, m === "PATCH" ? { status: "done" } : undefined, acme)).status).toBe(404);
    for (const m of ["PATCH", "DELETE"]) expect((await call(m, `/api/tasks/${theirs}`, m === "PATCH" ? { status: "done" } : undefined, adv)).status).toBe(404);
    expect((await call("POST", "/api/tasks", { title: "Sneaky task", clientId: P }, acme)).status).toBe(404);
    expect((await call("GET", `/api/tasks?client=${P}`, undefined, acme)).data.tasks).toEqual([]);
  });
  it("records create, update and delete in the client's audit trail", async () => {
    const id = (await call("POST", "/api/tasks", { title: "Audit me", clientId: P }, adv)).data.id;
    await call("PATCH", `/api/tasks/${id}`, { status: "done" }, adv); await call("DELETE", `/api/tasks/${id}`, undefined, adv);
    const acts = (db.prepare("SELECT action FROM audit_events WHERE entity = 'task' AND entity_id = ? ORDER BY at").all(id) as Array<{ action: string }>).map((r) => r.action);
    expect(acts).toEqual(["create", "update", "delete"]);
    expect((await call("GET", "/api/tasks", undefined, adv)).data.tasks.map((t: any) => t.id)).not.toContain(id);
  });
  it("a task outlives its alert being resolved and says so", async () => {
    const alert = (await call("GET", `/api/clients/${P}/state`, undefined, adv)).data.alerts.find((a: any) => a.kind !== "data_gap");
    const id = (await call("POST", "/api/tasks", { title: "Alert will clear", clientId: P, alertId: alert.id }, adv)).data.id;
    db.prepare("UPDATE alerts SET status = 'resolved' WHERE id = ?").run(alert.id);
    expect((await call("GET", "/api/tasks", undefined, adv)).data.tasks.find((t: any) => t.id === id).alertStatus).toBe("resolved");
    db.prepare("UPDATE alerts SET status = 'open' WHERE id = ?").run(alert.id);
  });
});
