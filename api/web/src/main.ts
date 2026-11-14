// Browser view: `/` lists the server's builds, `/?build=<id>` opens one in the real Path of Building UI
// (pob-web's driver) and keeps it in step with the server (sync.ts).
import { Driver } from "pob-driver/driver";
import { accountNote, profileStandIn } from "./account-import.ts";
import { api, ApiError, type BuildMeta, isBuildId } from "./api.ts";
import { buildContent } from "./content.ts";
import { safeExternalUrl } from "./links.ts";
import { endSession, sessionGate } from "./session.ts";
import { BuildSync, type SyncState } from "./sync.ts";

declare const __POB_ASSETS__: string;
// Path of Building opens links (Ctrl+click in notes, help links) through window.open with whatever text
// the build holds. Builds can come from anyone, so only http and https leave the page, without an opener.
const openWindow = globalThis.open.bind(globalThis);
globalThis.open = (url?: string | URL, target?: string) => {
  const href = safeExternalUrl(url);
  if (href === null) {
    console.warn("Refused to open a link that is not http or https");
    return null;
  }
  return openWindow(href, target ?? "_blank", "noopener,noreferrer");
};
const POLL_MS = 2000; // ponytail: polls getBuildCode for edits; a save hook in boot.lua if it shows in frame time
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

function show(id: "list" | "signin" | "view") {
  for (const el of document.querySelectorAll<HTMLElement>("[data-screen]")) el.hidden = el.dataset.screen !== id;
}

function text(el: HTMLElement, value: string) {
  el.textContent = value;
}

// Sign-in: shown whenever the server answers 401 (session.ts runs one at a time). The token is sent once
// and not stored by the page.
function signIn(): Promise<void> {
  const interrupted = document.querySelector<HTMLElement>("[data-screen]:not([hidden])")?.dataset.screen;
  show("signin");
  const form = $("#signin-form") as HTMLFormElement;
  const input = $("#signin-token") as HTMLInputElement;
  const error = $("#signin-error");
  input.focus();
  return new Promise((resolve) => {
    form.onsubmit = async (event) => {
      event.preventDefault();
      text(error, "");
      try {
        await api.signIn(input.value.trim());
        input.value = "";
        if (interrupted === "list" || interrupted === "view") show(interrupted);
        resolve();
      } catch (e) {
        text(error, e instanceof ApiError && e.status === 401 ? "That token was refused." : `Sign-in failed: ${e}`);
        input.focus();
      }
    };
  });
}

const withSession = sessionGate(signIn);

// Leaves only once the server has ended the session; otherwise says so and stays.
async function signOut(button: HTMLElement) {
  if (await endSession(api.signOut)) return location.assign("/");
  text(button, "Sign-out failed: still signed in. Try again");
}

async function listPage(note = "") {
  show("list");
  $("#signout-list").onclick = (e) => void signOut(e.currentTarget as HTMLElement);
  const status = $("#list-status");
  const list = $("#build-list");
  text(status, "Loading builds…");
  let builds: BuildMeta[];
  try {
    builds = await withSession(() => api.builds());
  } catch (e) {
    text(status, `Could not load the build list: ${e instanceof Error ? e.message : e}`);
    return;
  }
  show("list");
  text(status, builds.length ? note : "No builds stored yet. Create or import one through the API.");
  list.replaceChildren(...builds.map((b) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `?build=${encodeURIComponent(b.id)}`;
    a.textContent = b.name;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `revision ${b.revision} · ${new Date(b.updatedAt).toLocaleString()}`;
    li.append(a, meta);
    return li;
  }));
}

function describe(state: SyncState): string {
  switch (state.kind) {
    case "loading":
      return "Loading build…";
    case "failed":
      return `Stopped: ${state.reason}`;
    case "synced":
      return `Saved · revision ${state.revision}`;
    case "saving":
      return "Saving…";
    case "save_failed":
      return state.retrying
        ? `Not saved (${state.reason}); retrying`
        : `Not saved: the server refused this version (${state.reason}). Change the build or reload the page.`;
    case "conflict":
      return `The build changed on the server (revision ${state.serverRevision}) while you were editing.`;
    case "released":
      return "Path of Building has another build open; nothing there is saved to this build. Try again reopens it.";
    case "deleted":
      return "This build was deleted on the server.";
  }
}

async function viewPage(id: string) {
  show("view");
  $("#signout-view").onclick = (e) => void signOut(e.currentTarget as HTMLElement); // unsent edits: beforeunload asks
  const state = $("#sync-state");
  const conn = $("#connection");
  const conflict = $("#conflict");
  text(state, "Loading build…");

  let meta: BuildMeta;
  try {
    meta = await withSession(() => api.build(id));
  } catch (e) {
    text(state, `Load failed: ${e instanceof Error ? e.message : e}`);
    return;
  }
  show("view");
  // The server's name for the build, shown in the bar and in Path of Building's "Current build".
  let name = "";
  const showName = (value: string) => {
    name = value.replace(/[\r\n]+/g, " ");
    text($("#build-name"), name);
    document.title = `${name} · Path of Building`;
  };
  showName(meta.name);

  // Frames the driver has drawn; a loaded build counts as shown once frames after the load were drawn.
  let frames = 0;
  const frameWaiters: Array<{ at: number; done: () => void }> = [];
  const drawn = (count: number) =>
    new Promise<void>((done) => {
      frameWaiters.push({ at: frames + count, done });
      setTimeout(done, 15_000); // ponytail: a hidden tab draws no frames; never wait on it forever
    });

  const driver = new Driver("release", __POB_ASSETS__, {
    onError: (error) => {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      const shown = $("#driver-error");
      text(shown, `Path of Building reported an error: ${message.slice(0, 300)}`);
      shown.hidden = false;
    },
    onFrame: () => {
      frames++;
      for (let i = frameWaiters.length - 1; i >= 0; i--) {
        if (frames >= frameWaiters[i].at) frameWaiters.splice(i, 1)[0].done();
      }
    },
    // Path of Building's own downloads (public-profile character import, build links) go through the
    // server's allow-listed fetch route; the browser never calls those sites itself (account-import.ts).
    onFetch: async (url, headers, body) => {
      const local = profileStandIn(url);
      if (local) return { ...local, error: undefined };
      try {
        const result = await withSession(() => api.fetch(url, headers, body));
        const note = accountNote(url, result);
        if (url.startsWith("https://www.pathofexile.com/character-window/")) {
          text($("#import-note"), note ?? "");
          $("#import-note").hidden = note === null;
        }
        return { ...result, error: undefined };
      } catch (e) {
        return { body: "", status: undefined, headers: {}, error: e instanceof Error ? e.message : String(e) };
      }
    },
    onOAuthAuthorize: () =>
      Promise.reject(
        new Error(
          "Signing in with a Path of Exile account is not available here: import from a public profile with the account name instead.",
        ),
      ),
    onOAuthLogout: () => {},
    onTitleChange: () => {},
  });
  try {
    await driver.start({
      userDirectory: "Path of Building",
      settingsRootElement: "PathOfBuilding",
      cloudflareKvPrefix: "",
      cloudflareKvAccessToken: undefined,
      cloudflareKvUserNamespace: undefined,
    });
    await driver.attachToDOM($("#window"));
    // The canvas takes every key (Path of Building uses Tab itself). F6, the usual key for moving
    // between page regions, leaves it for the bar so keyboard focus is never trapped.
    $("#window").addEventListener("keydown", (e) => {
      if (e.key !== "F6") return;
      e.preventDefault();
      e.stopPropagation();
      $("#home").focus();
    }, { capture: true });
  } catch (e) {
    text(state, `Path of Building could not start in this browser: ${e instanceof Error ? e.message : e}`);
    return;
  }

  const sync = new BuildSync(
    {
      // A session that ends mid-edit asks for the token again and carries on, edits kept.
      load: async () => {
        const [code, latest] = await withSession(() => Promise.all([api.code(id), api.build(id)]));
        showName(latest.name);
        return code;
      },
      save: async (code, base) => {
        const saved = await withSession(() => api.saveCode(id, code, base));
        // ponytail: the bar follows a rename that an overwrite kept; Path of Building's own name field updates on the next load
        if (saved !== "stale") showName(saved.name);
        return saved;
      },
      revision: () => withSession(() => api.build(id)).then((b) => b.revision),
    },
    {
      // Path of Building applies a build at once and draws it over the next frames; `shown` waits for them.
      load: (code) => driver.loadBuildFromCode(`${name}\n${code.trim()}`), // named: patches/pob-web-load-build.patch
      // "!not-loaded": Path of Building has another build open (patches/pob-web-load-build.patch).
      read: async () => {
        const code = await driver.getBuildCode();
        return code === "!not-loaded" ? null : code;
      },
      content: buildContent,
      shown: () => drawn(2),
    },
    (s) => {
      text(state, describe(s));
      conflict.hidden = s.kind !== "conflict";
      $("#retry").hidden = s.kind !== "failed" && s.kind !== "released";
      state.dataset.kind = s.kind;
    },
  );
  $("#conflict-reload").onclick = () => sync.resolve("reload");
  $("#conflict-overwrite").onclick = () => sync.resolve("overwrite");
  $("#retry").onclick = () => sync.start();

  // ponytail: an edit made in the last tick before leaving is not yet seen; the 2 s tick bounds that window
  addEventListener("beforeunload", (event) => {
    if (sync.unsaved) event.preventDefault();
  });
  await sync.start();
  setInterval(() => sync.poll(), POLL_MS);
  follow(id, sync, conn);
}

// Follows the build's event stream. EventSource reconnects by itself after a dropped connection;
// a refused one (closed) is retried here with a growing delay. The first frame of every connection
// carries the current revision, so changes missed while disconnected are picked up.
function follow(id: string, sync: BuildSync, conn: HTMLElement, delay = 1000) {
  const source = new EventSource(`/v1/builds/${encodeURIComponent(id)}/events`);
  const onRevision = (event: MessageEvent) => {
    text(conn, "Live");
    conn.dataset.kind = "live";
    delay = 1000;
    let revision: number;
    try {
      revision = Number(JSON.parse(event.data).revision);
    } catch {
      return console.warn("Ignored an event the page cannot read");
    }
    if (Number.isInteger(revision)) void sync.serverRevision(revision);
  };
  source.addEventListener("hello", onRevision);
  source.addEventListener("change", onRevision);
  source.addEventListener("deleted", () => {
    source.close();
    void sync.deleted();
  });
  source.onerror = () => {
    text(conn, "Disconnected · reconnecting");
    conn.dataset.kind = "down";
    if (source.readyState !== EventSource.CLOSED) return;
    // Refused (EventSource does not say why): a lapsed session asks for the token, then reconnect.
    setTimeout(async () => {
      try {
        await withSession(() => api.build(id));
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return void sync.deleted(); // deleted while away
        // not reachable: the retry below tries again
      }
      follow(id, sync, conn, Math.min(delay * 2, 30_000));
    }, delay);
  };
}

const id = new URLSearchParams(location.search).get("build");
if (id === null) void listPage();
else if (isBuildId(id)) void viewPage(id);
else void listPage("That link does not name a build. Pick one below.");
