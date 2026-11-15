import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { acquireEvaluation } from "../../src/lib/evaluation-inflight.mjs";

test("the same posting cannot launch two concurrent evaluation workers", () => {
  const url = "https://example.com/jobs/synthetic-001";
  const firstRelease = acquireEvaluation(url);
  assert.equal(typeof firstRelease, "function");
  assert.equal(acquireEvaluation(url), null, "second identical request must not start");
  // A distinct posting can run concurrently.
  const otherRelease = acquireEvaluation("https://example.com/jobs/synthetic-002");
  assert.equal(typeof otherRelease, "function");
  firstRelease();
  firstRelease(); // releasing twice cannot undo a later reservation
  const secondRelease = acquireEvaluation(url);
  assert.equal(typeof secondRelease, "function", "after completion a real retry is permitted");
  assert.equal(acquireEvaluation(url), null);
  secondRelease();
  otherRelease();
});

test("invalid posting identifiers cannot acquire an in-flight evaluation", () => {
  for (const value of ["", "   ", null, undefined, {}, 7]) {
    assert.equal(acquireEvaluation(value), null);
  }
});

test("route rejects duplicate evaluations before spawn and releases on every exit path", () => {
  const route = readFileSync(new URL("../../src/app/api/run/route.ts", import.meta.url), "utf8");
  const guard = route.indexOf("const releaseEvaluation = kind === \"evaluate\"");
  const spawn = route.indexOf("child = spawnHeadlessCli(");
  assert.ok(guard !== -1 && guard < spawn, "duplicate check must precede model launch");
  assert.match(route, /if \(kind === "evaluate" && !releaseEvaluation\)/);
  assert.match(route, /releaseEvaluation\?\.\(\);/);
  assert.ok((route.match(/releaseEvaluation\?\.\(\);/g) ?? []).length >= 2,
    "both spawn refusal and run finalizer must release");
});
