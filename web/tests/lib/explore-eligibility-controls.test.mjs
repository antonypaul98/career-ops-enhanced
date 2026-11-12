import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { matchesExploreQualifications } from "../../src/lib/explore-qualifier.mjs";

const filterUI = readFileSync(fileURLToPath(new URL("../../src/components/explore/filter-builder.tsx", import.meta.url)), "utf8");
const offerUI = readFileSync(fileURLToPath(new URL("../../src/components/explore/discovery-card.tsx", import.meta.url)), "utf8");
const pageUI = readFileSync(fileURLToPath(new URL("../../src/components/explore/explorer-view.tsx", import.meta.url)), "utf8");
const config = readFileSync(fileURLToPath(new URL("../../src/lib/explore.ts", import.meta.url)), "utf8");

const base = {
  usOnly: true, employmentTypes: ["full_time"], requireSponsorship: true, noClearance: true,
};
const sample = {
  location: "Remote, USA", employmentType: "full_time",
  sponsorship: "unknown", clearance: "unknown",
};

test("strict evidence filters exclude unknown values and candidate discovery can explicitly broaden", () => {
  assert.equal(matchesExploreQualifications(sample, base), false);
  assert.equal(matchesExploreQualifications(sample, {...base, requireSponsorship: false}), false);
  assert.equal(matchesExploreQualifications(sample, {...base, noClearance: false}), false);
  assert.equal(matchesExploreQualifications(sample, {...base, requireSponsorship: false, noClearance: false}), true);
  assert.equal(matchesExploreQualifications({...sample, location: "Remote"}, {...base, requireSponsorship: false, noClearance: false}), false);
  assert.equal(matchesExploreQualifications({...sample, employmentType: "unknown"}, {...base, requireSponsorship: false, noClearance: false}), false);
  assert.equal(matchesExploreQualifications({...sample, sponsorship: "not_offered"}, {...base, noClearance: false}), false);
  assert.equal(matchesExploreQualifications({...sample, clearance: "required", sponsorship: "offered"}, base), false);
});

test("the existing evidence filters are accessible from the Explore UI and survive URL serialization", () => {
  assert.match(filterUI, /checked=\{filters\.requireSponsorship\}/);
  assert.match(filterUI, /onChange=\{\(e\) => set\(\{ requireSponsorship: e\.target\.checked \}\)\}/);
  assert.match(filterUI, /checked=\{filters\.noClearance\}/);
  assert.match(filterUI, /onChange=\{\(e\) => set\(\{ noClearance: e\.target\.checked \}\)\}/);
  assert.match(filterUI, /Broader discovery is for review only/);
  assert.match(config, /sp\.set\("sponsor", String\(f\.requireSponsorship\)\)/);
  assert.match(config, /sp\.set\("noclear", String\(f\.noClearance\)\)/);
  assert.match(config, /requireSponsorship: sp\.get\("sponsor"\) \?\? undefined/);
  assert.match(config, /noClearance: sp\.get\("noclear"\) \?\? undefined/);
});

test("broadened results still clearly distinguish unverified and negative eligibility", () => {
  assert.match(offerUI, /Sponsorship unverified/);
  assert.match(offerUI, /Sponsorship not offered/);
  assert.match(offerUI, /Sponsorship advertised/);
  assert.match(offerUI, /Clearance unverified/);
  assert.match(offerUI, /Clearance requirement advertised/);
  assert.match(offerUI, /not verification of your visa eligibility/);
  assert.match(pageUI, /onRefine=\{\(\) => setRefineOpen\(true\)\}/);
  assert.match(pageUI, /capHit \? onRefine : onRetry/);
  assert.match(pageUI, /Strict sponsorship or clearance evidence filters/);
});
