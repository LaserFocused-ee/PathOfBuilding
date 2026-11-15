import { assertEquals } from "@std/assert";
import { hasLoweredCall, loweredFiles } from "./lowered-calls.ts";

Deno.test("catches the statement form", () => {
  assertEquals(hasLoweredCall("(n=this.f)==null||n.call(this,{a:1})"), true);
});

Deno.test("catches the value form", () => {
  assertEquals(hasLoweredCall("const r=(n$_1=this.f)==null?void 0:n$_1.call(this,{a:1})"), true);
});

Deno.test("leaves a native optional call alone", () => {
  assertEquals(hasLoweredCall("this.f?.(x)"), false);
});

Deno.test("leaves a call whose receiver is not this alone", () => {
  assertEquals(hasLoweredCall("a==null||b.call(c,d)"), false);
});

Deno.test("reads subdirectories; only .js files count", () => {
  const dir = new URL("./testdata/lowered", import.meta.url).pathname;
  assertEquals(loweredFiles(dir), [`${dir}/nested/lowered.js`]);
});
