import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source contract for the browser-only TSX surfaces; full typecheck/build runs
// in Web CI. No provider call is required to test failed-worker visibility.
const triage = readFileSync(new URL("../../src/components/inbox/inbox-triage.tsx", import.meta.url), "utf8");
const row = readFileSync(new URL("../../src/components/inbox/triage-row.tsx", import.meta.url), "utf8");

test("the latest failed evaluation is never silently hidden as an unattempted score", () => {
  assert.match(triage, /if \(!ex \|\| j\.startedAt > ex\.startedAt\) best\.set\(j\.input, j\)/);
  assert.match(triage, /failed: j\.status === "error"/);
  assert.match(row, /scored\.running \|\| scored\.failed \|\| scored\.score != null/);
  assert.match(row, /scored!\.failed \?/);
  assert.match(row, /href=\{\x60\/jobs\/\$\{scored!\.jobId\}\x60\}/);
  assert.match(row, /Failed · details/);
  assert.match(row, /!scored\?\.running && scored\?\.score == null/);
});

test("a failed evaluation is not presented as a successful numeric grade", () => {
  const failedBranch = row.indexOf("scored!.failed ?");
  const gradeBranch = row.indexOf("<Badge tone={scored!.tone}>");
  assert.ok(failedBranch !== -1 && gradeBranch > failedBranch, "a failure is handled before grade rendering");
  assert.match(row.slice(failedBranch, gradeBranch), /AlertCircle/);
});
