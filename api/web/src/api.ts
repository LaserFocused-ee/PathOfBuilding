// The few HTTP API calls the browser view makes. Same origin only; the session cookie set by
// POST /v1/session authenticates them (see README.md, "Server contract").

export interface BuildMeta {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const BUILD_ID = /^[a-f0-9]{16}$/;

export function isBuildId(id: string | null): id is string {
  return id !== null && BUILD_ID.test(id);
}

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const reply = await response.json().catch(() => undefined);
  if (!response.ok || !reply?.ok) {
    const error = reply?.error ?? {};
    throw new ApiError(
      response.status,
      String(error.code ?? "http_" + response.status),
      String(error.message ?? response.statusText),
    );
  }
  return reply.result as T;
}

export const api = {
  /** Exchanges the API token for a session cookie once; the token is not kept by the page. */
  signIn: (token: string) => call<void>("POST", "/v1/session", undefined, { authorization: `Bearer ${token}` }),
  builds: () => call<{ builds: BuildMeta[] }>("GET", "/v1/builds").then((r) => r.builds),
  build: (id: string) => call<{ build: BuildMeta }>("GET", `/v1/builds/${id}`).then((r) => r.build),
  code: (id: string) => call<{ code: string; revision: number }>("GET", `/v1/builds/${id}/code`),
  saveCode: async (id: string, code: string, baseRevision: number): Promise<{ revision: number } | "stale"> => {
    try {
      const r = await call<{ build: BuildMeta }>("PUT", `/v1/builds/${id}/code`, { code, baseRevision });
      return { revision: r.build.revision };
    } catch (error) {
      if (error instanceof ApiError && error.code === "stale_revision") return "stale";
      throw error;
    }
  },
};
