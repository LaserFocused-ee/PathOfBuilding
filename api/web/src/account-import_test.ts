import { assertEquals, assertStringIncludes } from "@std/assert";
import { accountNote, EXACT_NAME, profileStandIn } from "./account-import.ts";

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
});
