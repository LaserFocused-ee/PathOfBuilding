import { assertEquals, assertRejects } from "@std/assert";
import { api, ApiError, isBuildId, isToolBuild } from "./api.ts";

interface Seen {
  path: string;
  init: RequestInit;
}

async function withFetch(reply: Response, run: (seen: Seen[]) => Promise<void>) {
  const original = globalThis.fetch;
  const seen: Seen[] = [];
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ path: String(input), init: init ?? {} });
    return Promise.resolve(reply);
  };
  try {
    await run(seen);
  } finally {
    globalThis.fetch = original;
  }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const ID = "0123456789abcdef";

Deno.test("saveCode sends the base revision and returns the new revision and name", async () => {
  const build = { id: ID, name: "N", revision: 4, createdAt: "x", updatedAt: "x" };
  await withFetch(json(200, { ok: true, result: { build } }), async (seen) => {
    assertEquals(await api.saveCode(ID, "CODE", 3), { revision: 4, name: "N" });
    assertEquals(seen.length, 1);
    assertEquals(seen[0].path, `/v1/builds/${ID}/code`);
    assertEquals(seen[0].init.method, "PUT");
    assertEquals(seen[0].init.credentials, "same-origin");
    assertEquals(new Headers(seen[0].init.headers).get("content-type"), "application/json");
    assertEquals(seen[0].init.body, '{"code":"CODE","baseRevision":3}');
  });
});

Deno.test("saveCode maps a stale revision to 'stale'", async () => {
  const reply = json(409, { ok: false, error: { code: "stale_revision", message: "m" } });
  await withFetch(reply, async () => {
    assertEquals(await api.saveCode(ID, "CODE", 3), "stale");
  });
});

Deno.test("a refused request throws ApiError with the server's code and message", async () => {
  const reply = json(404, { ok: false, error: { code: "not_found", message: "Route not found" } });
  await withFetch(reply, async () => {
    const error = await assertRejects(() => api.saveCode(ID, "CODE", 3), ApiError);
    assertEquals(error.status, 404);
    assertEquals(error.code, "not_found");
    assertEquals(error.message, "Route not found");
    assertEquals(error.permanent, true);
  });
});

Deno.test("ApiError.permanent is true only for refusals that would repeat", () => {
  const permanent: Record<number, boolean> = {
    400: true,
    404: true,
    413: true,
    422: true,
    401: false,
    408: false,
    409: false,
    429: false,
    500: false,
    503: false,
  };
  for (const [status, expected] of Object.entries(permanent)) {
    assertEquals(new ApiError(Number(status), "c", "m").permanent, expected, status);
  }
});

Deno.test("isBuildId accepts 16 lowercase hex characters only", () => {
  assertEquals(isBuildId(ID), true);
  for (const id of ["0123456789ABCDEF", "0123456789abcde", "0123456789abcdef0", null, "../etc/passwd", ""]) {
    assertEquals(isBuildId(id), false, String(id));
  }
});

Deno.test("fetch posts the url and headers, and the body only when there is one", async () => {
  const result = { status: 200, headers: {}, body: "" };
  await withFetch(json(200, { ok: true, result }), async (seen) => {
    await api.fetch("https://example.test/a", { accept: "x" }, undefined);
    assertEquals(seen[0].path, "/v1/fetch");
    assertEquals(seen[0].init.method, "POST");
    assertEquals(seen[0].init.body, '{"url":"https://example.test/a","headers":{"accept":"x"}}');
  });
  await withFetch(json(200, { ok: true, result }), async (seen) => {
    await api.fetch("https://example.test/a", { accept: "x" }, "b");
    assertEquals(seen[0].init.body, '{"url":"https://example.test/a","headers":{"accept":"x"},"body":"b"}');
  });
});

Deno.test("signOut sends DELETE /v1/session", async () => {
  await withFetch(new Response(null, { status: 204 }), async (seen) => {
    await api.signOut();
    assertEquals(seen[0].path, "/v1/session");
    assertEquals(seen[0].init.method, "DELETE");
  });
});

Deno.test("isToolBuild picks only names that start with ref: or advisor:", () => {
  for (const name of ["ref: Righteous Fire", "advisor: watch copy", " REF:x", "Advisor:"]) {
    assertEquals(isToolBuild(name), true, name);
  }
  for (const name of ["Talupoegg", "my ref: notes", "reference build", "advisor plan", ""]) {
    assertEquals(isToolBuild(name), false, name);
  }
});
