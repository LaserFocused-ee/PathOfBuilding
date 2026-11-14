// Build store: the source of truth. One XML file and one JSON metadata file per build, plus the last
// N revisions (and every save point) under history/<id>/. Writes are atomic (temp file + rename).
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiError } from "./errors.js";

export interface BuildSource {
  kind: "new" | "xml" | "code" | "link" | "duplicate";
  url?: string;
  from?: string;
}

export interface RevisionEntry {
  revision: number;
  at: string;
  cause: string;
  savePoint?: string;
}

export interface BuildMeta {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  source: BuildSource;
  history: RevisionEntry[];
}

// Ids are generated here and checked against this shape before any path is built from them.
const ID_RE = /^[a-f0-9]{16}$/;

export function isBuildId(id: string): boolean {
  return ID_RE.test(id);
}

export class BuildStore {
  constructor(
    readonly dir: string,
    private readonly historyKeep: number,
  ) {}

  async init(): Promise<void> {
    await mkdir(join(this.dir, "builds"), { recursive: true });
    await mkdir(join(this.dir, "history"), { recursive: true });
  }

  private paths(id: string) {
    if (!isBuildId(id)) throw new ApiError("not_found", `no build ${id}`);
    const base = join(this.dir, "builds", id);
    return { xml: `${base}.xml`, meta: `${base}.json`, history: join(this.dir, "history", id) };
  }

  private async atomicWrite(path: string, data: string): Promise<void> {
    const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, path);
  }

  async list(): Promise<BuildMeta[]> {
    const names = await readdir(join(this.dir, "builds"));
    const metas = await Promise.all(
      names.filter((n) => n.endsWith(".json") && isBuildId(n.slice(0, -5))).map((n) => this.get(n.slice(0, -5))),
    );
    return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<BuildMeta> {
    const p = this.paths(id);
    try {
      return JSON.parse(await readFile(p.meta, "utf8")) as BuildMeta;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new ApiError("not_found", `no build ${id}`);
      throw e;
    }
  }

  async xml(id: string, revision?: number): Promise<string> {
    const p = this.paths(id);
    const meta = await this.get(id);
    if (revision === undefined || revision === meta.revision) return readFile(p.xml, "utf8");
    if (!meta.history.some((h) => h.revision === revision)) throw new ApiError("not_found", `build ${id} has no stored revision ${revision}`);
    return readFile(join(p.history, `${revision}.xml`), "utf8");
  }

  async create(name: string, xml: string, source: BuildSource): Promise<BuildMeta> {
    const id = randomBytes(8).toString("hex");
    const now = new Date().toISOString();
    const meta: BuildMeta = { id, name, revision: 1, createdAt: now, updatedAt: now, source, history: [{ revision: 1, at: now, cause: `create:${source.kind}` }] };
    const p = this.paths(id);
    await mkdir(p.history, { recursive: true });
    await this.atomicWrite(join(p.history, "1.xml"), xml);
    await this.atomicWrite(p.xml, xml);
    await this.atomicWrite(p.meta, JSON.stringify(meta, null, 2));
    return meta;
  }

  /** Writes a new revision. Callers hold the build's lock; a baseRevision that is not current is refused. */
  async update(id: string, change: { xml?: string; name?: string; cause: string; baseRevision?: number | undefined }): Promise<BuildMeta> {
    const p = this.paths(id);
    const meta = await this.get(id);
    if (change.baseRevision !== undefined && change.baseRevision !== meta.revision) {
      throw new ApiError("stale_revision", `build ${id} is at revision ${meta.revision}, not ${change.baseRevision}`, { revision: meta.revision });
    }
    const now = new Date().toISOString();
    meta.revision += 1;
    meta.updatedAt = now;
    if (change.name !== undefined) meta.name = change.name;
    meta.history.push({ revision: meta.revision, at: now, cause: change.cause });
    const xml = change.xml ?? (await readFile(p.xml, "utf8"));
    await this.atomicWrite(join(p.history, `${meta.revision}.xml`), xml);
    // Keep the newest historyKeep revisions plus every save point.
    const keepFrom = meta.history.length - this.historyKeep;
    const dropped = meta.history.filter((h, i) => i < keepFrom && !h.savePoint);
    meta.history = meta.history.filter((h) => !dropped.includes(h));
    if (change.xml !== undefined) await this.atomicWrite(p.xml, xml);
    await this.atomicWrite(p.meta, JSON.stringify(meta, null, 2));
    await Promise.all(dropped.map((h) => rm(join(p.history, `${h.revision}.xml`), { force: true })));
    return meta;
  }

  async savePoint(id: string, label: string): Promise<BuildMeta> {
    const p = this.paths(id);
    const meta = await this.get(id);
    const entry = meta.history.find((h) => h.revision === meta.revision);
    if (!entry) throw new ApiError("worker_error", `build ${id} history is missing revision ${meta.revision}`);
    entry.savePoint = label;
    await this.atomicWrite(p.meta, JSON.stringify(meta, null, 2));
    return meta;
  }

  async delete(id: string, baseRevision?: number): Promise<void> {
    const p = this.paths(id);
    const meta = await this.get(id);
    if (baseRevision !== undefined && baseRevision !== meta.revision) {
      throw new ApiError("stale_revision", `build ${id} is at revision ${meta.revision}, not ${baseRevision}`, { revision: meta.revision });
    }
    await rm(p.meta, { force: true });
    await rm(p.xml, { force: true });
    await rm(p.history, { recursive: true, force: true });
  }
}
