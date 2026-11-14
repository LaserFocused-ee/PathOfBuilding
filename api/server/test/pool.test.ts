// Worker pool limits and failure handling, against real worker processes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { FIXTURES, ROOT, startServer } from "./helpers.js";

type Created = { build: { id: string } };
type Stat = { stat: string; value: number };

const fixtures = async () =>
  Promise.all([readFile(join(ROOT, "spec/TestBuilds/3.13/OccVortex.xml"), "utf8"), readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8")]);

/** Worker processes this test process started (children named luajit). */
async function luajitChildren(): Promise<number> {
  let n = 0;
  for (const pid of await readdir("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
    const m = /^\d+ \((.*)\) \S+ (\d+)/.exec(stat);
    if (m?.[1] === "luajit" && Number(m[2]) === process.pid) n += 1;
  }
  return n;
}

void test("one process serves two builds in turn, each with its own stats; an unknown build takes no process", async (t) => {
  const srv = await startServer({ poolSize: 1 });
  t.after(srv.close);
  const [occXml, freshXml] = await fixtures();
  const life = async (id: string) => {
    const r = await srv.call<{ stats: Stat[] }>("GET", `/v1/stats/${id}/sidebar`);
    assert.equal(r.status, 200);
    return r.body.result.stats.find((s) => s.stat === "Life")?.value;
  };
  const a = (await srv.call<Created>("POST", "/v1/builds/import/xml", { xml: occXml })).body.result.build.id;
  const b = (await srv.call<Created>("POST", "/v1/builds/import/xml", { xml: freshXml })).body.result.build.id;
  for (let i = 0; i < 2; i++) {
    assert.equal(await life(a), 6728);
    assert.equal(await life(b), 1328);
  }
  const holder = srv.runtime.svc.pool.workerFor(b);
  const missing = await srv.call("GET", "/v1/stats/0123456789abcdef/sidebar");
  assert.deepEqual([missing.status, missing.body.error?.code], [404, "not_found"]);
  assert.equal(srv.runtime.svc.pool.workerFor(b), holder, "the open session keeps its worker");
  assert.ok(holder?.alive);
  assert.ok(!srv.lines.some((l) => l.event === "worker.kill"), "no worker was killed");
  assert.equal(await luajitChildren(), 1);
});

void test("concurrent imports never run more worker processes than the pool size", async (t) => {
  const srv = await startServer({ poolSize: 2 });
  t.after(srv.close);
  const [, freshXml] = await fixtures();
  let peak = 0;
  const sample = setInterval(() => {
    void luajitChildren().then((n) => (peak = Math.max(peak, n)));
  }, 50);
  const res = await Promise.all(Array.from({ length: 6 }, (_, i) => srv.call<Created>("POST", "/v1/builds/import/xml", { xml: freshXml, name: `b${i}` })));
  clearInterval(sample);
  assert.deepEqual(res.map((r) => r.status), [200, 200, 200, 200, 200, 200]);
  assert.equal(await luajitChildren(), 2);
  assert.ok(peak <= 2, `peak ${peak} processes`);
  assert.equal(srv.runtime.svc.pool.stats().live, 2);
});

void test("a command written to a worker that was killed from outside rejects without an uncaught error", async (t) => {
  const srv = await startServer({ poolSize: 1 });
  t.after(srv.close);
  const [, freshXml] = await fixtures();
  const id = (await srv.call<Created>("POST", "/v1/builds/import/xml", { xml: freshXml })).body.result.build.id;
  const w = srv.runtime.svc.pool.workerFor(id);
  assert.ok(w);
  w.proc.kill("SIGKILL");
  // Block the event loop until the process is gone (a zombie), so its exit is not yet seen and the write hits a closed pipe.
  while (!/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${w.proc.pid}/stat`, "utf8")));
  await assert.rejects(w.call("stats.sidebar"), (e: Error & { code?: string }) => e.code === "worker_error");
  await new Promise((r) => setTimeout(r, 200)); // an unhandled EPIPE would surface here and fail the test
  const again = await srv.call<{ stats: Stat[] }>("GET", `/v1/stats/${id}/sidebar`);
  assert.equal(again.status, 200, "the session reloads from the store");
  assert.equal(again.body.result.stats.find((s) => s.stat === "Life")?.value, 1328);
});
