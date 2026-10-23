import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { openDb, type DB } from "../src/server/db";
import { createApp } from "../src/server/app";
import { seedIfEmpty } from "../src/server/seed";
import { resetThrottle } from "../src/server/auth";

process.env.LOG_LEVEL = "silent";
let db: DB, server: Server, base: string, cookie = "";
const tmp = path.join(os.tmpdir(), `nw-scale-${process.pid}.db`);
const STATE = "/api/clients/client_priya/state";

beforeAll(async () => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true });
  db = openDb(tmp); seedIfEmpty(db);
  const ins = db.prepare("INSERT INTO holdings (id,client_id,name,original_description,instrument_type,asset_class,classification_method,classification_status,current_value,valuation_date,liquidity_tier,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  db.exec("BEGIN");
  for (let i = 0; i < 5000; i++) ins.run(`lh${i}`, "client_priya", `Load holding ${i}`, `Load holding ${i}`, "direct_stock", "indian_equity", "rule", "confirmed", 1_00_000_00 + (i * 7919) % 9_00_000_00, "2026-10-20", 2, "2026-10-20T00:00:00Z", "2026-10-20T00:00:00Z");
  db.exec("COMMIT");
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  resetThrottle(db);
  const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "networth" }, body: JSON.stringify({ email: "advisor@demo.local", password: "Demo@2026-Advisor" }) });
  cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
});
afterAll(() => { server.close(); db.close(); for (const s of ["", "-wal", "-shm"]) fs.rmSync(tmp + s, { force: true }); });

describe("a 5,000-holding book", () => {
  it("serves the full state well inside the 300 ms budget", async () => {
    await fetch(base + STATE, { headers: { cookie } }); // warm-up
    const ms: number[] = [];
    for (let i = 0; i < 12; i++) { const t = performance.now(); const r = await fetch(base + STATE, { headers: { cookie } }); await r.arrayBuffer(); ms.push(performance.now() - t); }
    ms.sort((a, b) => a - b);
    expect(ms[Math.floor(ms.length * 0.95)]).toBeLessThan(300);
  });

  it("compresses the large JSON when the client accepts gzip (a 6 MB payload shrinks to a fraction)", async () => {
    // fetch() would decode transparently, so ask for the raw bytes with an explicit header and read the encoding
    const http = await import("node:http");
    const { port } = server.address() as AddressInfo;
    const { enc, wire } = await new Promise<{ enc: string | undefined; wire: Buffer }>((resolve, reject) => {
      http.get({ port, path: STATE, headers: { cookie, "Accept-Encoding": "gzip" } }, (res) => {
        const parts: Buffer[] = []; res.on("data", (c) => parts.push(c)); res.on("end", () => resolve({ enc: res.headers["content-encoding"], wire: Buffer.concat(parts) })); res.on("error", reject);
      }).on("error", reject);
    });
    expect(enc).toBe("gzip");
    const plain = zlib.gunzipSync(wire).length;
    expect(plain).toBeGreaterThan(1_000_000);
    expect(wire.length).toBeLessThan(plain / 4);
  });
});
