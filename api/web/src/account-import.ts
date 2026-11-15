// Path of Building's character import (public profile) in the browser view. Its downloads go through the
// server's relay (POST /v1/fetch), with two page-side pieces:
// - The profile page, which Path of Building reads only to learn the account name's exact case, is not
//   reachable from the server (the site screens it). The page answers that request itself with the name
//   as typed, so the exact case is the user's to give.
// - A refused or empty character request says plainly that the name must match exactly; a rate limit says
//   to wait, a site failure says so. Nothing is retried.

import { ApiError } from "./api.ts";

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
  const status = result.status;
  if (status === 401 || status === 403 || status === 404) {
    return `Path of Exile refused the request (${status}). ${EXACT_NAME}`;
  }
  if (status === 429) return SLOW_DOWN;
  if (status >= 500) return `Path of Exile failed to answer (${status}). Try again later.`;
  if (status >= 400) return `Path of Exile refused the request (${status}).`;
  if (match[1] === "get-characters" && result.body.trim() === "[]") {
    return `Path of Exile returned no characters for that account. ${EXACT_NAME}`;
  }
  return null;
}

export const SLOW_DOWN = "Path of Exile asked for fewer requests. Wait a minute before importing again.";

type Send = (url: string, headers: Record<string, string>, body: string | undefined) => Promise<FetchResult>;

/**
 * Path of Building's downloads through the page (the driver's onFetch): the profile page answered here,
 * everything else by `send` (POST /v1/fetch). A character request clears the note above the view when it
 * starts and sets it from its answer; a relay error reaches Path of Building as its error text.
 */
export function pageFetch(send: Send, note: (text: string | null) => void) {
  return async (url: string, headers: Record<string, string>, body: string | undefined): Promise<{
    body: string;
    status: number | undefined;
    headers: Record<string, string>;
    error: string | undefined;
  }> => {
    const local = profileStandIn(url);
    if (local) return { ...local, error: undefined };
    const character = CHARACTER_WINDOW.test(url);
    if (character) note(null);
    try {
      const result = await send(url, headers, body);
      if (character) note(accountNote(url, result));
      return { ...result, error: undefined };
    } catch (e) {
      // The relay answers a game-site 429 (or its own hold on the host) as rate_limited.
      if (character && e instanceof ApiError && e.code === "rate_limited") note(SLOW_DOWN);
      return { body: "", status: undefined, headers: {}, error: e instanceof Error ? e.message : String(e) };
    }
  };
}
