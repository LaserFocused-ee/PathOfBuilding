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
  const view = { code: "" as string | null, loads: [] as string[] }; // null: another build is open
  const ui: SyncView = {
    load: (code) => {
      view.code = code;
      view.loads.push(code);
      return Promise.resolve();
    },
    read: () => Promise.resolve(view.code),
    content: (code) => Promise.resolve(code),
    shown: () => Promise.resolve(),
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
  await sync.poll();
  await sync.poll();
  assertEquals(server.saves.length, 1); // the new baseline is the content, not the code with view state
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

Deno.test("input while the loaded build is being drawn is an edit, not part of the baseline", async () => {
  const { sync, view, server, ui } = setup();
  ui.shown = () => {
    view.code = "A1"; // the user clicks before the frames are drawn
    return Promise.resolve();
  };
  await sync.start();
  await sync.poll();
  await sync.poll();
  assertEquals(server.saves, [{ code: "A1", base: 1 }]);
});

Deno.test("a failed revision lookup after a refused write keeps the edit and retries", async () => {
  const { sync, view, server, api, remoteEdit } = setup();
  await sync.start();
  remoteEdit("B");
  const realRevision = api.revision;
  api.revision = () => Promise.reject(new Error("network down"));
  view.code = "A1";
  await sync.poll();
  await sync.poll();
  assertEquals(sync.state, { kind: "save_failed", revision: 1, reason: "network down", retrying: true });
  assertEquals(sync.unsaved, true);
  await sync.start(); // a retry while the server is still unreachable stops, but never loads over the edit
  assertEquals(sync.state, { kind: "failed", reason: "network down" });
  assertEquals(view.code, "A1");
  assertEquals(server.loads, 1);
  api.revision = realRevision;
  await sync.start(); // "Try again"
  assertEquals(sync.state, { kind: "conflict", revision: 1, serverRevision: 2 });
  assertEquals(view.code, "A1");
});

Deno.test("keep mine: a failed write is retried on the revision the user chose, without asking again", async () => {
  const { sync, view, server, api, remoteEdit } = setup();
  await sync.start();
  view.code = "A1";
  await sync.poll();
  await sync.serverRevision(remoteEdit("B"));
  assertEquals(sync.state, { kind: "conflict", revision: 1, serverRevision: 2 });
  const realSave = api.save;
  api.save = () => Promise.reject(new Error("network down"));
  await sync.resolve("overwrite");
  assertEquals(sync.state, { kind: "save_failed", revision: 1, reason: "network down", retrying: true });
  assertEquals(sync.unsaved, true);
  api.save = realSave;
  await sync.poll();
  assertEquals(server.saves.at(-1), { code: "A1", base: 2 });
  assertEquals(sync.state, { kind: "synced", revision: 3 });
});

Deno.test("keep mine with a failed write: an event repeating the chosen revision does not ask again", async () => {
  const { sync, view, server, api, remoteEdit } = setup();
  await sync.start();
  view.code = "A1";
  await sync.poll();
  await sync.serverRevision(remoteEdit("B"));
  const realSave = api.save;
  api.save = () => Promise.reject(new Error("network down"));
  await sync.resolve("overwrite");
  api.save = realSave;
  await sync.serverRevision(2); // the stream's first frame after a reconnect
  assertEquals(sync.state, { kind: "save_failed", revision: 1, reason: "network down", retrying: true });
  await sync.poll();
  assertEquals(server.saves.at(-1), { code: "A1", base: 2 });
  assertEquals(sync.state, { kind: "synced", revision: 3 });
});

Deno.test("keep mine's chosen revision: try again writes on it; a good write or a reload drops it", async () => {
  const { sync, view, server, api, ui, remoteEdit } = setup();
  const keepMineThenFailWrite = async () => {
    view.code = view.code + "+";
    await sync.poll();
    await sync.serverRevision(remoteEdit("R" + server.revision));
    const realSave = api.save;
    api.save = () => Promise.reject(new Error("network down"));
    await sync.resolve("overwrite");
    api.save = realSave;
  };
  await sync.start();
  // Try again after a stop writes on the chosen revision (2), not on the one loaded (1).
  await keepMineThenFailWrite();
  const realRead = ui.read;
  ui.read = () => Promise.reject(new Error("busy"));
  await sync.poll();
  assertEquals(sync.state, { kind: "failed", reason: "busy" });
  ui.read = realRead;
  await sync.start();
  assertEquals(server.saves.at(-1), { code: "A+", base: 2 });
  assertEquals(sync.state, { kind: "synced", revision: 3 });
  // After that good write the next edit goes on the new revision.
  view.code = "A++";
  await sync.poll();
  await sync.poll();
  assertEquals(server.saves.at(-1), { code: "A++", base: 3 });
  assertEquals(sync.state, { kind: "synced", revision: 4 });
  // After "Reload" in a later conflict, the next edit goes on the reloaded revision.
  await keepMineThenFailWrite(); // chosen revision 5
  await sync.serverRevision(remoteEdit("C")); // 6: a newer change, asked again
  assertEquals(sync.state.kind, "conflict");
  await sync.resolve("reload");
  assertEquals(sync.state, { kind: "synced", revision: 6 });
  view.code = "C1";
  await sync.poll();
  await sync.poll();
  assertEquals(server.saves.at(-1), { code: "C1", base: 6 });
  assertEquals(sync.state, { kind: "synced", revision: 7 });
});

Deno.test("try again after a stop never loads over an edit: conflict if the server moved, else write", async () => {
  const { sync, view, server, ui, remoteEdit } = setup();
  await sync.start();
  const realRead = ui.read;
  ui.read = () => Promise.reject(new Error("busy"));
  view.code = "A1";
  await sync.poll();
  assertEquals(sync.state, { kind: "failed", reason: "busy" });
  assertEquals(sync.unsaved, true);
  ui.read = realRead;
  await sync.start(); // the server has not moved: the edit is written
  assertEquals(server.saves, [{ code: "A1", base: 1 }]);
  assertEquals(sync.state, { kind: "synced", revision: 2 });
  ui.read = () => Promise.reject(new Error("busy"));
  view.code = "A2";
  await sync.poll();
  ui.read = realRead;
  remoteEdit("B");
  await sync.start(); // the server moved: the user chooses
  assertEquals(sync.state, { kind: "conflict", revision: 2, serverRevision: 3 });
  assertEquals(view.code, "A2");
  assertEquals(server.loads, 1);
});

Deno.test("a tick that arrives while one is still running is skipped", async () => {
  const { sync, view, ui } = setup();
  await sync.start();
  let reads = 0;
  let release!: () => void;
  ui.read = () => {
    reads++;
    return new Promise((done) => release = () => done(view.code));
  };
  const first = sync.poll();
  await Promise.resolve();
  const second = sync.poll();
  await new Promise((r) => setTimeout(r, 0));
  release();
  await Promise.all([first, second]);
  assertEquals(reads, 1);
});

Deno.test("back-off starts again after a successful write", async () => {
  const { sync, view, server, api } = setup();
  await sync.start();
  const realSave = api.save;
  let fail = true;
  api.save = (code, base) => {
    if (!fail) return realSave(code, base);
    server.saves.push({ code, base });
    return Promise.reject(new Error("network down"));
  };
  view.code = "A1";
  await sync.poll(); // first sight
  await sync.poll(); // attempt 1 fails: next attempt at once
  await sync.poll(); // attempt 2 fails: wait one tick
  await sync.poll(); // waiting
  fail = false;
  await sync.poll(); // attempt 3 succeeds
  assertEquals(sync.state, { kind: "synced", revision: 2 });
  fail = true;
  view.code = "A2";
  await sync.poll(); // first sight
  await sync.poll(); // fails
  const before = server.saves.length;
  await sync.poll(); // the first retry after a success is at once, as after the first failure
  assertEquals(server.saves.length, before + 1);
});

Deno.test("another build open in the view: nothing is written, and try again loads this build", async () => {
  const { sync, view, server } = setup();
  await sync.start();
  view.code = "A1";
  await sync.poll(); // an edit was on its way
  view.code = null; // Back, then New: Path of Building holds another build
  await sync.poll();
  assertEquals(sync.state, { kind: "released", lost: true }); // the edit seen once is said to be lost
  assertEquals(sync.unsaved, false);
  await sync.poll();
  await sync.serverRevision(5);
  await sync.start(); // "Try again"
  assertEquals(server.saves, []);
  assertEquals(server.loads, 2);
  assertEquals(view.code, "A");
  assertEquals(sync.state, { kind: "synced", revision: 1 });
});

Deno.test("another build open when a remote change or keep mine arrives: released, not written", async () => {
  const { sync, view, server, remoteEdit } = setup();
  await sync.start();
  view.code = null;
  await sync.serverRevision(remoteEdit("B"));
  assertEquals(sync.state, { kind: "released", lost: false });
  assertEquals(server.loads, 1);
  await sync.start();
  view.code = "B1";
  await sync.poll();
  await sync.serverRevision(remoteEdit("C"));
  assertEquals(sync.state.kind, "conflict");
  view.code = null;
  await sync.resolve("overwrite");
  assertEquals(sync.state, { kind: "released", lost: true });
  assertEquals(server.saves, []);
});

Deno.test("released after a failed write says the edit is lost; with nothing pending it does not", async () => {
  const { sync, view, api } = setup();
  await sync.start();
  view.code = null;
  await sync.poll();
  assertEquals(sync.state, { kind: "released", lost: false });
  await sync.start();
  api.save = () => Promise.reject(new Error("network down"));
  view.code = "A1";
  await sync.poll();
  await sync.poll(); // the write fails
  assertEquals(sync.state.kind, "save_failed");
  view.code = null;
  await sync.poll();
  assertEquals(sync.state, { kind: "released", lost: true });
});

Deno.test("released from a conflict or a failed write that no poll saw: still said to be lost", async () => {
  const { sync, view, server, ui, api, remoteEdit } = setup();
  await sync.start();
  const realLoad = ui.load;
  ui.load = () => Promise.reject(new Error("not a valid build code"));
  await sync.serverRevision(remoteEdit("B")); // stopped, holding "A"
  ui.load = realLoad;
  view.code = "A1"; // edited while stopped: no poll sees it
  await sync.start(); // "Try again": the server moved on, so a conflict
  assertEquals(sync.state.kind, "conflict");
  view.code = null;
  await sync.resolve("overwrite");
  assertEquals(sync.state, { kind: "released", lost: true });
  view.code = "A1";
  await sync.start();
  assertEquals(sync.state.kind, "conflict");
  api.save = () => Promise.reject(new Error("network down"));
  await sync.resolve("overwrite");
  assertEquals(sync.state.kind, "save_failed");
  view.code = null;
  await sync.poll();
  assertEquals(sync.state, { kind: "released", lost: true });
  assertEquals(server.saves, []);
});

Deno.test("a load that leaves the view without the build stops, and writes nothing", async () => {
  const { sync, view, server, ui } = setup();
  ui.load = () => {
    view.code = null; // the view took the code but holds no build the page loaded
    return Promise.resolve();
  };
  await sync.start();
  assertEquals(sync.state, { kind: "failed", reason: "the build did not open in Path of Building" });
  await sync.poll();
  assertEquals(server.saves, []);
});

Deno.test("try again after a stop with no edit loads once more and writes nothing", async () => {
  const { sync, server, ui, remoteEdit } = setup();
  await sync.start();
  const realLoad = ui.load;
  ui.load = () => Promise.reject(new Error("not a valid build code"));
  await sync.serverRevision(remoteEdit("B"));
  assertEquals(sync.state.kind, "failed");
  ui.load = realLoad;
  await sync.start();
  assertEquals(server.loads, 3);
  assertEquals(server.saves, []);
  assertEquals(sync.state, { kind: "synced", revision: 2 });
});

Deno.test("back-off starts again after a reload", async () => {
  const { sync, view, server, api, remoteEdit } = setup();
  await sync.start();
  api.save = (code, base) => {
    server.saves.push({ code, base });
    return Promise.reject(new Error("network down"));
  };
  view.code = "A1";
  await sync.poll();
  await sync.poll(); // fails: next at once
  await sync.poll(); // fails: wait one tick
  await sync.serverRevision(remoteEdit("B")); // edit held: conflict
  await sync.resolve("reload"); // the user takes the server's version
  const before = server.saves.length;
  view.code = "B1";
  await sync.poll(); // first sight
  await sync.poll(); // fails
  await sync.poll(); // the first retry after a reload is at once
  assertEquals(server.saves.length, before + 2);
});
