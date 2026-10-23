import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import type { ClientData } from "@shared/types";
import type { Evaluation } from "@shared/evaluate";
import type { AlertRow } from "../server/alerts";

export interface AppUser { id: string; email: string; name: string; role: "admin" | "viewer" }
export interface ClientSummary { id: string; name: string; kind: "live" | "case"; description: string | null; isDemo: boolean }
export interface AppState { data: ClientData; evaluation: Evaluation; alerts: AlertRow[]; audit: Array<{ id: string; at: string; entity: string; action: string; summary: string; user: string | null }>; asOf: string; serverTime: string }
export interface Toast { id: number; kind: "ok" | "err" | "info"; text: string }

interface Ctx {
  user: AppUser | null; setUser: (u: AppUser | null) => void; authChecked: boolean;
  clients: ClientSummary[]; clientId: string | null; setClientId: (id: string) => void; reloadClients: () => Promise<void>;
  state: AppState | null; loading: boolean; error: string | null; reload: () => Promise<void>;
  canWrite: boolean; toast: (text: string, kind?: Toast["kind"]) => void; toasts: Toast[];
  run: <T>(fn: () => Promise<T>, okMsg?: string) => Promise<T | undefined>;
}
const C = createContext<Ctx>(null as any);
export const useApp = () => useContext(C);
export function useEval() { const s = useApp().state; return s!; }

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientId, setCid] = useState<string | null>(() => { try { return localStorage.getItem("nw.client"); } catch { return null; } });
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const toast = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "err" ? 7000 : 3800);
  }, []);

  useEffect(() => { api.get("/api/auth/me").then((r) => setUser(r.user)).catch(() => {}).finally(() => setAuthChecked(true)); }, []);

  const reloadClients = useCallback(async () => {
    const r = await api.get<{ clients: ClientSummary[] }>("/api/clients");
    setClients(r.clients);
    setCid((cur) => (cur && r.clients.some((c) => c.id === cur) ? cur : r.clients[0]?.id ?? null));
  }, []);
  useEffect(() => { if (user) reloadClients().catch((e) => setError(e.message)); }, [user, reloadClients]);

  const setClientId = useCallback((id: string) => { setCid(id); try { localStorage.setItem("nw.client", id); } catch { /* storage unavailable */ } }, []);

  const reload = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try { setState(await api.get<AppState>(`/api/clients/${clientId}/state`)); setError(null); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) { setUser(null); return; }
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }, [clientId]);
  useEffect(() => { setState(null); if (user && clientId) reload(); }, [user, clientId, reload]);

  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string) => {
    try { const r = await fn(); await reload(); if (okMsg) toast(okMsg); return r; }
    catch (e) { toast(e instanceof Error ? e.message : "Something went wrong", "err"); return undefined; }
  }, [reload, toast]);

  const value = useMemo<Ctx>(() => ({ user, setUser, authChecked, clients, clientId, setClientId, reloadClients, state, loading, error, reload, canWrite: user?.role === "admin", toast, toasts, run }),
    [user, authChecked, clients, clientId, setClientId, reloadClients, state, loading, error, reload, toast, toasts, run]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
