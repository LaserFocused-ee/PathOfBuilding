import { assertEquals } from "@std/assert";
import { BuildSync, type SyncApi, type SyncState, type SyncView } from "./sync.ts";

// A fake server holding one build, and a fake view (the Path of Building UI) holding a code.
function setup() {
  const server = { code: "A", revision: 1, saves: [] as Array<{ code: string; base: number }>, loads: 0 };
  const api: SyncApi = {
    load: () => {
      server.loads++;
      return Promise.resolve({ code: server.code, revision: server.revision });
    },
    save: (code, base) => {
      server.saves.push({ code, base });
      if (base !== server.revision) return Promise.resolve("stale" as const);
      server.code = code;
      server.revision++;
      return Promise.resolve({ revision: server.revision });
    },
    revision: () => Promise.resolve(server.revision),
  };
  const view = { code: "", loads: [] as string[] };
  const ui: SyncView = {
    load: (code) => {
      view.code = code;
      view.loads.push(code);
      return Promise.resolve();
    },
    read: () => Promise.resolve(view.code),
    content: (code) => Promise.resolve(code),
  };
  const states: SyncState[] = [];
  const sync = new BuildSync(api, ui, (s) => states.push(s));
  // Another client (the API or an AI agent) changes the build on the server.
  const remoteEdit = (code: string) => {
    server.code = code;
    server.revision++;
    return server.revision;
  };
  return { server, view, sync, states, remoteEdit, api, ui };
}

Deno.test("loads the server's build and revision", async () => {
  const { sync, view } = setup();
  await sync.start();
  assertEquals(view.code, "A");
  assertEquals(sync.state, { kind: "synced", revision: 1 });
});

Deno.test("reloads on a newer revision another client made", async () => {
  const { sync, view, remoteEdit } = setup();
  await sync.start();
  await sync.serverRevision(remoteEdit("B"));
  assertEquals(view.code, "B");
  assertEquals(sync.state, { kind: "synced", revision: 2 });
});

Deno.test("writes an edit back with its base revision once it is stable for a tick", async () => {
  const { sync, view, server } = setup();
  await sync.start();
  view.code = "A1";
  await sync.poll(); // first sight: wait
  assertEquals(server.saves, []);
  view.code = "A2";
  await sync.poll(); // still changing: wait
  assertEquals(server.saves, []);
  await sync.poll(); // stable: write
  assertEquals(server.saves, [{ code: "A2", base: 1 }]);
  assertEquals(sync.state, { kind: "synced", revision: 2 });
});

Deno.test("its own write's event never reloads the view", async () => {
  const { sync, view, server } = setup();
  await sync.start();
  view.code = "A1";
  await sync.poll();
  await sync.poll();
  const loadsBefore = server.loads;
  await sync.serverRevision(2); // the event for the write above
  await sync.serverRevision(1); // a late hello frame
  assertEquals(server.loads, loadsBefore);
  assertEquals(view.loads, ["A"]);
  await sync.poll();
  await sync.poll();
  assertEquals(server.saves.length, 1); // and no write loop either
});

Deno.test("a refused write becomes a conflict; reload takes the server's version", async () => {
  const { sync, view, server, remoteEdit } = setup();
  await sync.start();
  remoteEdit("B"); // the server moved on; the event has not arrived yet
  view.code = "A1";
  await sync.poll();
  await sync.poll();
  assertEquals(sync.state, { kind: "conflict", revision: 1, serverRevision: 2 });
  await sync.poll(); // no retries while in conflict
  assertEquals(server.saves.length, 1);
  await sync.resolve("reload");
  assertEquals(view.code, "B");
  assertEquals(sync.state, { kind: "synced", revision: 2 });
});

Deno.test("overwrite after a conflict writes the page's version on the server's revision", async () => {
  const { sync, view, server, remoteEdit } = setup();
  await sync.start();
  remoteEdit("B");
  view.code = "A1";
  await sync.poll();
  await sync.poll();
  await sync.resolve("overwrite");
  assertEquals(server.saves.at(-1), { code: "A1", base: 2 });
  assertEquals(server.code, "A1");
  assertEquals(sync.state, { kind: "synced", revision: 3 });
});

Deno.test("a remote change while the page has unsent edits is a conflict, not a silent reload", async () => {
  const { sync, view, remoteEdit } = setup();
  await sync.start();
  view.code = "A1";
  await sync.serverRevision(remoteEdit("B"));
  assertEquals(view.code, "A1");
  assertEquals(sync.state, { kind: "conflict", revision: 1, serverRevision: 2 });
});

Deno.test("a failed write is retried on the next stable tick", async () => {
  const { sync, view, server, api } = setup();
  await sync.start();
  const save = server.saves;
  let fail = true;
  const realSave = api.save;
  api.save = (code, base) => fail ? Promise.reject(new Error("network down")) : realSave(code, base);
  view.code = "A1";
  await sync.poll();
  await sync.poll();
  assertEquals(sync.state, { kind: "save_failed", revision: 1, reason: "network down", retrying: true });
  fail = false;
  await sync.poll();
  assertEquals(save, [{ code: "A1", base: 1 }]);
  assertEquals(sync.state, { kind: "synced", revision: 2 });
});

Deno.test("a load failure reports the reason", async () => {
  const { sync, api } = setup();
  api.load = () => Promise.reject(new Error("not_found: no build abc"));
  await sync.start();
  assertEquals(sync.state, { kind: "failed", reason: "not_found: no build abc" });
});

Deno.test("a queued event waits for a write still in flight", async () => {
  const { sync, view, server, api, states } = setup();
  await sync.start();
  let finish!: () => void;
  const realSave = api.save;
  api.save = (code, base) => new Promise((done) => finish = () => done(realSave(code, base)));
  view.code = "A1";
  await sync.poll();
  const writing = sync.poll();
  await Promise.resolve();
  const event = sync.serverRevision(2); // the write's own event, early
  await new Promise((r) => setTimeout(r, 0));
  finish();
  await Promise.all([writing, event]);
  assertEquals(server.loads, 1);
  assertEquals(states.filter((s) => s.kind === "conflict"), []); // run at once, the event would see a conflict
  assertEquals(sync.state, { kind: "synced", revision: 2 });
});

Deno.test("the baseline is the view's own export, so loading never writes", async () => {
  const { sync, view, server, ui } = setup();
  ui.read = () => Promise.resolve(view.code + "~"); // Path of Building re-serialises what it loaded
  await sync.start();
  await sync.poll();
  await sync.poll();
  await sync.poll();
  assertEquals(server.saves, []);
});

Deno.test("view state (tab, tree zoom) is not an edit", async () => {
  const { sync, view, server, ui } = setup();
  ui.content = (code) => Promise.resolve(code.replace(/@.*$/, "")); // "@..." stands for view state
  await sync.start();
  view.code = "A@items-tab";
  await sync.poll();
  await sync.poll();
  assertEquals(server.saves, []);
  assertEquals(sync.unsaved, false);
  view.code = "A1@items-tab";
  await sync.poll();
  await sync.poll();
  assertEquals(server.saves, [{ code: "A1@items-tab", base: 1 }]); // the full code is what gets written
});

Deno.test("a deleted build stops following: no reload, no write", async () => {
  const { sync, view, server, remoteEdit } = setup();
  await sync.start();
  await sync.deleted();
  await sync.serverRevision(remoteEdit("B"));
  view.code = "A1";
  await sync.poll();
  await sync.poll();
  assertEquals(server.loads, 1);
  assertEquals(server.saves, []);
  assertEquals(sync.state, { kind: "deleted" });
});

Deno.test("a load the view rejects after a remote change is never followed by a write", async () => {
  const { sync, view, server, remoteEdit, ui } = setup();
  await sync.start();
  ui.load = () => Promise.reject(new Error("not a valid build code"));
  await sync.serverRevision(remoteEdit("B"));
  assertEquals(sync.state, { kind: "failed", reason: "not a valid build code" });
  view.code = "A1";
  await sync.poll();
  await sync.poll();
  assertEquals(server.saves, []);
});

Deno.test("a permanent refusal is not retried until the build changes again", async () => {
  const { sync, view, server, api } = setup();
  await sync.start();
  const realSave = api.save;
  let refuse = true;
  api.save = (code, base) => {
    if (!refuse) return realSave(code, base);
    server.saves.push({ code, base });
    return Promise.reject(Object.assign(new Error("too large"), { permanent: true }));
  };
  view.code = "A1";
  await sync.poll();
  await sync.poll();
  assertEquals(sync.state, { kind: "save_failed", revision: 1, reason: "too large", retrying: false });
  await sync.poll();
  await sync.poll();
  assertEquals(server.saves.length, 1);
  refuse = false;
  view.code = "A2";
  await sync.poll();
  await sync.poll();
  assertEquals(sync.state, { kind: "synced", revision: 2 });
});

Deno.test("repeated transient failures back off", async () => {
  const { sync, view, server, api } = setup();
  await sync.start();
  api.save = (code, base) => {
    server.saves.push({ code, base });
    return Promise.reject(new Error("network down"));
  };
  view.code = "A1";
  await sync.poll();
  for (let i = 0; i < 12; i++) await sync.poll();
  // attempts on ticks 1, 2, 4, 8 (waits of 0, 1, 3, 7 ticks between them)
  assertEquals(server.saves.length, 4);
});

Deno.test("a read that throws stops syncing with the reason instead of showing Saved", async () => {
  const { sync, view, ui, server } = setup();
  await sync.start();
  ui.read = () => Promise.reject(new Error("getBuildCode: not in BUILD mode"));
  view.code = "A1";
  await sync.poll();
  assertEquals(sync.state, { kind: "failed", reason: "getBuildCode: not in BUILD mode" });
  assertEquals(server.saves, []);
});

Deno.test("unsaved is true from the first sight of an edit until it is written", async () => {
  const { sync, view } = setup();
  await sync.start();
  assertEquals(sync.unsaved, false);
  view.code = "A1";
  await sync.poll();
  assertEquals(sync.unsaved, true);
  await sync.poll();
  assertEquals(sync.unsaved, false);
});
