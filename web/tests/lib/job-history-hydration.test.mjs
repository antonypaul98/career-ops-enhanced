import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// JobsProvider is a client-side TSX component, so this contract test exercises
// its persistence ordering without launching a browser or spending model tokens.
const source = readFileSync(new URL("../../src/components/jobs/job-store.tsx", import.meta.url), "utf8");

test("worker history is restored before initial empty jobs can be persisted", () => {
  const restoreStart = source.indexOf("  // restore history");
  const persistStart = source.indexOf("  // persist", restoreStart);
  const patchStart = source.indexOf("  const patch =", persistStart);
  assert.ok(restoreStart >= 0 && persistStart > restoreStart && patchStart > persistStart);

  const restore = source.slice(restoreStart, persistStart);
  const persist = source.slice(persistStart, patchStart);

  assert.match(source, /const \[historyLoaded, setHistoryLoaded\] = useState\(false\)/);
  assert.match(restore, /setJobs\(arr\.map\(/, "restore jobs from localStorage before unlocking persistence");
  assert.match(restore, /setHistoryLoaded\(true\)/, "hydration must unlock persistence through rendered state");
  assert.match(persist, /if \(!historyLoaded\) return;/, "initial mount with jobs=[] must not overwrite saved history");
  assert.match(persist, /localStorage\.setItem\(JOBS_KEY/, "normal updates must still persist");
  assert.match(persist, /\}, \[jobs, historyLoaded\]\);/, "restoration must rerun persistence with restored jobs");
  assert.doesNotMatch(source, /loaded\.current/, "ref-based hydration gate can unlock in the initial mount effect");
});
