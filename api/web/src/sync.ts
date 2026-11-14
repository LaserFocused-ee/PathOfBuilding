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
  /** Shows a build code; throws when the view did not take it. */
  load(code: string): Promise<void>;
  /** The view's current build code. */
  read(): Promise<string>;
  /** What counts as an edit: the code without view state (open tab, tree zoom, search text). */
  content(code: string): Promise<string>;
  /** Resolves once a loaded build is on screen (the baseline is read before, so input meanwhile is an edit). */
  shown(): Promise<void>;
}

export type SyncState =
  | { kind: "loading" }
  | { kind: "failed"; reason: string }
  | { kind: "synced"; revision: number }
  | { kind: "saving"; revision: number }
  | { kind: "save_failed"; revision: number; reason: string; retrying: boolean }
  | { kind: "conflict"; revision: number; serverRevision: number }
  | { kind: "deleted" };

/** An error whose `permanent` is true is a refusal that the same request would get again. */
function isPermanent(error: unknown): boolean {
  return (error as { permanent?: unknown } | undefined)?.permanent === true;
}

const MAX_BACKOFF_TICKS = 15; // 30 s at the page's 2 s tick

export class BuildSync {
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private revision = 0;
  private baseline = "";
  private candidate: string | undefined;
  private refused: string | undefined; // content a permanent refusal was given for
  private backoff = 0;
  private skipTicks = 0;
  state: SyncState = { kind: "loading" };

  constructor(
    private readonly api: SyncApi,
    private readonly view: SyncView,
    private readonly onState: (state: SyncState) => void,
  ) {}

  /** True while the page holds an edit the server does not have (leaving would lose it). */
  get unsaved(): boolean {
    const kind = this.state.kind;
    // ponytail: a stop after a load counts as unsaved without reading the view (polls do not run once stopped)
    const stoppedHolding = kind === "failed" && this.baseline !== "";
    return kind === "saving" || kind === "save_failed" || kind === "conflict" || stoppedHolding ||
      this.candidate !== undefined;
  }

  /** Loads the server's build into the view; also the retry after a stop, which never loads over an edit. */
  start(): Promise<void> {
    return this.run(async () => {
      if (this.baseline !== "") {
        const code = await this.view.read();
        const content = await this.view.content(code);
        if (content !== this.baseline) {
          const server = await this.api.revision();
          if (server === this.revision) return await this.save(code, content, server);
          return this.set({ kind: "conflict", revision: this.revision, serverRevision: server });
        }
      }
      await this.reload();
    });
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
      if (await this.view.content(await this.view.read()) !== this.baseline) {
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
    if (this.pending > 0) return this.queue; // a slow tick is still running: skip, never pile up
    return this.run(async () => {
      if (this.state.kind !== "synced" && this.state.kind !== "save_failed") return;
      if (this.skipTicks > 0) {
        this.skipTicks--;
        return;
      }
      const code = await this.view.read();
      const content = await this.view.content(code);
      if (content === this.baseline) {
        this.candidate = undefined;
        return;
      }
      if (content !== this.candidate) {
        this.candidate = content; // still changing: wait one more tick
        return;
      }
      if (content === this.refused) return; // refused for good; a further edit may change that
      await this.save(code, content, this.revision);
    });
  }

  /** After a conflict: take the server's version, or write the page's version over it. */
  resolve(choice: "reload" | "overwrite"): Promise<void> {
    return this.run(async () => {
      if (this.state.kind !== "conflict") return;
      if (choice === "reload") return await this.reload();
      const code = await this.view.read();
      await this.save(code, await this.view.content(code), "server");
    });
  }

  private async reload(): Promise<void> {
    this.set({ kind: "loading" });
    const { code, revision } = await this.api.load();
    await this.view.load(code);
    // Read before the build is drawn: input from here on differs from the baseline, so it is an edit.
    this.baseline = await this.view.content(await this.view.read());
    this.revision = revision;
    this.candidate = undefined;
    this.refused = undefined;
    this.backoff = this.skipTicks = 0;
    await this.view.shown();
    this.set({ kind: "synced", revision });
  }

  /** `base` "server": overwrite whatever revision the server holds now. */
  private async save(code: string, content: string, base: number | "server"): Promise<void> {
    this.set({ kind: "saving", revision: this.revision });
    let result: { revision: number } | "stale";
    let serverRevision = 0;
    try {
      // The revision lookups sit inside the try: a failed one is a failed write (kept, retried), never a stop.
      result = await this.api.save(code, base === "server" ? await this.api.revision() : base);
      if (result === "stale") serverRevision = await this.api.revision();
    } catch (error) {
      const permanent = isPermanent(error);
      if (permanent) this.refused = content;
      else {
        this.skipTicks = this.backoff;
        this.backoff = Math.min(this.backoff * 2 + 1, MAX_BACKOFF_TICKS);
      }
      this.set({ kind: "save_failed", revision: this.revision, reason: message(error), retrying: !permanent });
      return;
    }
    if (result === "stale") {
      this.set({ kind: "conflict", revision: this.revision, serverRevision });
      return;
    }
    this.revision = result.revision;
    this.baseline = content;
    this.candidate = undefined;
    this.refused = undefined;
    this.backoff = this.skipTicks = 0;
    this.set({ kind: "synced", revision: result.revision });
  }

  private set(state: SyncState): void {
    this.state = state;
    this.onState(state);
  }

  // Runs one operation after the previous one. An operation that throws stops syncing with the
  // reason on screen (state "failed", which never writes) instead of leaving a stale "Saved".
  private run(op: () => Promise<void>): Promise<void> {
    this.pending++;
    const guarded = async () => {
      try {
        await op();
      } catch (error) {
        this.set({ kind: "failed", reason: message(error) });
      } finally {
        this.pending--;
      }
    };
    this.queue = this.queue.then(guarded);
    return this.queue;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
