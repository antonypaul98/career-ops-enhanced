import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source contract for browser-only TSX surfaces; typecheck/build run in Web CI.
// No model call required. The failure link must never remove shortlist actions.
const triage = readFileSync(new URL("../../src/components/inbox/inbox-triage.tsx", import.meta.url), "utf8");
const row = readFileSync(new URL("../../src/components/inbox/triage-row.tsx", import.meta.url), "utf8");

test("latest failed evaluation stays linked but is not a numeric score", () => {
  assert.match(triage, /if \(!ex \|\| j\.startedAt > ex\.startedAt\) best\.set\(j\.input, j\)/);
  assert.match(triage, /failed: j\.status === "error"/);
  assert.match(row, /const evaluated = !!scored && \(scored\.running \|\| scored\.score != null\)/);
  assert.match(row, /!scored\?\.running && scored\?\.score == null/);
  assert.match(row, /\{scored\?\.failed && \(/);
  assert.match(row, /Failed · details/);
  assert.match(row, /href=\{\x60\/jobs\/\$\{scored\.jobId\}\x60\}/);
});

test("failed status link and Save/Skip appear in the same unscored actions branch", () => {
  const linkStart = row.indexOf("{scored?.failed && (");
  const save = row.indexOf("onClick={onSave}", linkStart);
  const skip = row.indexOf("onClick={onSkip}", save);
  const actionsEnd = row.indexOf("</div>", linkStart);
  assert.ok(linkStart >= 0 && save > linkStart && skip > save && actionsEnd > skip,
    "failed link must coexist with both onSave and onSkip controls");
  assert.match(row.slice(linkStart, actionsEnd), /Save to shortlist/);
  assert.match(row.slice(linkStart, actionsEnd), /Skip — hide from the inbox/);
});

test("running or scored entries render a worker link without fabricating a grade", () => {
  assert.match(row, /scored!\.running \?/);
  assert.match(row, /<Badge tone=\{scored!\.tone\}>\{scored!\.score\}\/5<\/Badge>/);
  assert.doesNotMatch(row, /scored!\.failed \?/);
});
