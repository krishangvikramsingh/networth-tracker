import type { DB } from "./db";
import { nowISO, tx, uid } from "./db";
import { audit } from "./audit";
import { HttpError, asOfDate, requireClient, setTargets } from "./service";
import { PROFILES, RISK_QUESTIONS, assessRisk, modelTargets, type Answers, type ProfileKey } from "../shared/riskprofile";

export interface StoredAssessment {
  id: string; clientId: string; date: string; answers: Answers; toleranceScore: number; capacityScore: number; profile: ProfileKey;
  limitedBy: string; createdAt: string; appliedAt: string | null;
}
const fromRow = (r: any): StoredAssessment => ({
  id: r.id, clientId: r.client_id, date: r.date, answers: JSON.parse(r.answers), toleranceScore: r.tolerance_score, capacityScore: r.capacity_score,
  profile: r.profile, limitedBy: r.limited_by, createdAt: r.created_at, appliedAt: r.applied_at,
});

export function listAssessments(db: DB, cid: string, limit = 20): StoredAssessment[] {
  requireClient(db, cid);
  return (db.prepare("SELECT * FROM risk_assessments WHERE client_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(cid, limit) as any[]).map(fromRow);
}

/** Validate, score on the server (the client's preview is advisory only) and store a complete assessment. */
export function recordAssessment(db: DB, cid: string, body: unknown, actor: { id: string } | undefined): StoredAssessment {
  requireClient(db, cid);
  const raw = (body as { answers?: unknown } | null)?.answers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(422, "Send answers as an object of question id to option number.");
  const answers = raw as Answers;
  const missing = RISK_QUESTIONS.filter((q) => answers[q.id] == null);
  if (missing.length) throw new HttpError(422, `Answer every question (${missing.length} left).`, missing.map((q) => ({ field: q.id, message: "Choose an option." })));
  let res;
  try { res = assessRisk(answers); } catch (e) { throw new HttpError(422, e instanceof Error ? e.message : "Invalid answers."); }
  if (!res.complete || !res.profile) throw new HttpError(422, "The questionnaire is incomplete.");
  const row = {
    id: uid("risk"), client_id: cid, date: asOfDate(), answers: JSON.stringify(Object.fromEntries(RISK_QUESTIONS.map((q) => [q.id, answers[q.id]]))),
    tolerance_score: res.tolerance.score!, capacity_score: res.capacity.score!, profile: res.profile, limited_by: res.limitedBy ?? "equal", created_by: actor?.id ?? null, created_at: nowISO(),
  };
  tx(db, () => {
    db.prepare("INSERT INTO risk_assessments (id, client_id, date, answers, tolerance_score, capacity_score, profile, limited_by, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(row.id, row.client_id, row.date, row.answers, row.tolerance_score, row.capacity_score, row.profile, row.limited_by, row.created_by, row.created_at);
    audit(db, { clientId: cid, userId: actor?.id, entity: "risk_profile", entityId: row.id, action: "create", summary: `Recorded risk profile: ${PROFILES[res.profile!].label} (willingness ${row.tolerance_score}, capacity ${row.capacity_score})`, after: { profile: res.profile, limitedBy: res.limitedBy } });
  });
  return fromRow({ ...row, applied_at: null });
}

/** Replace the target allocation with the model portfolio for the latest profile. Goes through setTargets, so it is validated and audited. */
export function applyProfileTargets(db: DB, cid: string, actor: { id: string } | undefined) {
  const [latest] = listAssessments(db, cid, 1);
  if (!latest) throw new HttpError(409, "Complete the risk questionnaire first.");
  const targets = modelTargets(latest.profile);
  tx(db, () => {
    setTargets(db, cid, targets, actor);
    db.prepare("UPDATE risk_assessments SET applied_at = ? WHERE id = ?").run(nowISO(), latest.id);
    audit(db, { clientId: cid, userId: actor?.id, entity: "risk_profile", entityId: latest.id, action: "apply", summary: `Applied the ${PROFILES[latest.profile].label} model portfolio as the target allocation (illustrative; policy not marked as validated)` });
  });
  return { profile: latest.profile, targets };
}
