// Path of Building's character import (public profile) in the browser view. Its downloads go through the
// server's relay (POST /v1/fetch), with two page-side pieces:
// - The profile page, which Path of Building reads only to learn the account name's exact case, is not
//   reachable from the server (the site screens it). The page answers that request itself with the name
//   as typed, so the exact case is the user's to give.
// - A refused or empty character request says plainly that the name must match exactly. Nothing is retried.

export interface FetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const GAME_HOST = "www.pathofexile.com"; // the relay matches on host name, so this does too
const PROFILE_PATH = "/account/view-profile/";
const CHARACTER_WINDOW =
  /^https:\/\/www\.pathofexile\.com\/character-window\/(get-characters|get-passive-skills|get-items)\?/;
export const EXACT_NAME = "The account name must match exactly: upper and lower case and the #number included.";

/**
 * The answer to any profile-page request, made here: never null for a profile URL, so none reaches the relay
 * (400 unless it is exactly one name segment). Null for any other URL; those go to the relay.
 */
export function profileStandIn(url: string): FetchResult | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== GAME_HOST || !parsed.pathname.startsWith(PROFILE_PATH)) return null;
  const refused = { status: 400, headers: {}, body: "" };
  const segment = parsed.pathname.slice(PROFILE_PATH.length);
  if (!segment || segment.includes("/") || parsed.search || parsed.hash) return refused;
  let name: string;
  try {
    name = decodeURIComponent(segment);
  } catch {
    return refused;
  }
  if (name.includes("/")) return refused;
  // Path of Building reads the name from a ".../view-profile/<name>/characters" link, "#" written as "-".
  const link = `/account/view-profile/${name.replaceAll("#", "-")}/characters`;
  return { status: 200, headers: { "content-type": "text/html" }, body: `<a href="${link}">characters</a>` };
}

/** What the bar says after a character request: null when there is nothing to say. */
export function accountNote(url: string, result: FetchResult): string | null {
  const match = CHARACTER_WINDOW.exec(url);
  if (!match) return null;
  if (result.status >= 400) return `Path of Exile refused the request (${result.status}). ${EXACT_NAME}`;
  if (match[1] === "get-characters" && result.body.trim() === "[]") {
    return `Path of Exile returned no characters for that account. ${EXACT_NAME}`;
  }
  return null;
}
