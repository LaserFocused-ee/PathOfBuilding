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

const PROFILE = /^https:\/\/www\.pathofexile\.com\/account\/view-profile\/([^/?#]+)$/;
const CHARACTER_WINDOW =
  /^https:\/\/www\.pathofexile\.com\/character-window\/(get-characters|get-passive-skills|get-items)\?/;
export const EXACT_NAME = "The account name must match exactly: upper and lower case and the #number included.";

/** The answer to the profile-page request, made here; null for any other URL (those go to the relay). */
export function profileStandIn(url: string): FetchResult | null {
  const match = PROFILE.exec(url);
  if (!match) return null;
  let name: string;
  try {
    name = decodeURIComponent(match[1]);
  } catch {
    return { status: 400, headers: {}, body: "" };
  }
  if (name.includes("/")) return { status: 400, headers: {}, body: "" };
  // Path of Building reads the name from a ".../view-profile/<name>/characters" link, "#" written as "-".
  const link = `/account/view-profile/${name.replaceAll("#", "-")}/characters`;
  return { status: 200, headers: { "content-type": "text/html" }, body: `<a href="${link}">characters</a>` };
}

/** What the bar says after a character request: null when there is nothing to say. */
export function accountNote(url: string, result: FetchResult): string | null {
  const match = CHARACTER_WINDOW.exec(url);
  if (!match) return null;
  if (result.status >= 400) {
    const challenged = Object.entries(result.headers)
      .some(([k, v]) => k.toLowerCase() === "cf-mitigated" && v === "challenge");
    return `Path of Exile refused the request (${result.status}${challenged ? ", its bot check" : ""}). ${EXACT_NAME}`;
  }
  if (match[1] === "get-characters" && result.body.trim() === "[]") {
    return `Path of Exile returned no characters for that account. ${EXACT_NAME}`;
  }
  return null;
}
