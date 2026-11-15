// Build operations that span the store, the pool, events and the fetcher. Routes call these.
import { z } from "zod";
import type { Config } from "./config.js";
import { ApiError } from "./errors.js";
import type { Events } from "./events.js";
import { decodeBuildCode, GAME_HOST, type Fetcher, type Relayed } from "./fetch.js";
import type { Logger } from "./log.js";
import { LOOKUP_SESSION, type Pool } from "./pool.js";
import { type BuildMeta, type BuildSource, type BuildStore, TRASH_DAYS } from "./store.js";
import { type Priority, type TradeClient, type TradeRealm, type TradeResult, tradeUrl } from "./trade.js";
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

interface Mutation {
  result: unknown;
  changed: Record<string, { before: number | null; after: number | null }>;
  xml: string;
}

export type Realm = "pc" | "xbox" | "sony";

export interface TradeSearchInput {
  realm: TradeRealm;
  league: string;
  priority: Priority;
  searches: Array<{ query: Record<string, unknown>; sort?: Record<string, "asc" | "desc">; slot?: string; listings: number }>;
  buildId?: string;
  weights?: Array<{ stat: string; weight: number }>;
  fields?: string[];
}

/** How long an interactive trade call may wait for the pace, in total. */
const TRADE_CALL_MS = 60_000; // ponytail: one budget per call; per-search budgets if long batches need them
const listingsReply = z.object({
  listings: z.array(z.object({ text: z.string().nullable(), score: z.looseObject({ gain: z.number() }).nullable(), error: z.string().optional() })),
});

type StatValue = number | boolean | string;
const statValue = z.union([z.number(), z.boolean(), z.string()]);
const sidebarReply = z.object({ stats: z.array(z.looseObject({ key: z.string().optional(), value: z.number().optional() })) });
const outputReply = z.object({ output: z.record(z.string(), statValue) });

/** One entry of character-window/get-characters (the fields the Import tab reads). */
interface SiteCharacter {
  name: string;
  realm?: string;
  class: string;
  league: string;
  level?: number;
}

/**
 * Account name as the Import tab sends it (ImportTab.lua:907-914): whitespace dropped on PC (trimmed on
 * consoles), the last "-" or "#" taken as the discriminator separator. PC names need their discriminator.
 */
export function accountName(raw: string, realm: Realm): string {
  let name = realm === "pc" ? raw.replace(/\s+/g, "") : raw.trim();
  name = name.replace(/^(.*)[#-]/, "$1#");
  if (realm === "pc" && !/^[^#]+#\d{4}$/.test(name)) {
    throw new ApiError("invalid_input", "the account name needs its discriminator, e.g. Name#1234 (shown on the profile page)");
  }
  return name;
}

const publicMeta = (m: BuildMeta) => ({ id: m.id, name: m.name, revision: m.revision, createdAt: m.createdAt, updatedAt: m.updatedAt, source: m.source });

export class Service {
  constructor(
    readonly cfg: Config,
    readonly store: BuildStore,
    readonly pool: Pool,
    readonly events: Events,
    readonly fetcher: Fetcher,
    readonly game: Fetcher,
    readonly trade: TradeClient,
    readonly log: Logger,
  ) {}

  private checkXml(xml: string): void {
    if (Buffer.byteLength(xml, "utf8") > this.cfg.maxXmlBytes) throw new ApiError("payload_too_large", `build XML is larger than ${this.cfg.maxXmlBytes} bytes`);
  }

  /** A fetch for the browser view's own imports, through the fetcher that owns the host (and its pause). */
  relay(input: { url: string; headers?: Record<string, string>; body?: string }): Promise<Relayed> {
    let host: string;
    try {
      host = new URL(input.url).hostname;
    } catch {
      throw new ApiError("invalid_input", "not a valid URL");
    }
    return (host === GAME_HOST ? this.game : this.fetcher).relay(input.url, input.headers ?? {}, input.body);
  }

  /** GETs one character-window endpoint for a public profile; maps the site's refusals to clear errors. */
  private async characterWindow(endpoint: string, params: Record<string, string>): Promise<string> {
    const q = new URLSearchParams(params).toString(); // "#" goes as %23, as ImportTab.lua sends it
    try {
      return await this.game.text(`https://${GAME_HOST}/character-window/${endpoint}?${q}`, `character:${endpoint}`, "application/json");
    } catch (e) {
      const status = e instanceof ApiError ? e.details?.status : undefined;
      if (status === 401 || status === 403) throw new ApiError("profile_private", "the account's profile (or its Characters tab) is private, or the account does not exist");
      if (status === 404) throw new ApiError("not_found", "no account with that name (check the discriminator)");
      throw e;
    }
  }

  private async siteCharacters(account: string, realm: Realm): Promise<SiteCharacter[]> {
    const body = await this.characterWindow("get-characters", { accountName: account, realm });
    let list: unknown;
    try {
      list = JSON.parse(body);
    } catch {
      throw new ApiError("upstream_fetch_failed", "the character list could not be read");
    }
    if (!Array.isArray(list)) throw new ApiError("upstream_fetch_failed", "the character list could not be read");
    // BuildCharacterList (ImportTab.lua:1027) keeps the realm's characters.
    return (list as SiteCharacter[]).filter((c) => c && typeof c.name === "string" && (c.realm ?? realm) === realm);
  }

  /** Characters on a public profile: name, league, class, level. */
  async characters(input: { account: string; realm?: Realm }): Promise<Output> {
    const realm = input.realm ?? "pc";
    const list = await this.siteCharacters(accountName(input.account, realm), realm);
    return { result: { characters: list.map((c) => ({ name: c.name, league: c.league, class: c.class, level: c.level })) }, warnings: [] };
  }

  /**
   * A new build from a character on a public profile: the passive tree and jewels, then items and skills,
   * through the Import tab's own import functions (ImportTab.lua:814-886).
   */
  async importCharacter(input: { account: string; realm?: Realm; character: string; name?: string }): Promise<Output> {
    const realm = input.realm ?? "pc";
    const account = accountName(input.account, realm);
    const list = await this.siteCharacters(account, realm);
    const char = list.find((c) => c.name === input.character) ?? list.find((c) => c.name.toLowerCase() === input.character.toLowerCase());
    if (!char) {
      const names = list.map((c) => c.name).slice(0, 50);
      throw new ApiError("not_found", `no character named ${input.character} on this profile`, { characters: names });
    }
    const params = { accountName: account, character: char.name, realm };
    const passives = await this.characterWindow("get-passive-skills", params);
    const items = await this.characterWindow("get-items", params);
    for (const body of [passives, items]) {
      if (body.trim() === "false") throw new ApiError("not_found", "the site returned no data for this character; the account name is case-sensitive here (as on the profile page)");
    }
    return this.createFrom(input.name ?? char.name, { kind: "character", account, realm, character: char.name }, {
      op: "builds.import_character",
      args: { character: char, passives, items, name: input.name ?? char.name },
    });
  }

  /** Loads (or makes) a build in a fresh worker, stores the worker's own export as revision 1. */
  private async createFrom(name: string | undefined, source: BuildSource, init: { op: "builds.new" | "builds.load" | "builds.import_character"; args: Record<string, unknown> }): Promise<Output> {
    return this.pool.create(async (call) => {
      const loaded = await call<Summary>(init.op, init.args);
      const exported = await call<{ xml: string }>("builds.export");
      const meta = await this.store.create(name ?? loaded.result.name, exported.result.xml, source);
      return { id: meta.id, value: { result: { build: publicMeta(meta), summary: loaded.result }, warnings: [...loaded.warnings, ...exported.warnings] } };
    });
  }

  async list(): Promise<Output<{ builds: Array<ReturnType<typeof publicMeta>> }>> {
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
      const meta = await this.store.delete(id, input.baseRevision);
      this.pool.close(id);
      this.events.emit(id, { revision: meta.revision, cause: "delete", changedStats: {} });
      await this.purgeTrash();
      return { result: { deleted: id, restorableDays: TRASH_DAYS }, warnings: [] };
    });
  }

  async trash(): Promise<Output> {
    await this.purgeTrash();
    const metas = await this.store.listTrash();
    return { result: { builds: metas.map((m) => ({ ...publicMeta(m), deletedAt: m.deletedAt, purgeAfter: m.purgeAfter })) }, warnings: [] };
  }

  restore(id: string): Promise<Output> {
    return this.pool.withLock(id, async () => {
      const meta = await this.store.restore(id);
      this.events.emit(id, { revision: meta.revision, cause: "restore", changedStats: {} });
      return { result: { build: publicMeta(meta) }, warnings: [] };
    });
  }

  async purgeTrash(): Promise<void> {
    const purged = await this.store.purgeTrash();
    if (purged.length > 0) this.log.info({ event: "store.trash_purged", count: purged.length }, "deleted builds past their restore window removed");
  }

  /**
   * Runs a worker mutation (an op wrapped in W.mutation) and stores the worker's export as a new
   * revision. Any failure drops the session, so a half-applied change never outlives the request:
   * the next use reloads the last stored revision.
   */
  /** Runs a worker mutation under the build's lock and stores its XML as the next revision when it changed. */
  private applyMutation(id: string, op: string, args: Record<string, unknown>, baseRevision: number | undefined, cause = op): Promise<{ meta: BuildMeta; mutation: Mutation; warnings: string[] }> {
    return this.pool.withLock(id, async () => {
      const current = await this.store.get(id);
      if (baseRevision !== undefined && baseRevision !== current.revision) {
        throw new ApiError("stale_revision", `build ${id} is at revision ${current.revision}, not ${baseRevision}`, { revision: current.revision });
      }
      try {
        const r = await this.pool.runLocked<Mutation>(id, op, args);
        let meta = current;
        if (r.result.xml !== (await this.store.xml(id))) {
          this.checkXml(r.result.xml);
          meta = await this.store.update(id, { xml: r.result.xml, cause, baseRevision: current.revision });
          this.events.emit(id, { revision: meta.revision, cause, changedStats: r.result.changed });
        }
        return { meta, mutation: r.result, warnings: r.warnings };
      } catch (e) {
        this.pool.invalidate(id);
        throw e;
      }
    });
  }

  async mutate(id: string, op: string, args: Record<string, unknown>, baseRevision?: number): Promise<Output> {
    const { meta, mutation, warnings } = await this.applyMutation(id, op, args, baseRevision);
    return { result: { result: mutation.result, changed: mutation.changed, revision: meta.revision }, warnings };
  }

  /** Replaces a build's content with a build code; id and name stay, the revision moves on. */
  async replaceCode(id: string, input: { code: string; baseRevision: number }): Promise<Output> {
    const xml = decodeBuildCode(input.code, this.cfg.maxXmlBytes);
    this.checkXml(xml);
    const { meta, mutation, warnings } = await this.applyMutation(id, "builds.replace", { xml }, input.baseRevision, "replace");
    return { result: { build: publicMeta(meta), changed: mutation.changed }, warnings };
  }

  /** Makes a stored revision current again, as a new revision. */
  revert(id: string, input: { revision: number; baseRevision?: number }): Promise<Output> {
    return this.pool.withLock(id, async () => {
      const xml = await this.store.xml(id, input.revision);
      const meta = await this.store.update(id, { xml, cause: `revert:${input.revision}`, baseRevision: input.baseRevision });
      this.pool.invalidate(id);
      this.events.emit(id, { revision: meta.revision, cause: "revert", changedStats: {} });
      return { result: { build: publicMeta(meta) }, warnings: [] };
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

  /** What differs between two builds: the stats of `other` against this build's (stats.sidebar of each; stats.output when `fields` names keys). */
  async compareBuilds(id: string, other: string, fields?: string[]): Promise<Output> {
    const stats = async (build: string) => {
      const r = fields ? await this.read(build, "stats.output", { fields }) : await this.read(build, "stats.sidebar", {});
      const values = new Map<string, StatValue>();
      if (fields) {
        for (const [k, v] of Object.entries(outputReply.parse(r.result).output)) values.set(k, v);
      } else {
        for (const s of sidebarReply.parse(r.result).stats) if (s.key !== undefined && s.value !== undefined) values.set(s.key, s.value);
      }
      return { values, warnings: r.warnings };
    };
    const [a, b] = [await stats(id), await stats(other)];
    const changed: Record<string, { before: StatValue | null; after: StatValue | null }> = {};
    for (const key of new Set([...a.values.keys(), ...b.values.keys()])) {
      const [before, after] = [a.values.get(key), b.values.get(key)];
      if (before !== after) changed[key] = { before: before ?? null, after: after ?? null };
    }
    return { result: { changed }, warnings: [...a.warnings, ...b.warnings] };
  }

  private pobVersion?: Promise<string>;

  /**
   * Trade searches, one after another, each with the fetches for its first listings; each listing converted to item text by
   * the worker and, with a build, scored in its slot. The first stop (limiter refusal, 429, any 4xx, a failed request) ends
   * the call: the searches done so far are answered with `stopped` saying why and when to try again.
   */
  async tradeSearch(i: TradeSearchInput): Promise<Output> {
    this.pobVersion ??= this.pool.run<{ pobVersion: string }>(LOOKUP_SESSION, "worker.ping").then(
      (r) => r.result.pobVersion,
      (e: unknown) => {
        this.pobVersion = undefined; // a failed lookup is asked again next call
        throw e;
      },
    );
    const userAgent = `Path of Building/${await this.pobVersion}`; // Launch.lua's client string
    const deadline = Date.now() + TRADE_CALL_MS;
    const searches: unknown[] = [];
    const warnings: string[] = [];
    let stopped: Record<string, unknown> | null = null;
    for (const s of i.searches) {
      const ask = { realm: i.realm, league: i.league, body: { query: s.query, sort: s.sort ?? { price: "asc" }, engine: "new" }, listings: s.listings };
      let r: TradeResult | undefined = this.trade.cached(ask);
      const cached = r !== undefined;
      if (!r) {
        try {
          r = await this.trade.search({ ...ask, priority: i.priority, deadline, userAgent });
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
          stopped = { code: e.code, message: e.message, ...e.details };
          break;
        }
      }
      if (r.dropped > 0) warnings.push(`search ${searches.length + 1}: ${r.dropped} fetched entries were not listings and were left out`);
      const scored = r.entries.length === 0 ? [] : listingsReply.parse((await this.pool.run(i.buildId ?? LOOKUP_SESSION, "evaluate.listings", {
        entries: r.entries.map((e) => e.entry), score: i.buildId !== undefined, ...(s.slot === undefined ? {} : { slot: s.slot }), ...(i.weights ? { weights: i.weights } : {}), ...(i.fields ? { fields: i.fields } : {}),
      })).result).listings;
      const listings = r.entries.map((e, k) => {
        const row = scored[k];
        return { id: e.id, price: e.price, indexed: e.indexed, text: row?.text ?? null, score: row?.score ?? null, ...(row?.error ? { error: row.error } : {}) };
      });
      if (i.buildId !== undefined) listings.sort((a, b) => (b.score?.gain ?? -Infinity) - (a.score?.gain ?? -Infinity));
      searches.push({ searchId: r.searchId, total: r.total, cached, link: `${tradeUrl("trade/search", i.realm, i.league)}/${r.searchId}`, listings });
    }
    return { result: { searches, notRun: i.searches.length - searches.length, stopped, limiter: this.trade.limiter.state() }, warnings };
  }

  /** A read-only worker command on a build's session, or on the lookup session when no build is named. */
  async read(buildId: string | undefined, op: string, args: Record<string, unknown>): Promise<Output> {
    const r: WorkerReply = await this.pool.run(buildId ?? LOOKUP_SESSION, op, args);
    return { result: r.result, warnings: r.warnings };
  }
}
