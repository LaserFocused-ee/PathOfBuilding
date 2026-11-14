// Browser view: `/` lists the server's builds, `/?build=<id>` opens one in the real Path of Building UI
// (pob-web's driver) and keeps it in step with the server (sync.ts).
import { Driver } from "pob-driver/driver";
import { api, ApiError, type BuildMeta, isBuildId } from "./api.ts";
import { BuildSync, type SyncState } from "./sync.ts";

declare const __POB_ASSETS__: string;
const POLL_MS = 2000; // ponytail: polls getBuildCode for edits; a save hook in boot.lua if it shows in frame time
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

function show(id: "list" | "signin" | "view") {
  for (const el of document.querySelectorAll<HTMLElement>("[data-screen]")) el.hidden = el.dataset.screen !== id;
}

function text(el: HTMLElement, value: string) {
  el.textContent = value;
}

// Sign-in: shown whenever the server answers 401. The token is sent once and not stored by the page.
function signIn(): Promise<void> {
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
        resolve();
      } catch (e) {
        text(error, e instanceof ApiError && e.status === 401 ? "That token was refused." : `Sign-in failed: ${e}`);
        input.focus();
      }
    };
  });
}

async function withSession<T>(fn: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) throw e;
      await signIn();
    }
  }
}

async function listPage(note = "") {
  show("list");
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
      return `Load failed: ${state.reason}`;
    case "synced":
      return `Saved · revision ${state.revision}`;
    case "saving":
      return "Saving…";
    case "save_failed":
      return `Not saved (${state.reason}); retrying`;
    case "conflict":
      return `The build changed on the server (revision ${state.serverRevision}) while you were editing.`;
    case "deleted":
      return "This build was deleted on the server.";
  }
}

async function viewPage(id: string) {
  show("view");
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
  text($("#build-name"), meta.name);
  document.title = `${meta.name} · Path of Building`;

  const driver = new Driver("release", __POB_ASSETS__, {
    onError: (error) => console.error(error),
    onFrame: () => {},
    // ponytail: Path of Building's own network features (link and character import) are off in the
    // browser; imports go through the server's API. A same-origin proxy route would turn them on.
    onFetch: () =>
      Promise.resolve({
        body: "",
        status: undefined,
        headers: {},
        error: "Network access is not available in the browser view; import through the API.",
      }),
    onOAuthAuthorize: () => Promise.reject(new Error("Account sign-in is not available in the browser view.")),
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
      load: () => api.code(id),
      save: (code, base) => api.saveCode(id, code, base),
      revision: () => api.build(id).then((b) => b.revision),
    },
    { load: (code) => driver.loadBuildFromCode(code).then(() => {}), read: () => driver.getBuildCode() },
    (s) => {
      text(state, describe(s));
      conflict.hidden = s.kind !== "conflict";
      state.dataset.kind = s.kind;
    },
  );
  $("#conflict-reload").onclick = () => sync.resolve("reload");
  $("#conflict-overwrite").onclick = () => sync.resolve("overwrite");
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
    void sync.serverRevision(Number(JSON.parse(event.data).revision));
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
    if (source.readyState === EventSource.CLOSED) {
      setTimeout(() => follow(id, sync, conn, Math.min(delay * 2, 30_000)), delay);
    }
  };
}

const id = new URLSearchParams(location.search).get("build");
if (id === null) void listPage();
else if (isBuildId(id)) void viewPage(id);
else void listPage("That link does not name a build. Pick one below.");
