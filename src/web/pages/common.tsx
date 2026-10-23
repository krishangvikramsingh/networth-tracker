import { useState, type ReactNode } from "react";
import { useApp } from "../store";
import { Badge, Banner, Icon, ICONS } from "../ui";
import { api } from "../api";
import type { Holding } from "@shared/types";
import { ASSET_CLASS_LABEL, INSTRUMENT_LABEL } from "@shared/taxonomy";
import { formatCompact } from "@shared/money";

export function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  const { canWrite } = useApp();
  return <button className="btn primary" onClick={onClick} disabled={!canWrite} title={canWrite ? undefined : "Read-only role"}><Icon d={ICONS.plus} />{children}</button>;
}
export function useSnapshot() {
  const { clientId, run } = useApp();
  return () => run(() => api.post(`/api/clients/${clientId}/snapshots`, {}), "Net-worth snapshot recorded");
}
export function ClassBadge({ h }: { h: Pick<Holding, "assetClass" | "classOverride" | "classificationStatus" | "classificationMethod" | "classificationReason"> }) {
  const c = h.classOverride ?? h.assetClass;
  const tone = c == null ? "serious" : h.classificationStatus === "confirmed" ? "good" : "warn";
  return (<span title={`${h.classificationReason} (${h.classificationMethod.replace("_", " ")})`}>
    <Badge tone={tone}>{c ? ASSET_CLASS_LABEL[c] : "Needs review"}</Badge>{c && h.classificationStatus === "provisional" && <span className="small muted"> provisional</span>}</span>);
}
export const instrLabel = (t: Holding["instrumentType"]) => INSTRUMENT_LABEL[t];
export function ProvisionalNote({ show, children }: { show: boolean; children: ReactNode }) { return show ? <Banner tone="warn">{children}</Banner> : null; }
export function useToggle(init = false): [boolean, () => void] { const [v, s] = useState(init); return [v, () => s(!v)]; }
export { formatCompact };
