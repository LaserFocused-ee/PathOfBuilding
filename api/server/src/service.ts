// Build operations that span the store, the pool, events and the fetcher. Routes call these.
import type { Config } from "./config.js";
import { ApiError } from "./errors.js";
import type { Events } from "./events.js";
import { decodeBuildCode, type Fetcher } from "./fetch.js";
import type { Logger } from "./log.js";
import { LOOKUP_SESSION, type Pool } from "./pool.js";
import type { BuildMeta, BuildSource, BuildStore } from "./store.js";
import type { WorkerReply } from "./worker.js";

export interface Summary {
  name: string;
  className: string;
  ascendancy?: string;
  level: number;
  treeVersion: string;
  mainSkill?: string;
}

export interface Output<T = unknown> {
  result: T;
  warnings: string[];
}

const publicMeta = (m: BuildMeta) => ({ id: m.id, name: m.name, revision: m.revision, createdAt: m.createdAt, updatedAt: m.updatedAt, source: m.source });

export class Service {
  constructor(
    readonly cfg: Config,
    readonly store: BuildStore,
    readonly pool: Pool,
    readonly events: Events,
    readonly fetcher: Fetcher,
    readonly log: Logger,
  ) {}

  private checkXml(xml: string): void {
    if (Buffer.byteLength(xml, "utf8") > this.cfg.maxXmlBytes) throw new ApiError("payload_too_large", `build XML is larger than ${this.cfg.maxXmlBytes} bytes`);
  }

  /** Loads (or makes) a build in a fresh worker, stores the worker's own export as revision 1. */
  private async createFrom(name: string | undefined, source: BuildSource, init: { op: "builds.new" | "builds.load"; args: Record<string, unknown> }): Promise<Output> {
    return this.pool.create(async (call) => {
      const loaded = await call<Summary>(init.op, init.args);
      const exported = await call<{ xml: string }>("builds.export");
      const meta = await this.store.create(name ?? loaded.result.name, exported.result.xml, source);
      return { id: meta.id, value: { result: { build: publicMeta(meta), summary: loaded.result }, warnings: [...loaded.warnings, ...exported.warnings] } };
    });
  }

  async list(): Promise<Output> {
    const metas = await this.store.list();
    return { result: { builds: metas.map(publicMeta) }, warnings: [] };
  }

  newBuild(input: { name?: string; className?: string; ascendancy?: string; level?: number; treeVersion?: string }): Promise<Output> {
    return this.createFrom(input.name ?? "New build", { kind: "new" }, { op: "builds.new", args: input });
  }

  importXml(input: { xml: string; name?: string }): Promise<Output> {
    this.checkXml(input.xml);
    return this.createFrom(input.name, { kind: "xml" }, { op: "builds.load", args: { xml: input.xml, name: input.name } });
  }

  importCode(input: { code: string; name?: string }): Promise<Output> {
    const xml = decodeBuildCode(input.code, this.cfg.maxXmlBytes);
    return this.createFrom(input.name, { kind: "code" }, { op: "builds.load", args: { xml, name: input.name } });
  }

  async importLink(input: { url: string; name?: string }): Promise<Output> {
    const link = await this.pool.run<{ site: string; downloadUrl: string }>(LOOKUP_SESSION, "builds.resolve_link", { url: input.url });
    const body = await this.fetcher.text(link.result.downloadUrl, `import:${link.result.site}`);
    const trimmed = body.trim();
    const xml = trimmed.startsWith("<") ? trimmed : decodeBuildCode(trimmed, this.cfg.maxXmlBytes);
    this.checkXml(xml);
    return this.createFrom(input.name, { kind: "link", url: input.url }, { op: "builds.load", args: { xml, name: input.name } });
  }

  async get(id: string): Promise<Output> {
    const summary = await this.pool.run<Summary>(id, "builds.summary");
    const meta = await this.store.get(id);
    // The stored name wins: a rename changes the store, not the open session.
    return { result: { build: publicMeta(meta), summary: { ...summary.result, name: meta.name } }, warnings: summary.warnings };
  }

  rename(id: string, input: { name: string; baseRevision?: number }): Promise<Output> {
    return this.pool.withLock(id, async () => {
      const meta = await this.store.update(id, { name: input.name, cause: "rename", baseRevision: input.baseRevision });
      this.events.emit(id, { revision: meta.revision, cause: "rename", changedStats: {} });
      return { result: { build: publicMeta(meta) }, warnings: [] };
    });
  }

  async duplicate(id: string, input: { name?: string }): Promise<Output> {
    const meta = await this.store.get(id);
    const xml = await this.store.xml(id);
    return this.createFrom(input.name ?? `${meta.name} (copy)`, { kind: "duplicate", from: id }, { op: "builds.load", args: { xml, name: input.name ?? meta.name } });
  }

  delete(id: string, input: { baseRevision?: number }): Promise<Output> {
    return this.pool.withLock(id, async () => {
      const meta = await this.store.get(id);
      await this.store.delete(id, input.baseRevision);
      this.pool.close(id);
      this.events.emit(id, { revision: meta.revision, cause: "delete", changedStats: {} });
      return { result: { deleted: id }, warnings: [] };
    });
  }

  async exportXml(id: string, input: { revision?: number }): Promise<Output> {
    const meta = await this.store.get(id);
    const revision = input.revision ?? meta.revision;
    return { result: { id, revision, xml: await this.store.xml(id, revision) }, warnings: [] };
  }

  exportCode(id: string): Promise<Output> {
    return this.pool.withLock(id, async () => {
      const r = await this.pool.runLocked<{ code: string }>(id, "builds.export", { code: true });
      const meta = await this.store.get(id);
      return { result: { id, revision: meta.revision, code: r.result.code }, warnings: r.warnings };
    });
  }

  savePoint(id: string, input: { label?: string }): Promise<Output> {
    return this.pool.withLock(id, async () => {
      const meta = await this.store.savePoint(id, input.label ?? `save point ${new Date().toISOString()}`);
      return { result: { id, revision: meta.revision, label: meta.history.at(-1)?.savePoint }, warnings: [] };
    });
  }

  async history(id: string): Promise<Output> {
    const meta = await this.store.get(id);
    return { result: { id, revision: meta.revision, history: [...meta.history].reverse() }, warnings: [] };
  }

  /** A read-only worker command on a build's session, or on the lookup session when no build is named. */
  async read(buildId: string | undefined, op: string, args: Record<string, unknown>): Promise<Output> {
    const r: WorkerReply = await this.pool.run(buildId ?? LOOKUP_SESSION, op, args);
    return { result: r.result, warnings: r.warnings };
  }
}
