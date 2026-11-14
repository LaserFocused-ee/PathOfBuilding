// The page's session with the server. Sessions live in the server's memory, so every server restart
// signs the page out, and a page with an unsent edit then gets 401 on its save and its event stream at
// once: all of them wait for one sign-in, and none is left hanging.
import { ApiError } from "./api.ts";

const unauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;

/** `ask` shows the sign-in form and resolves after a good sign-in; it is never run twice at once. */
export function sessionGate(ask: () => Promise<void>) {
  let pending: Promise<void> | undefined;
  let signIns = 0;
  return async function withSession<T>(fn: () => Promise<T>): Promise<T> {
    for (;;) {
      const seen = signIns;
      try {
        return await fn();
      } catch (e) {
        if (!unauthorized(e)) throw e;
        if (signIns !== seen) continue; // sent before a sign-in that has finished since: just send again
        pending ??= ask().then(() => void signIns++).finally(() => pending = undefined);
        await pending;
      }
    }
  };
}

/** Ends the session; true when it is over (204, or 401: there was none), false when it may still be active. */
export async function endSession(request: () => Promise<void>): Promise<boolean> {
  try {
    await request();
    return true;
  } catch (e) {
    return unauthorized(e);
  }
}
