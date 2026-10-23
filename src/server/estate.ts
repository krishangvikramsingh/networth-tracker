import { z } from "zod";
import type { DB } from "./db";
import { nowISO, tx, uid } from "./db";
import { audit } from "./audit";
import { HttpError, requireClient } from "./service";
import { nominationCoverage, type Nominee } from "../shared/estate";

const text = (max: number) => z.string().trim().max(max);
export const nomineeIn = z.object({
  name: text(100).min(1, "Name is required."), relationship: text(60).min(1, "Relationship is required."),
  contact: text(160).nullable().optional(), notes: text(500).nullable().optional(),
});
export const nominationIn = z.object({
  entity: z.enum(["holding", "policy"]), entityId: z.string().min(1),
  shares: z.array(z.object({ nomineeId: z.string().min(1), shareBps: z.number().int().min(1, "A share must be above zero.").max(10000) })).max(10),
}).superRefine((v, ctx) => {
  const total = v.shares.reduce((a, s) => a + s.shareBps, 0);
  if (total > 10000) ctx.addIssue({ code: "custom", path: ["shares"], message: `Shares add up to ${(total / 100).toFixed(2)}%, which is more than 100%.` });
  if (new Set(v.shares.map((s) => s.nomineeId)).size !== v.shares.length) ctx.addIssue({ code: "custom", path: ["shares"], message: "List each nominee once per asset." });
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(422, r.error.issues[0]?.message ?? "Invalid input.", r.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
  return r.data;
}
const nomineeRow = (r: any): Nominee => ({ id: r.id, clientId: r.client_id, name: r.name, relationship: r.relationship, contact: r.contact, notes: r.notes });

export function loadEstate(db: DB, cid: string) {
  const data = requireClient(db, cid);
  const { nominees, nominations } = data;
  return { nominees, nominations, coverage: nominationCoverage(data.holdings, data.policies, nominees, nominations) };
}

function getNominee(db: DB, cid: string, id: string): Nominee {
  const r = db.prepare("SELECT * FROM nominees WHERE client_id = ? AND id = ?").get(cid, id) as any;
  if (!r) throw new HttpError(404, "Nominee not found.");
  return nomineeRow(r);
}

export function addNominee(db: DB, cid: string, body: unknown, actor: { id: string } | undefined): Nominee {
  requireClient(db, cid);
  const v = parse(nomineeIn, body), id = uid("nom"), t = nowISO();
  tx(db, () => {
    db.prepare("INSERT INTO nominees (id, client_id, name, relationship, contact, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(id, cid, v.name, v.relationship, v.contact ?? null, v.notes ?? null, t, t);
    audit(db, { clientId: cid, userId: actor?.id, entity: "nominees", entityId: id, action: "create", summary: `Added nominee "${v.name}" (${v.relationship})` });
  });
  return getNominee(db, cid, id);
}

export function updateNominee(db: DB, cid: string, id: string, body: unknown, actor: { id: string } | undefined): Nominee {
  const cur = getNominee(db, cid, id);
  const v = parse(nomineeIn, { ...cur, ...(body as object) });
  tx(db, () => {
    db.prepare("UPDATE nominees SET name=?, relationship=?, contact=?, notes=?, updated_at=? WHERE id=? AND client_id=?").run(v.name, v.relationship, v.contact ?? null, v.notes ?? null, nowISO(), id, cid);
    audit(db, { clientId: cid, userId: actor?.id, entity: "nominees", entityId: id, action: "update", summary: `Updated nominee "${v.name}"`, before: cur, after: v });
  });
  return getNominee(db, cid, id);
}

/** Removing a nominee removes their shares; the affected assets drop back to partial or not recorded, which the page then shows. */
export function removeNominee(db: DB, cid: string, id: string, actor: { id: string } | undefined) {
  const cur = getNominee(db, cid, id);
  const n = (db.prepare("SELECT COUNT(*) AS n FROM nominations WHERE nominee_id = ?").get(id) as { n: number }).n;
  tx(db, () => {
    db.prepare("DELETE FROM nominees WHERE id = ? AND client_id = ?").run(id, cid);
    audit(db, { clientId: cid, userId: actor?.id, entity: "nominees", entityId: id, action: "delete", summary: `Removed nominee "${cur.name}" and ${n} nomination share(s)`, before: cur });
  });
}

/** Replace all shares for one asset. An empty list clears the record (back to "not recorded"). */
export function setNomination(db: DB, cid: string, body: unknown, actor: { id: string } | undefined) {
  const data = requireClient(db, cid);
  const v = parse(nominationIn, body);
  const exists = v.entity === "holding" ? data.holdings.some((h) => h.id === v.entityId && !h.archived) : data.policies.some((p) => p.id === v.entityId && !p.archived);
  if (!exists) throw new HttpError(404, "Asset not found for this client.");
  for (const s of v.shares) getNominee(db, cid, s.nomineeId);
  tx(db, () => {
    db.prepare("DELETE FROM nominations WHERE client_id = ? AND entity = ? AND entity_id = ?").run(cid, v.entity, v.entityId);
    for (const s of v.shares) db.prepare("INSERT INTO nominations (id, client_id, entity, entity_id, nominee_id, share_bps, created_at) VALUES (?,?,?,?,?,?,?)").run(uid("nmn"), cid, v.entity, v.entityId, s.nomineeId, s.shareBps, nowISO());
    const name = v.entity === "holding" ? data.holdings.find((h) => h.id === v.entityId)!.name : v.entityId;
    audit(db, { clientId: cid, userId: actor?.id, entity: "nominations", entityId: v.entityId, action: v.shares.length ? "update" : "clear", summary: v.shares.length ? `Recorded nomination for "${name}" (${v.shares.length} nominee(s))` : `Cleared nomination record for "${name}"`, after: v.shares });
  });
}
