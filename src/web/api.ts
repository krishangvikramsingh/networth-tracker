export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: Array<{ field: string; message: string }>) { super(message); }
}
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

async function call<T>(method: string, url: string, body?: unknown, opts: { idem?: string; text?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "networth" };
  if (body !== undefined) headers["Content-Type"] = opts.text ? "text/csv" : "application/json";
  if (opts.idem) headers["Idempotency-Key"] = opts.idem;
  let res: Response;
  try {
    res = await fetch(url, { method, headers, credentials: "same-origin", body: body === undefined ? undefined : opts.text ? (body as string) : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check that it is running and try again.");
  }
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error ?? `Request failed (${res.status})`, (data as any)?.details);
  return data as T;
}
export const api = {
  get: <T = any>(u: string) => call<T>("GET", u),
  post: <T = any>(u: string, b?: unknown, idem?: string) => call<T>("POST", u, b ?? {}, { idem }),
  patch: <T = any>(u: string, b: unknown) => call<T>("PATCH", u, b),
  put: <T = any>(u: string, b: unknown) => call<T>("PUT", u, b),
  del: <T = any>(u: string) => call<T>("DELETE", u),
  postText: <T = any>(u: string, text: string) => call<T>("POST", u, text, { text: true }),
  newKey,
};
