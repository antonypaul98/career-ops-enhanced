import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { priorityReasons } from "../../src/lib/discovery-priority.mjs";
import { matchesExploreQualifications } from "../../src/lib/explore-qualifier.mjs";

const source = relative => fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const filter = source("../../src/components/explore/filter-builder.tsx");
const page = source("../../src/components/explore/explorer-view.tsx");
const results = source("../../src/components/explore/results-list.tsx");
const defaults = source("../../src/lib/explore.ts");
const safety = source("../../src/components/explore/company-evidence.tsx");
const route = source("../../src/app/api/h1b-history/route.ts");

test("broad discovery defaults are visible, reversible, and never prove eligibility", () => {
  assert.match(defaults, /employmentTypes: \["c2c", "full_time", "unknown"\]/);
  assert.match(defaults, /requireSponsorship: false/);
  assert.match(defaults, /noClearance: false/);
  assert.match(filter, /checked=\{filters\.requireSponsorship\}/);
  assert.match(filter, /checked=\{filters\.noClearance\}/);
  assert.match(filter, /Broader discovery is for review only/);
  assert.match(results, /Priority is a transparent triage order, not an ATS score/);
  const offer = {location:"Remote, US", sponsorship:"unknown",clearance:"unknown",employmentType:"unknown"};
  const broad = {usOnly:true,requireSponsorship:false,noClearance:false,employmentTypes:["full_time","unknown"]};
  assert.equal(matchesExploreQualifications(offer,broad),true);
  assert.equal(matchesExploreQualifications(offer,{...broad,requireSponsorship:true}),false);
  assert.equal(matchesExploreQualifications(offer,{...broad,noClearance:true}),false);
  assert.equal(priorityReasons(offer).eligibilityVerified,false);
});

test("capped no-results CTA goes to the actually displayed filter form", () => {
  assert.match(page,/id="explore-discovery-filters"/);
  assert.match(page,/getElementById\("explore-discovery-filters"\)\?\.scrollIntoView/);
  assert.match(page,/capHit \? onRefine : onRetry/);
  assert.match(page,/Use Refine search to adjust eligibility filters/);
});

test("company H1B and Reddit research are explicit actions, not silent network surveillance", () => {
  assert.match(safety,/onClick=\{\(\) => void check\(\)\}/);
  assert.match(safety,/Recent Reddit discussions/);
  assert.match(safety,/Verify employer/);
  assert.match(route,/H1B_INDEX_PATH/);
  assert.match(route,/resolveCodeRoot\(process\.cwd\(\), process\.env\)/);
  assert.match(route,/path\.join\(codeRoot, "plugins", "h1b-sponsor", "check\.mjs"\)/);
  assert.match(route,/delete env\.H1B_API_BASE/);
  assert.match(route,/delete env\.H1B_API_TOKEN/);
  assert.doesNotMatch(route,/\bfetch\s*\(/);
});
