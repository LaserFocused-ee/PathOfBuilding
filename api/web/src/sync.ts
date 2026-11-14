// Keeps one build in the browser view in step with the server's build store.
// The server is the source of truth: the page loads the build code and revision, reloads when the
// server reports a newer revision it did not cause, and writes its own edits back with the revision
// they were based on. A refused write (stale revision) becomes a conflict the user resolves.
// Every operation runs on one queue, so a write and an incoming event never interleave.

export interface SyncApi {
  load(): Promise<{ code: string; revision: number }>;
  /** Writes a build code; `stale` when the server's revision is no longer `baseRevision`. */
  save(code: string, baseRevision: number): Promise<{ revision: number } | "stale">;
  /** The server's current revision (to overwrite it after a conflict). */
  revision(): Promise<number>;
}

export interface SyncView {
  load(code: string): Promise<void>;
  read(): Promise<string>;
}

export type SyncState =
  | { kind: "loading" }
  | { kind: "failed"; reason: string }
  | { kind: "synced"; revision: number }
  | { kind: "saving"; revision: number }
  | { kind: "save_failed"; revision: number; reason: string }
  | { kind: "conflict"; revision: number; serverRevision: number }
  | { kind: "deleted" };

export class BuildSync {
  private queue: Promise<void> = Promise.resolve();
  private revision = 0;
  private baseline = "";
  private candidate: string | undefined;
  state: SyncState = { kind: "loading" };

  constructor(
    private readonly api: SyncApi,
    private readonly view: SyncView,
    private readonly onState: (state: SyncState) => void,
  ) {}

  /** Loads the server's build into the view. */
  start(): Promise<void> {
    return this.run(() => this.reload());
  }

  /** A revision the server reported (the event stream's first frame or a change event). */
  serverRevision(revision: number): Promise<void> {
    return this.run(async () => {
      if (this.state.kind === "loading" || this.state.kind === "failed" || this.state.kind === "deleted") return;
      // Our own write, or an event older than what we hold: never reload for it.
      if (revision <= this.revision) return;
      if (this.state.kind === "conflict") {
        this.set({ ...this.state, serverRevision: Math.max(revision, this.state.serverRevision) });
        return;
      }
      if (await this.view.read() !== this.baseline) {
        this.set({ kind: "conflict", revision: this.revision, serverRevision: revision });
        return;
      }
      await this.reload();
    });
  }

  deleted(): Promise<void> {
    return this.run(() => Promise.resolve(this.set({ kind: "deleted" })));
  }

  /** Called on a timer: a change in the view that stayed the same for one tick is written back. */
  poll(): Promise<void> {
    return this.run(async () => {
      if (this.state.kind !== "synced" && this.state.kind !== "save_failed") return;
      const code = await this.view.read();
      if (code === this.baseline) {
        this.candidate = undefined;
        return;
      }
      if (code !== this.candidate) {
        this.candidate = code; // still changing: wait one more tick
        return;
      }
      await this.save(code, this.revision);
    });
  }

  /** After a conflict: take the server's version, or write the page's version over it. */
  resolve(choice: "reload" | "overwrite"): Promise<void> {
    return this.run(async () => {
      if (this.state.kind !== "conflict") return;
      if (choice === "reload") return await this.reload();
      await this.save(await this.view.read(), await this.api.revision());
    });
  }

  private async reload(): Promise<void> {
    this.set({ kind: "loading" });
    try {
      const { code, revision } = await this.api.load();
      await this.view.load(code);
      this.baseline = await this.view.read();
      this.revision = revision;
      this.candidate = undefined;
      this.set({ kind: "synced", revision });
    } catch (error) {
      this.set({ kind: "failed", reason: message(error) });
    }
  }

  private async save(code: string, baseRevision: number): Promise<void> {
    this.set({ kind: "saving", revision: this.revision });
    try {
      const result = await this.api.save(code, baseRevision);
      if (result === "stale") {
        this.set({ kind: "conflict", revision: this.revision, serverRevision: await this.api.revision() });
        return;
      }
      this.revision = result.revision;
      this.baseline = code;
      this.candidate = undefined;
      this.set({ kind: "synced", revision: result.revision });
    } catch (error) {
      this.set({ kind: "save_failed", revision: this.revision, reason: message(error) });
    }
  }

  private set(state: SyncState): void {
    this.state = state;
    this.onState(state);
  }

  private run(op: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(op, op);
    return this.queue;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
