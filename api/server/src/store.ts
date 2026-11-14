// Build store: the source of truth. One XML file and one JSON metadata file per build, plus the last
// N revisions (and every save point) under history/<id>/. Writes are atomic (temp file + rename).
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiError } from "./errors.js";

export interface BuildSource {
  kind: "new" | "xml" | "code" | "link" | "duplicate" | "character";
  url?: string;
  from?: string;
  /** Character imports: the public profile the character came from. */
  account?: string;
  realm?: string;
  character?: string;
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

/** Deleted builds stay restorable this long. */
export const TRASH_DAYS = 7;
const TRASH_MS = TRASH_DAYS * 24 * 3600 * 1000;

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
    await mkdir(join(this.dir, "trash"), { recursive: true });
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
      names
        .filter((n) => n.endsWith(".json") && isBuildId(n.slice(0, -5)))
        // A build deleted between the directory read and its file read is left out, not a failed list.
        .map((n) => this.get(n.slice(0, -5)).catch((e: unknown) => (e instanceof ApiError && e.code === "not_found" ? undefined : Promise.reject(e as Error)))),
    );
    return metas.filter((m) => m !== undefined).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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

  /** Moves a build to trash/<id>/ (restorable until purgeTrash drops it, TRASH_DAYS later). */
  async delete(id: string, baseRevision?: number): Promise<BuildMeta> {
    const p = this.paths(id);
    const meta = await this.get(id);
    if (baseRevision !== undefined && baseRevision !== meta.revision) {
      throw new ApiError("stale_revision", `build ${id} is at revision ${meta.revision}, not ${baseRevision}`, { revision: meta.revision });
    }
    const t = this.trashPaths(id);
    await rm(t.dir, { recursive: true, force: true });
    await mkdir(t.dir, { recursive: true });
    await this.atomicWrite(t.deleted, JSON.stringify({ deletedAt: new Date().toISOString() }));
    await rename(p.history, t.history);
    await rename(p.xml, t.xml);
    await rename(p.meta, t.meta);
    return meta;
  }

  private trashPaths(id: string) {
    if (!isBuildId(id)) throw new ApiError("not_found", `no deleted build ${id}`);
    const dir = join(this.dir, "trash", id);
    return { dir, xml: join(dir, "build.xml"), meta: join(dir, "build.json"), history: join(dir, "history"), deleted: join(dir, "deleted.json") };
  }

  /** Deleted builds still restorable, newest deletion first. */
  async listTrash(): Promise<(BuildMeta & { deletedAt: string; purgeAfter: string })[]> {
    const ids = (await readdir(join(this.dir, "trash"))).filter(isBuildId);
    const out = await Promise.all(
      ids.map(async (id) => {
        const t = this.trashPaths(id);
        try {
          const meta = JSON.parse(await readFile(t.meta, "utf8")) as BuildMeta;
          const { deletedAt } = JSON.parse(await readFile(t.deleted, "utf8")) as { deletedAt: string };
          return { ...meta, deletedAt, purgeAfter: new Date(Date.parse(deletedAt) + TRASH_MS).toISOString() };
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; // a delete that did not finish
          throw e;
        }
      }),
    );
    return out.filter((m) => m !== undefined).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  async restore(id: string): Promise<BuildMeta> {
    const t = this.trashPaths(id);
    const p = this.paths(id);
    let meta: BuildMeta;
    try {
      meta = JSON.parse(await readFile(t.meta, "utf8")) as BuildMeta;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new ApiError("not_found", `no deleted build ${id}`);
      throw e;
    }
    await rename(t.history, p.history);
    await rename(t.xml, p.xml);
    await rename(t.meta, p.meta);
    await rm(t.dir, { recursive: true, force: true });
    return meta;
  }

  /** Drops trash entries deleted more than TRASH_DAYS before `now`. Runs at start, on delete and on trash list. */
  async purgeTrash(now = Date.now()): Promise<string[]> {
    const purged: string[] = [];
    for (const id of (await readdir(join(this.dir, "trash"))).filter(isBuildId)) {
      const t = this.trashPaths(id);
      const deletedAt = await readFile(t.deleted, "utf8").then(
        (s) => Date.parse((JSON.parse(s) as { deletedAt: string }).deletedAt),
        () => 0, // ponytail: an entry without its marker is a half-finished delete; purge it
      );
      if (now - deletedAt > TRASH_MS) {
        await rm(t.dir, { recursive: true, force: true });
        purged.push(id);
      }
    }
    return purged;
  }
}
