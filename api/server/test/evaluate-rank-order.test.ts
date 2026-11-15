// gem_rank leaves the build code as it was whichever candidate the gem box calculates last. The box walks its gems in pairs
// order, which differs from process to process, and Path of Building writes the minion choice of a calculation back onto the
// group's gem (CalcActiveSkill.lua); so the worker here runs a copy of the Lua ops whose box calculates Summon Phantasm last.
import assert from "node:assert/strict";
import { cp, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { FIXTURES, ROOT, startServer, tempDir } from "./helpers.js";

const drain = "if box.sortCache.pendingGems then drain(box.DPSBuilder, box) end";
const phantasmLast = `local pending = box.sortCache.pendingGems
			if pending then
				local function last(id) return box.gems[id].name == "Summon Phantasm" end
				table.sort(pending, function(a, b) if last(a) ~= last(b) then return last(b) end return a < b end)
			end
			`;

void test("gem_rank leaves the build code as it was when the minion-granting candidate is calculated last", async (t) => {
  const mirror = await tempDir("rank-order");
  t.after(mirror.remove);
  await cp(join(ROOT, "api/lua"), join(mirror.path, "api/lua"), { recursive: true });
  await symlink(join(ROOT, "src"), join(mirror.path, "src"));
  const file = join(mirror.path, "api/lua/ops/evaluate.lua");
  const lua = await readFile(file, "utf8");
  assert.ok(lua.includes(drain), "the gem box's calculation line the order is forced at");
  await writeFile(file, lua.replace(drain, phantasmLast + drain));

  const srv = await startServer({ pobRoot: mirror.path });
  t.after(srv.close);
  const xml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
  const imported = await srv.call<{ build: { id: string } }>("POST", "/v1/builds/import/xml", { xml });
  const id = imported.body.result.build.id;
  const code = async () => (await srv.call<{ code: string }>("GET", `/v1/builds/${id}/code`)).body.result.code;
  const before = await code();
  const ranked = await srv.call<{ total: number; gems: Array<{ name: string }> }>("POST", `/v1/evaluate/${id}/gem-rank`, { group: 1, stat: "FullDPS", limit: 200 });
  assert.equal(ranked.status, 200, JSON.stringify(ranked.body.error));
  assert.ok(ranked.body.result.gems.some((g) => g.name === "Summon Phantasm"), "the minion-granting candidate was calculated");
  assert.equal(await code(), before, "gem-rank changed the build code");
});
