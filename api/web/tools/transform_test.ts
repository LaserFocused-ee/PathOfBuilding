import { assertEquals } from "@std/assert";
import { rewriteCompound } from "./transform.ts";

Deno.test("rewrites the three upstream forms", () => {
  const src = [
    "\t\t\t\tcount += 1",
    '\turl ..= "/" .. encodedLeague',
    '\turl ..= "/" .. tradeHelpers.B64GzipEncode(queryJson)',
  ].join("\n");
  const { text, rewrites } = rewriteCompound(src);
  assertEquals(text.split("\n"), [
    "\t\t\t\tcount = count + (1)",
    '\turl = url .. ("/" .. encodedLeague)',
    '\turl = url .. ("/" .. tradeHelpers.B64GzipEncode(queryJson))',
  ]);
  assertEquals(rewrites.map((r) => r.line), [1, 2, 3]);
});

Deno.test("keeps operator precedence and handles fields, indexes and CRLF", () => {
  const { text } = rewriteCompound("a.b -= x + 1\r\nt[i] *= 2\n");
  assertEquals(text, "a.b = a.b - (x + 1)\r\nt[i] = t[i] * (2)\n");
});

Deno.test("leaves comparisons, strings, comments and long strings alone", () => {
  const src = [
    "if a == b then end",
    'local s = x:match("^(%d+)%s*=%s*(%d+)$")',
    "-- count += 1",
    "local doc = [[",
    "count += 1",
    "]]",
    "x = y",
  ].join("\n");
  const { text, rewrites } = rewriteCompound(src);
  assertEquals(text, src);
  assertEquals(rewrites, []);
});
