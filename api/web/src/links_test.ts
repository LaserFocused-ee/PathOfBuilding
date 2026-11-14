import { assertEquals } from "@std/assert";
import { safeExternalUrl } from "./links.ts";

Deno.test("safeExternalUrl allows http and https only", () => {
  for (const url of ["http://a", "https://a", "HTTPS://A"]) assertEquals(safeExternalUrl(url), url);
  assertEquals(safeExternalUrl(new URL("https://a/b")), "https://a/b");
  for (
    const url of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "/relative",
      "",
      undefined,
      " https://a",
    ]
  ) {
    assertEquals(safeExternalUrl(url), null, String(url));
  }
});
