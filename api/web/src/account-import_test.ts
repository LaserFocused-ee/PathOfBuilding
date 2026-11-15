import { assertEquals, assertStringIncludes } from "@std/assert";
import { accountNote, EXACT_NAME, type FetchResult, pageFetch, profileStandIn, SLOW_DOWN } from "./account-import.ts";
import { ApiError } from "./api.ts";

const site = "https://www.pathofexile.com/";

Deno.test("the profile-page name check is answered with the name as typed", () => {
  const answer = profileStandIn(`${site}account/view-profile/Some_Name%231234`);
  assertEquals(answer?.status, 200);
  // Path of Building's own reading: body:match("/view%-profile/([^/]+)/characters"), then the last "-" or "#" -> "#"
  const read = answer!.body.match(/\/view-profile\/([^/]+)\/characters/)![1].replace(/(.*)[#-]/, "$1#");
  assertEquals(read, "Some_Name#1234");
});

Deno.test("a hyphen inside the name survives Path of Building's reading", () => {
  const answer = profileStandIn(`${site}account/view-profile/my-name%231234`)!;
  const read = answer.body.match(/\/view-profile\/([^/]+)\/characters/)![1].replace(/(.*)[#-]/, "$1#");
  assertEquals(read, "my-name#1234");
});

Deno.test("only the profile page is answered here; everything else goes to the relay", () => {
  assertEquals(profileStandIn(`${site}character-window/get-characters?accountName=a%231&realm=pc`), null);
  assertEquals(profileStandIn(`https://pathofexile.com.evil.test/account/view-profile/a%231`), null);
  assertEquals(profileStandIn(`${site}account/view-profile/a%2Fb`)?.status, 400);
  assertEquals(profileStandIn(`${site}account/view-profile/%E0%A4%A`)?.status, 400);
});

Deno.test("every profile-page URL is answered here, so none reaches the relay", () => {
  // Path of Building encodes only "#" in the name, so a typed "/", "?" or a second segment changes the URL's shape.
  for (
    const odd of [
      "a%231/characters",
      "a&b/c%231",
      "a&b?c%231",
      "a%231#x",
      "",
    ]
  ) assertEquals(profileStandIn(`${site}account/view-profile/${odd}`)?.status, 400, odd);
  assertEquals(profileStandIn(`http://WWW.pathofexile.com/account/view-profile/a%231`)?.status, 200);
});

Deno.test("a refused character request says the name must match exactly, with the status", () => {
  const note = accountNote(`${site}character-window/get-items?accountName=a%231&character=x&realm=pc`, {
    status: 404,
    headers: {},
    body: "",
  });
  assertStringIncludes(note!, "(404)");
  assertStringIncludes(note!, EXACT_NAME);
});

Deno.test("an empty character list says the name must match exactly; a good one says nothing", () => {
  const url = `${site}character-window/get-characters?accountName=a%231&realm=pc`;
  assertStringIncludes(accountNote(url, { status: 200, headers: {}, body: "[]" })!, EXACT_NAME);
  assertEquals(accountNote(url, { status: 200, headers: {}, body: '[{"name":"x"}]' }), null);
  assertEquals(accountNote(`${site}account/view-profile/a`, { status: 403, headers: {}, body: "" }), null);
  // An empty answer is a note only for the character list; a tree or item list may be empty.
  for (const kind of ["get-passive-skills", "get-items"]) {
    const other = `${site}character-window/${kind}?accountName=a%231&character=x&realm=pc`;
    assertEquals(accountNote(other, { status: 200, headers: {}, body: "[]" }), null, kind);
  }
});

Deno.test("a look-alike host gets no note", () => {
  for (
    const host of [
      "https://www.pathofexile.com.example.test",
      "https://wwwxpathofexile.com",
      "http://www.pathofexile.com",
    ]
  ) {
    const url = `${host}/character-window/get-characters?accountName=a%231&realm=pc`;
    assertEquals(accountNote(url, { status: 404, headers: {}, body: "" }), null, host);
  }
  // The game URL carried in another host's query is not a character request.
  const carried = `https://example.test/?u=${site}character-window/get-characters?accountName=a%231&realm=pc`;
  assertEquals(accountNote(carried, { status: 404, headers: {}, body: "" }), null);
});

Deno.test("only 401, 403 and 404 name the account name; 429 says wait, 5xx says the site failed", () => {
  const url = `${site}character-window/get-passive-skills?accountName=a%231&character=x&realm=pc`;
  const note = (status: number) => accountNote(url, { status, headers: {}, body: "" })!;
  for (const status of [401, 403, 404]) assertStringIncludes(note(status), EXACT_NAME);
  assertEquals(note(429), SLOW_DOWN);
  for (const status of [400, 429, 500, 503]) assertEquals(note(status).includes(EXACT_NAME), false);
  assertStringIncludes(note(503), "failed to answer (503)");
  assertEquals(note(500), "Path of Exile failed to answer (500). Try again later.");
  assertStringIncludes(note(400), "(400)");
  // Not a character request: nothing to say, whatever the answer.
  assertEquals(accountNote("https://pobb.in/abc", { status: 404, headers: {}, body: "" }), null);
  assertEquals(
    accountNote(`${site}character-window/get-stash?accountName=a`, { status: 403, headers: {}, body: "" }),
    null,
  );
});

Deno.test("Path of Building's downloads: no profile URL is sent; notes clear at the start and follow the answer", async () => {
  const sent: Array<[string, Record<string, string>, string | undefined]> = [];
  const notes: (string | null)[] = [];
  let answer: () => Promise<FetchResult> = () => Promise.resolve({ status: 200, headers: {}, body: "[]" });
  const onFetch = pageFetch((url, headers, body) => {
    sent.push([url, headers, body]);
    return answer();
  }, (n) => notes.push(n));
  for (const odd of ["a%231", "a%231/characters", "a&b/c%231", "a&b?c%231", "a%231#x", ""]) {
    const result = await onFetch(`${site}account/view-profile/${odd}`, {}, undefined);
    assertEquals(result.error, undefined);
  }
  assertEquals(sent, []);
  assertEquals(notes, []);

  const chars = `${site}character-window/get-characters?accountName=a%231&realm=pc`;
  answer = () => Promise.resolve({ status: 403, headers: {}, body: "" });
  const refused = await onFetch(chars, { accept: "*/*" }, "x=1");
  assertEquals([refused.status, refused.error], [403, undefined]);
  answer = () => Promise.resolve({ status: 200, headers: {}, body: '[{"name":"x"}]' });
  await onFetch(chars, {}, undefined);
  answer = () => Promise.reject(new ApiError(429, "rate_limited", "www.pathofexile.com is limiting requests"));
  const limited = await onFetch(chars, {}, undefined);
  assertEquals([limited.status, limited.error], [undefined, "www.pathofexile.com is limiting requests"]);
  const link = "https://pobb.in/abc";
  answer = () => Promise.resolve({ status: 404, headers: {}, body: "" });
  await onFetch(link, {}, undefined);
  answer = () => Promise.reject(new Error("offline"));
  assertEquals((await onFetch(link, {}, undefined)).error, "offline");

  assertEquals(sent.map((s) => s[0]), [chars, chars, chars, link, link]);
  assertEquals(sent[0], [chars, { accept: "*/*" }, "x=1"]); // passed through as Path of Building gave them
  assertEquals(notes.length, 6); // each character request: cleared at its start, then its answer
  assertEquals([notes[0], notes[2], notes[3], notes[4], notes[5]], [null, null, null, null, SLOW_DOWN]);
  assertStringIncludes(notes[1]!, "(403)");
});

Deno.test("relay errors: only rate_limited on a character request says wait", async () => {
  const notes: (string | null)[] = [];
  let error: Error = new ApiError(502, "upstream_fetch_failed", "the site did not answer");
  const onFetch = pageFetch(() => Promise.reject(error), (n) => notes.push(n));
  const chars = `${site}character-window/get-characters?accountName=a%231&realm=pc`;
  assertEquals((await onFetch(chars, {}, undefined)).error, "the site did not answer");
  assertEquals(notes, [null]); // cleared at the start, nothing after another relay error
  error = new ApiError(429, "rate_limited", "limited");
  assertEquals((await onFetch("https://pobb.in/abc", {}, undefined)).error, "limited");
  assertEquals(notes, [null]); // not a character request: no note
});
