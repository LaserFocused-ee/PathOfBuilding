import { assertEquals, assertRejects } from "@std/assert";
import { ApiError } from "./api.ts";
import { endSession, sessionGate } from "./session.ts";

const refused = () => new ApiError(401, "unauthorized", "sign in");

// A server whose session ended (a restart): every call gets 401 until the page signs in again.
function setup() {
  const server = { session: false, calls: 0 };
  let asks = 0;
  let submit!: () => void;
  const withSession = sessionGate(() => {
    asks++;
    return new Promise<void>((done) =>
      submit = () => {
        server.session = true;
        done();
      }
    );
  });
  const call = (value: string) => () => {
    if (++server.calls > 20) return Promise.reject(new Error("resent without end")); // ends a runaway loop
    return server.session ? Promise.resolve(value) : Promise.reject(refused());
  };
  return { server, withSession, call, asks: () => asks, submit: () => submit() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

Deno.test("two calls refused at once share one sign-in and both finish", async () => {
  const { withSession, call, asks, submit } = setup();
  const save = withSession(call("saved"));
  const probe = withSession(call("probed"));
  await tick();
  assertEquals(asks(), 1);
  submit();
  assertEquals(await Promise.all([save, probe]), ["saved", "probed"]);
});

Deno.test("a refusal for a request sent before a finished sign-in is just sent again", async () => {
  const { withSession, server, asks, submit } = setup();
  let release!: () => void;
  let sent = 0;
  const slow = withSession(() => {
    if (sent++ > 0) return server.session ? Promise.resolve("ok") : Promise.reject(refused());
    return new Promise<string>((_, fail) => release = () => fail(refused())); // sent without a session
  });
  const other = withSession(() => server.session ? Promise.resolve("other") : Promise.reject(refused()));
  await tick();
  submit();
  assertEquals(await other, "other");
  release(); // the slow request was sent without a session and is refused after the sign-in
  assertEquals(await slow, "ok");
  assertEquals(asks(), 1);
});

Deno.test("other errors pass through without a sign-in", async () => {
  const { withSession, asks } = setup();
  await assertRejects(() => withSession(() => Promise.reject(new ApiError(500, "internal", "boom"))), ApiError, "boom");
  assertEquals(asks(), 0);
});

Deno.test("sign-out leaves only when the session is over", async () => {
  assertEquals(await endSession(() => Promise.resolve()), true);
  assertEquals(await endSession(() => Promise.reject(refused())), true);
  assertEquals(await endSession(() => Promise.reject(new ApiError(500, "internal", "boom"))), false);
  assertEquals(await endSession(() => Promise.reject(new TypeError("Failed to fetch"))), false);
});

Deno.test("a second lapse asks again", async () => {
  const { withSession, call, server, asks, submit } = setup();
  const first = withSession(call("one"));
  await tick();
  submit();
  assertEquals(await first, "one");
  server.session = false; // the server restarted again
  const second = withSession(call("two"));
  await tick();
  assertEquals(asks(), 2);
  submit();
  assertEquals(await second, "two");
});
