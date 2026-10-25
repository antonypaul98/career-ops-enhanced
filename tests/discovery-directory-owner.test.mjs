// Regression guard: the ATS directory repo was transferred to its canonical
// owner. The old owner redirects, but providers/_http.mjs refuses redirects
// by default for SSRF safety; a stale owner causes every directory fetch to
// fail even while the individual Greenhouse/Lever/Ashby APIs remain reachable.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scanner = readFileSync(new URL("../scan-ats-full.mjs", import.meta.url), "utf8");

test("reverse ATS scanner uses the canonical company-directory owner", () => {
  assert.match(
    scanner,
    /const DATASET_BASE = 'https:\/\/raw\.githubusercontent\.com\/Riley-Dorrington\/job-board-aggregator\/main\/data';/,
  );
  assert.doesNotMatch(scanner, /raw\.githubusercontent\.com\/Feashliaa\/job-board-aggregator/);
});

test("supported source lists still resolve under the common base", () => {
  for (const provider of ["greenhouse", "lever", "ashby", "workday"]) {
    assert.ok(scanner.includes("dataset: \u0060\u0024{DATASET_BASE}/" + provider + "_companies.json\u0060"), provider);
  }
});
