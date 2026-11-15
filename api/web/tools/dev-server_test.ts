import { assertEquals } from "@std/assert";
import { allowed, staticHeaders } from "./dev-server.ts";

const port = 8740;
const cases: [string, string, Record<string, string>, boolean][] = [
  ["good host GET", "GET", { host: `127.0.0.1:${port}` }, true],
  ["localhost GET", "GET", { host: `localhost:${port}` }, true],
  ["good host POST, matching origin", "POST", { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` }, true],
  ["POST without origin", "POST", { host: `127.0.0.1:${port}` }, false],
  ["POST from another origin", "POST", { host: `127.0.0.1:${port}`, origin: "http://evil.test" }, false],
  ["foreign host", "GET", { host: `evil.test:${port}` }, false],
  ["other port", "GET", { host: "127.0.0.1:1234" }, false],
  ["localhost, other port", "GET", { host: "localhost:1234" }, false],
  ["localhost POST, matching origin on another port", "POST", {
    host: `localhost:${port}`,
    origin: "http://localhost:1234",
  }, false],
];

for (const [name, method, headers, want] of cases) {
  Deno.test(`allowed: ${name}`, () => {
    // Request refuses to set Host and Origin in some runtimes; build the object with the headers it reads.
    const req = { method, headers: new Headers(headers) } as Request;
    assertEquals(allowed(req, port), want);
  });
}

Deno.test("static responses send no referrer (README serve contract)", () => {
  assertEquals(staticHeaders("/index.html", new Headers()).get("referrer-policy"), "no-referrer");
});
