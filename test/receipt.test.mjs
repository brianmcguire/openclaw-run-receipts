import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectReceipt } from "../dist/receipt.js";

const jobId = "example-job";
const runAtMs = 1_700_000_000_000;
const run = { jobId, status: "ok", runAtMs, durationMs: 1_000 };

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "run-receipts-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return {
    path: join(dir, jobId + ".json"),
    check: (entry = run) => inspectReceipt({ entries: [entry] }, dir, jobId),
    write: (generatedAt, resultCount = 0) => writeFile(
      join(dir, jobId + ".json"), JSON.stringify({ jobId, generatedAt, resultCount }),
    ),
  };
}

test("a green scheduler run can have a stale or missing report", async (t) => {
  const data = await fixture(t);
  assert.equal((await data.check()).evidenceStatus, "missing");
  await data.write(runAtMs - 1);
  const snapshot = await data.check();
  assert.equal(snapshot.runStatus, "ok");
  assert.equal(snapshot.evidenceStatus, "stale");
});

test("a fresh report with zero results is verified", async (t) => {
  const data = await fixture(t);
  await data.write(runAtMs + 1);
  const snapshot = await data.check();
  assert.equal(snapshot.evidenceStatus, "verified");
  assert.equal(snapshot.resultCount, 0);
});

test("post-run and invalid evidence are unverified", async (t) => {
  const data = await fixture(t);
  await data.write(runAtMs + 1_001);
  assert.equal((await data.check()).evidenceStatus, "unknown");
  await data.write(runAtMs, -1);
  assert.equal((await data.check()).evidenceStatus, "unknown");
  await writeFile(data.path, Buffer.alloc(64 * 1024 + 1));
  assert.equal((await data.check()).evidenceStatus, "unknown");
});

test("an incomplete or unsuccessful run cannot verify a fresh report", async (t) => {
  const data = await fixture(t);
  await data.write(runAtMs);
  for (const entry of [{ ...run, durationMs: undefined }, { ...run, status: "error" }]) {
    assert.equal((await data.check(entry)).evidenceStatus, "unknown");
  }
});

test("the report reader refuses symlink targets", async (t) => {
  const data = await fixture(t);
  const target = data.path + ".target";
  await writeFile(target, JSON.stringify({ jobId, generatedAt: runAtMs, resultCount: 0 }));
  await symlink(target, data.path);
  assert.equal((await data.check()).evidenceStatus, "unknown");
});
