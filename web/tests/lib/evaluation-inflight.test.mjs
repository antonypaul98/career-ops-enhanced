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

test("whitespace and anchor fragments cannot evade same-posting duplicate detection", () => {
  const base = "https://example.com/jobs/synthetic-003";
  const release = acquireEvaluation("  " + base + "#details  ");
  assert.equal(typeof release, "function");
  assert.equal(acquireEvaluation(base), null, "same server URL without fragment must collide");
  assert.equal(acquireEvaluation(base + "#requirements"), null, "fragment changes must collide");
  assert.equal(acquireEvaluation("\t" + base + "\n"), null, "surrounding whitespace must collide");
  const separateQuery = acquireEvaluation(base + "?application=other");
  assert.equal(typeof separateQuery, "function", "distinct query parameters remain distinct");
  release();
  release();
  const retry = acquireEvaluation(base + "#details");
  assert.equal(typeof retry, "function", "releasing a normalized key permits retry");
  retry();
  separateQuery();
});

test("invalid posting identifiers cannot acquire an in-flight evaluation", () => {
  for (const value of ["", "   ", null, undefined, {}, 7]) {
    assert.equal(acquireEvaluation(value), null);
  }
});

test("SPA job identities stay distinct while tracking links cannot duplicate a worker", () => {
  const release = acquireEvaluation("https://careers.example.com/#/jobs/100");
  const other = acquireEvaluation("https://careers.example.com/#/jobs/200");
  try {
    assert.equal(typeof other, "function", "different SPA jobs must not collide");
    assert.equal(acquireEvaluation("https://careers.example.com/?utm_source=mail#/jobs/100"), null);
  } finally { release?.(); other?.(); }
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
