// A worker killed from outside: the next command rejects cleanly and the session reloads from the store.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { FIXTURES, ROOT, startServer } from "./helpers.js";

type Created = { build: { id: string } };
type Stat = { stat: string; value: number };

const fixtures = async () =>
  Promise.all([readFile(join(ROOT, "spec/TestBuilds/3.13/OccVortex.xml"), "utf8"), readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8")]);

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
