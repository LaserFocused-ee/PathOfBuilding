// tree.timeless_nodes: what a timeless jewel with a seed and conqueror does around a socket, read without changing the build
// and checked against the same jewel really socketed (items.add equipped in the socket), on the Elementalist fixture (tree 3_30).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { routes } from "../src/routes.js";
import { FIXTURES, ROOT, startServer, type TestServer } from "./helpers.js";

type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type Changed = { id: number; type: string; name: string; becomes: string; stats: string[]; allocated: boolean };
type Preview = { jewel: string; seed: number; conqueror: string; socket: number; radius: string | null; nodes: Changed[] };
type Node = { id: number; name: string; stats: string[] | Record<string, string> };

let srv: TestServer;
/** Sockets 41263 (Basic) and 21984 (Large) are not allocated here. */
let loose: string;
/** The same build with both sockets allocated, both empty. */
let base: string;

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const post = <T>(path: string, body: Record<string, unknown>) => srv.call<T>("POST", path, body);
const query = (jewel: string, seed: number | string, conqueror: string, socket: number | string) =>
  `jewel=${encodeURIComponent(jewel)}&seed=${seed}&conqueror=${encodeURIComponent(conqueror)}&socket=${socket}`;
const timeless = (id: string, jewel: string, seed: number | string, conqueror: string, socket: number | string) =>
  srv.call<Preview>("GET", `/v1/tree/${id}/timeless-nodes?${query(jewel, seed, conqueror, socket)}`);
const preview = async (id: string, jewel: string, seed: number, conqueror: string, socket: number) => {
  const result = ok(await timeless(id, jewel, seed, conqueror, socket));
  const parsed = routes.find((r) => r.name === "tree.timeless_nodes")?.output.safeParse(result);
  assert.ok(parsed?.success, JSON.stringify(parsed?.error?.issues.slice(0, 3)));
  return result;
};
const fails = async (r: Promise<Reply<unknown>>, status: number, code: string, message: RegExp) => {
  const res = await r;
  assert.deepEqual([res.status, res.body.error?.code], [status, code], JSON.stringify(res.body.error));
  assert.match(res.body.error?.message ?? "", message);
};
const dup = async (id: string) => ok(await post<{ build: { id: string } }>(`/v1/builds/${id}/duplicate`, {})).build.id;
const state = async (id: string) =>
  JSON.stringify([ok(await srv.call<{ code: string }>("GET", `/v1/builds/${id}/code`)).code, ok(await srv.call<{ build: { revision: number } }>("GET", `/v1/builds/${id}`)).build.revision, ok(await srv.call<{ stats: unknown[] }>("GET", `/v1/stats/${id}/sidebar`)).stats]);
const lines = (stats: Node["stats"]) => (Array.isArray(stats) ? stats : Object.values(stats));
const nodeOf = async (id: string, nodeId: number) => ok(await srv.call<Node>("GET", `/v1/lookup/nodes/${nodeId}?buildId=${id}`));
/** The passives within the Large radius of a socket. */
const largeRadius = async (id: string, socket: number) =>
  ok(await srv.call<{ radii: Array<{ label: string; nodes: Array<{ id: number }> }> }>("GET", `/v1/tree/${id}/radius-nodes?socket=${socket}&radius=Large`)).radii[0]?.nodes.map((n) => n.id) ?? [];

/** The jewel's text as the game gives it, written here and not taken from the engine's unique list. */
const lethalPride = (seed: number) =>
  `Rarity: UNIQUE\nLethal Pride\nTimeless Jewel\nRadius: Large\nImplicits: 0\nCommanded leadership over ${seed} warriors under Kaom\nPassives in radius are Conquered by the Karui\nHistoric`;
const elegantHubris = (seed: number) =>
  `Rarity: UNIQUE\nElegant Hubris\nTimeless Jewel\nRadius: Large\nImplicits: 0\nCommissioned ${seed} coins to commemorate Cadiro\nPassives in radius are Conquered by the Eternal Empire\nHistoric`;

/** The preview equals the jewel socketed for real: every passive the socketed jewel changes is listed with the same name and lines, no other is. */
async function matchesSocketed(p: Preview, text: string, socket: number) {
  const real = await dup(base);
  const added = ok(await post<{ result: { id: number } }>(`/v1/items/${real}/add`, { text, equip: `Jewel ${socket}` }));
  const radius = await largeRadius(base, socket);
  const changed: Changed[] = [];
  for (const id of radius) {
    const was = await nodeOf(base, id);
    const now = await nodeOf(real, id);
    if (was.name !== now.name || lines(was.stats).join("\n") !== lines(now.stats).join("\n")) changed.push({ id, type: "", name: was.name, becomes: now.name, stats: lines(now.stats), allocated: false });
  }
  assert.ok(changed.length > 30, `${changed.length} passives changed by the socketed jewel`);
  assert.deepEqual(p.nodes.map((n) => [n.id, n.name, n.becomes, n.stats]), changed.map((n) => [n.id, n.name, n.becomes, n.stats]));
  // taking the jewel out again gives the passives back, and so does the preview's "name"
  ok(await post(`/v1/items/${real}/delete`, { item: added.result.id }));
  for (const n of p.nodes.slice(0, 5)) {
    const back = await nodeOf(real, n.id);
    assert.deepEqual([back.name, lines(back.stats)], [n.name, lines((await nodeOf(base, n.id)).stats)]);
  }
}

before(async () => {
  srv = await startServer();
  const xml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
  loose = ok(await post<{ build: { id: string } }>("/v1/builds/import/xml", { xml })).build.id;
  base = await dup(loose);
  ok(await post(`/v1/tree/${base}/allocate`, { nodes: [41263, 21984] }));
});
after(async () => {
  await srv?.close();
});

void test("Lethal Pride with Kaom on the Large socket: the preview is what the socketed jewel gives", async () => {
  const p = await preview(base, "Lethal Pride", 12345, "Kaom", 21984);
  assert.deepEqual([p.jewel, p.seed, p.conqueror, p.socket, p.radius, p.nodes.length], ["Lethal Pride", 12345, "Kaom", 21984, "Large", 65]);
  assert.deepEqual(p.nodes.map((n) => n.id), [...p.nodes.map((n) => n.id)].sort((a, b) => a - b), "sorted by id");
  // the conqueror's keystone replaces Chaos Inoculation; a small passive gets +4 Strength added under its own line
  const keystone = p.nodes.find((n) => n.id === 11455);
  assert.deepEqual(keystone && [keystone.type, keystone.name, keystone.becomes, keystone.allocated], ["Keystone", "Chaos Inoculation", "Strength of Blood", false]);
  assert.deepEqual(p.nodes.find((n) => n.id === 1652)?.stats, ["15% increased Area of Effect of Hex Skills", " ", "+4 to Strength"]);
  assert.deepEqual(p.nodes.find((n) => n.id === 10153)?.stats, ["+30 to Strength", " ", "5% increased Strength"]);
  assert.equal(p.nodes.find((n) => n.id === 8948)?.allocated, undefined, "8948 is in the other socket's radius");
  await matchesSocketed(p, lethalPride(12345), 21984);
});

void test("Elegant Hubris with Cadiro: seeds count in steps of 20, and the preview is what the socketed jewel gives", async () => {
  const p = await preview(base, "elegant hubris", 20000, "cadiro", 21984);
  assert.deepEqual([p.jewel, p.conqueror, p.nodes.length], ["Elegant Hubris", "Cadiro", 65]);
  const keystone = p.nodes.find((n) => n.id === 11455);
  assert.deepEqual(keystone && [keystone.becomes, keystone.stats], ["Supreme Decadence", ["Life Recovery from Flasks also applies to Energy Shield", "30% less Life Recovery from Flasks"]]);
  assert.deepEqual(p.nodes.find((n) => n.id === 9567)?.becomes, "Freshly Brewed");
  await matchesSocketed(p, elegantHubris(20000), 21984);
  await fails(timeless(base, "Elegant Hubris", 20010, "Cadiro", 21984), 400, "invalid_input", /steps of 20/);
});

void test("a different seed gives a different set of passives; the other socket's radius holds other passives", async () => {
  const a = await preview(base, "Lethal Pride", 12345, "Kaom", 21984);
  const b = await preview(base, "Lethal Pride", 12346, "Kaom", 21984);
  assert.notDeepEqual(a.nodes.map((n) => n.stats), b.nodes.map((n) => n.stats));
  const small = await preview(base, "Lethal Pride", 12345, "Kaom", 41263);
  assert.ok(small.nodes.length > 0 && !small.nodes.some((n) => n.id === 11455));
  assert.ok(small.nodes.some((n) => n.allocated), "allocated passives are marked");
});

void test("the build is as it was after a preview, on an allocated and on an unallocated socket, and after a refusal", async () => {
  for (const id of [base, loose]) {
    const before0 = await state(id);
    for (const socket of [21984, 41263]) {
      assert.ok((await preview(id, "Lethal Pride", 12345, "Kaom", socket)).nodes.length > 0);
      assert.equal(await state(id), before0, `socket ${socket} on ${id}`);
    }
    await preview(id, "Glorious Vanity", 500, "Doryani", 21984);
    assert.equal(await state(id), before0, "Glorious Vanity");
    await fails(timeless(id, "Lethal Pride", 5, "Kaom", 21984), 400, "invalid_input", /seed/);
    assert.equal(await state(id), before0, "after a refusal");
  }
  // the socket is still not allocated, and a jewel put in it for real still works
  const tree = ok(await srv.call<{ nodes: Array<{ id: number }> }>("GET", `/v1/tree/${loose}/get`));
  assert.ok(!tree.nodes.some((n) => n.id === 21984));
  const real = await dup(base);
  ok(await post(`/v1/items/${real}/add`, { text: lethalPride(12345), equip: "Jewel 21984" }));
});

void test("an unallocated socket previews the same passives as an allocated one", async () => {
  const a = await preview(base, "Lethal Pride", 12345, "Kaom", 21984);
  const b = await preview(loose, "Lethal Pride", 12345, "Kaom", 21984);
  const strip = (p: Preview) => p.nodes.map((n) => [n.id, n.name, n.becomes, n.stats]);
  assert.deepEqual(strip(b), strip(a));
  assert.ok(a.nodes.some((n) => n.allocated) && !b.nodes.some((n) => n.allocated), "allocated marks follow the build's own tree");
});

void test("a socket that already holds a timeless jewel is read as if empty; the jewel stays", async () => {
  const id = await dup(base);
  ok(await post(`/v1/items/${id}/add`, { text: elegantHubris(20000), equip: "Jewel 21984" }));
  const before0 = await state(id);
  const p = await preview(id, "Lethal Pride", 12345, "Kaom", 21984);
  const clean = await preview(base, "Lethal Pride", 12345, "Kaom", 21984);
  assert.deepEqual(p.nodes.map((n) => [n.id, n.name, n.becomes, n.stats]), clean.nodes.map((n) => [n.id, n.name, n.becomes, n.stats]));
  assert.equal(await state(id), before0);
  assert.equal((await nodeOf(id, 11455)).name, "Supreme Decadence", "the socketed Elegant Hubris is still read");
});

void test("an Abyss jewel has no radius; Zorath's needs the socket allocated first", async () => {
  const p = await preview(base, "Festering Vengeance", 500, "Tecrod", 21984);
  assert.deepEqual([p.radius, p.nodes.length > 0], [null, true]);
  const z = await preview(base, "Reclaimed Malevolence", 500, "Zorath", 21984);
  assert.ok(z.nodes.length > 0);
  await fails(timeless(loose, "Reclaimed Malevolence", 500, "Zorath", 21984), 400, "invalid_input", /allocate the socket first/);
});

void test("refusals: unknown jewel, another jewel's conqueror, seed out of range, not a socket, unknown build", async () => {
  await fails(timeless(base, "Lethal Pryde", 12345, "Kaom", 21984), 400, "invalid_input", /unknown timeless jewel Lethal Pryde; jewels: .*Lethal Pride/);
  await fails(timeless(base, "Lethal Pride", 12345, "Cadiro", 21984), 400, "invalid_input", /unknown conqueror Cadiro for Lethal Pride; conquerors: Kaom, Kiloava, Rakiata, Akoya/);
  await fails(timeless(base, "Lethal Pride", 9999, "Kaom", 21984), 400, "invalid_input", /integer from 10000 to 18000/);
  await fails(timeless(base, "Lethal Pride", 18001, "Kaom", 21984), 400, "invalid_input", /integer from 10000 to 18000/);
  await fails(timeless(base, "Lethal Pride", 12345.5, "Kaom", 21984), 400, "invalid_input", /seed/);
  await fails(timeless(base, "Elegant Hubris", 160020, "Cadiro", 21984), 400, "invalid_input", /integer from 2000 to 160000/);
  await fails(timeless(base, "Lethal Pride", 12345, "Kaom", 1652), 400, "invalid_input", /node 1652 is not a jewel socket/);
  await fails(timeless(base, "Lethal Pride", 12345, "Kaom", 999999), 404, "not_found", /no passive node 999999/);
  await fails(timeless("0123456789abcdef", "Lethal Pride", 12345, "Kaom", 21984), 404, "not_found", /./);
  await fails(srv.call("GET", `/v1/tree/${base}/timeless-nodes?jewel=Lethal%20Pride&seed=12345&socket=21984`), 400, "invalid_input", /conqueror/);
});

void test("a preview reaches no sub-script or link, and the seed table's unpacked cache is refused outside the state dir", async () => {
  const pool = srv.runtime.svc.pool;
  await pool.run(base, "worker.reach"); // from zero
  assert.ok((await preview(base, "Lethal Pride", 12345, "Kaom", 21984)).nodes.length > 0);
  assert.deepEqual(await pool.run(base, "worker.reach").then((x) => x.result), { subScripts: 0, urls: 0, writes: ["./Data/TimelessJewelData/LethalPride.bin"] });
  assert.equal(existsSync(join(ROOT, "src/Data/TimelessJewelData/LethalPride.bin")), false, "nothing written next to the sources");
});
