import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, type DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { seedIfEmpty } from "../src/server/seed";
import { resetThrottle } from "../src/server/auth";
import { BODY_KEYS, buildOpenApi, renderDocsHtml } from "../src/server/openapi";
import { ENTITY_SCHEMAS } from "../src/server/schemas";

process.env.LOG_LEVEL = "silent";
let db: DB, server: Server, base: string, cookie = "", routes: Array<{ method: string; path: string }> = [];
const tmp = path.join(os.tmpdir(), `nw-openapi-${process.pid}.db`);
const get = async (url: string, withCookie = true) => { const r = await fetch(base + url, { headers: withCookie ? { cookie } : {} }); return { status: r.status, ct: r.headers.get("content-type") ?? "", text: await r.text() }; };
const specOf = async () => JSON.parse((await get("/api/docs/openapi.json")).text);

beforeAll(async () => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true });
  db = openDb(tmp); seedIfEmpty(db);
  const app = createApp(db); server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  routes = (((app as any).router ?? (app as any)._router).stack as any[]).filter((l) => l.route && typeof l.route.path === "string" && l.route.path.startsWith("/api")).flatMap((l) => Object.keys(l.route.methods).map((m) => ({ method: m.toUpperCase(), path: l.route.path.replace(/:(\w+)/g, "{$1}") })));
  resetThrottle(db);
  const r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "networth" }, body: JSON.stringify({ email: "advisor@demo.local", password: "Demo@2026-Advisor" }) });
  cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
});
afterAll(() => { server.close(); db.close(); for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true }); });

describe("OpenAPI reference", () => {
  it("serves valid JSON to signed-in users and refuses anonymous callers", async () => {
    const r = await get("/api/docs/openapi.json"); expect(r.status).toBe(200); expect(r.ct).toContain("json");
    const spec = JSON.parse(r.text); expect(spec.openapi).toBe("3.1.0"); expect(spec.info.title).toBe("Wealth Intelligence API");
    expect((await get("/api/docs/openapi.json", false)).status).toBe(401); expect((await get("/api/docs", false)).status).toBe(401);
  });
  it("documents every registered /api route and nothing else", async () => {
    const spec = await specOf();
    const doc = Object.entries(spec.paths as Record<string, Record<string, unknown>>).flatMap(([p, ms]) => Object.keys(ms).map((m) => `${m.toUpperCase()} ${p}`)).sort();
    const real = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(real.length).toBeGreaterThan(70); expect(doc).toEqual(real);
  });
  it("every documented request body belongs to a real route (catches typos and stale entries)", () => {
    const real = new Set(routes.map((r) => `${r.method} ${r.path}`));
    expect(BODY_KEYS().filter((k) => !real.has(k))).toEqual([]);
  });
  it("lists path parameters and requires a session everywhere except health and login", async () => {
    const spec = await specOf();
    const st = spec.paths["/api/clients/{cid}/state"].get;
    expect(st.parameters).toEqual([{ name: "cid", in: "path", required: true, schema: { type: "string" } }]); expect(st.security).toEqual([{ session: [] }]); expect(st.summary).toMatch(/performs no database writes/);
    expect(spec.paths["/api/health"].get.security).toBeUndefined(); expect(spec.paths["/api/auth/login"].post.security).toBeUndefined();
  });
  it("request schemas are generated from the real validators", async () => {
    const spec = await specOf();
    const body = (m: string, p: string) => spec.paths[p][m].requestBody.content["application/json"].schema;
    for (const e of Object.keys(ENTITY_SCHEMAS)) { expect(body("post", `/api/clients/{cid}/${e}`).type).toBe("object"); expect(body("patch", `/api/clients/{cid}/${e}/{id}`).properties).toBeDefined(); }
    expect(body("post", "/api/clients/{cid}/holdings").required).toEqual(expect.arrayContaining(["name", "instrumentType", "currentValue"]));
    expect(body("post", "/api/clients/{cid}/goals").properties.targetAmount).toBeDefined();
    expect(body("post", "/api/clients/{cid}/risk-profile").properties.answers.required.length).toBe(8);
    expect(body("put", "/api/clients/{cid}/nominations").properties.shares.maxItems).toBe(10);
    expect(body("put", "/api/notifications/prefs").properties.minSeverity.enum).toEqual(["info", "warning", "high", "critical"]);
  });
  it("describes the entity routes in words, and few routes fall back to echoing their path", async () => {
    const spec = await specOf();
    expect(spec.paths["/api/clients/{cid}/holdings"].post.summary).toBe("Add to holdings"); expect(spec.paths["/api/clients/{cid}/goals/{id}"].delete.summary).toMatch(/Archive/);
    const echoed = Object.entries(spec.paths as Record<string, Record<string, any>>).flatMap(([p, ms]) => Object.entries(ms).filter(([m, o]) => o.summary === `${m.toUpperCase()} ${p}`).map(([m]) => `${m.toUpperCase()} ${p}`));
    expect(echoed.length).toBeLessThan(40);
  });
  it("the HTML page lists the routes, escapes content and needs no script", async () => {
    const r = await get("/api/docs"); expect(r.status).toBe(200); expect(r.ct).toContain("html");
    expect(r.text).toContain("/api/clients/{cid}/state"); expect(r.text).not.toMatch(/<script/i);
    const html = renderDocsHtml(buildOpenApi([{ method: "GET", path: "/api/<b>" }], "1"));
    expect(html).not.toContain("/api/<b>"); expect(html).toContain("/api/&lt;b&gt;");
  });
});
