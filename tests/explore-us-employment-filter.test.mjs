import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { employmentVerdict } from "../lib/explore-qualifier.mjs";
import { usLocationVerdict, matchesExploreQualifications } from "../web/src/lib/explore-qualifier.mjs";

test("USA-only accepts explicit states, DC, and US remote, not ambiguous remote", () => {
  for (const loc of ["Austin, TX", "New York, NY", "California", "Washington, DC", "Remote - United States", "Remote, USA", "Chicago, Illinois"]) {
    assert.equal(usLocationVerdict(loc), "us", loc);
  }
  for (const loc of ["London, UK", "Remote, India", "Toronto, Canada", "US / Europe", "New York, NY; London, UK"]) {
    assert.equal(usLocationVerdict(loc), "non_us", loc);
  }
  for (const loc of ["Remote", "Worldwide", "", "CA", "Georgia", "Dublin", "Remote, unspecified"]) {
    assert.notEqual(usLocationVerdict(loc), "us", loc);
  }
});

test("explicit C2C is distinct from W2-only, 1099, unspecified contract, and negated C2C", () => {
  assert.equal(employmentVerdict({ title:"Data Engineer - C2C", description:"Corp to corp engagement" }), "c2c");
  assert.equal(employmentVerdict({ title:"Data Engineer", description:"C2C accepted. Remote in USA." }), "c2c");
  for (const description of ["Contract only, 1099 accepted", "No C2C applicants", "C2C not accepted", "W2 only", "Contract to hire"]) {
    assert.equal(employmentVerdict({ title:"Data Engineer", description }), "unknown", description);
  }
});

test("full-time detected from positive evidence, not from full-time contract hours", () => {
  assert.equal(employmentVerdict({title:"Senior Data Engineer - Full-time"}), "full_time");
  assert.equal(employmentVerdict({title:"Data Engineer",description:"Permanent employee position"}), "full_time");
  assert.equal(employmentVerdict({title:"Full-time contract consultant"}), "unknown");
  assert.equal(employmentVerdict({title:"Data Engineer",description:"We are hiring engineers"}), "unknown");
});

test("selected C2C plus full-time rejects unknown and foreign posts", () => {
  const f = {usOnly:true,employmentTypes:["c2c","full_time"]};
  assert.equal(matchesExploreQualifications({location:"Austin, TX",employmentType:"c2c"},f),true);
  assert.equal(matchesExploreQualifications({location:"Remote, USA",employmentType:"full_time"},f),true);
  assert.equal(matchesExploreQualifications({location:"Remote",employmentType:"c2c"},f),false);
  assert.equal(matchesExploreQualifications({location:"Paris, France",employmentType:"c2c"},f),false);
  assert.equal(matchesExploreQualifications({location:"Austin, TX",employmentType:"unknown"},f),false);
  assert.equal(matchesExploreQualifications({location:"Austin, TX"},f),false);
  assert.equal(matchesExploreQualifications({location:"Austin, TX",employmentType:"unknown"},{...f,employmentTypes:["unknown"]}),true);
});

test("scanner sends only category labels, never full private job text; approval files untouched", () => {
  const scanner = readFileSync(new URL("../scan-ats-full.mjs",import.meta.url),"utf8");
  const web = readFileSync(new URL("../web/src/lib/core/scan.ts",import.meta.url),"utf8");
  const ui = readFileSync(new URL("../web/src/components/explore/filter-builder.tsx",import.meta.url),"utf8");
  assert.match(scanner,/employmentType: employmentVerdict\(job\)/);
  assert.match(scanner,/employmentType: employmentVerdict\(o\)/);
  assert.match(web,/matchesExploreQualifications\(o, filters\)/);
  assert.match(web,/matchesExploreQualifications\(\{ \.\.\.pending, url, employmentType: "unknown" \}, filters\)/);
  assert.match(ui,/United States only/);
  assert.match(ui,/Corp-to-Corp \(C2C\)/);
  assert.doesNotMatch(scanner.slice(scanner.indexOf("export function formatLiveOfferLine"),scanner.indexOf("export function parseLiveOfferLine")),/description:|resume:|answer:/);
});
