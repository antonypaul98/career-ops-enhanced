import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { comparePriority, priorityReasons } from "../../src/lib/discovery-priority.mjs";
import { normalizeSponsorLookup } from "../../src/lib/h1b-triage.mjs";

const TODAY = new Date("2026-11-12T15:00:00Z");
const base = {
  title: "Platform Engineer", company: "Fictional Tech LLC",
  url: "https://example.org/job/1", location: "Remote, US",
  employmentType: "full_time", sponsorship: "unknown", clearance: "unknown",
  postedAt: "2026-11-11", fit: {band: "strong", score: 88},
};

test("silent sponsorship remains recommendable, with explicit role sponsorship prioritized", () => {
  const silent = {...base};
  const offered = {...base, url: "https://example.org/job/2", sponsorship: "offered"};
  const none = {...base, url: "https://example.org/job/3", sponsorship: "not_offered"};
  const list = [none, silent, offered].sort((a,b) => comparePriority(a,b,{},TODAY));
  assert.deepEqual(list.map(item => item.sponsorship), ["offered", "unknown", "not_offered"]);
  assert.equal(list.length, 3);
  assert.equal(priorityReasons(silent, null, TODAY).eligibilityVerified, false);
  assert.equal(priorityReasons(offered, null, TODAY).isHiringProbability, false);
});

test("strong target fit matters, but unknown employer evidence isn't treated as negative", () => {
  const strong = {...base, fit: {band: "strong"}, sponsorship: "unknown"};
  const weak = {...base, fit: {band: "weak"}, sponsorship: "unknown"};
  assert.ok(priorityReasons(strong,null,TODAY).points > priorityReasons(weak,null,TODAY).points);
  assert.ok(priorityReasons({...base,sponsorship:"not_offered"},null,TODAY).points <
    priorityReasons({...base,sponsorship:"unknown"},null,TODAY).points);
});

test("only a recent, exact-entity DOL history can modestly improve priority", () => {
  const unknown = priorityReasons(base,null,TODAY).points;
  assert.equal(priorityReasons(base,{status:"possible_entity",tier:"strong",lastYear:2026},TODAY).points,unknown);
  assert.equal(priorityReasons(base,{status:"matched",tier:"strong",lastYear:2021},TODAY).points,unknown);
  assert.equal(priorityReasons(base,{status:"matched",tier:"staffing-shop",lastYear:2026},TODAY).points,unknown);
  assert.equal(priorityReasons(base,{status:"matched",tier:"strong",lastYear:2026},TODAY).points,unknown + 4);
  assert.ok(priorityReasons({...base,sponsorship:"not_offered"},{
    status:"matched",tier:"strong",lastYear:2026},TODAY).points < unknown);
});

test("unresolved filing entity stays unknown; no fabricated H1B evidence", () => {
  assert.equal(normalizeSponsorLookup("Fictional Co",null).status,"unresolved");
  assert.equal(normalizeSponsorLookup("Fictional Co",{found:false,displayName:"Fictional Co"}).status,"unresolved");
  assert.equal(normalizeSponsorLookup("AWS",{
    found:true,displayName:"AWS Security Assurances Services LLC",friendlinessTier:"strong",
    totals:{n_lca:800,last_year:2026},
  }).status,"possible_entity");
  assert.equal(normalizeSponsorLookup("Google",{
    found:true, displayName:"Google LLC", friendlinessTier:"strong",
    totals:{n_lca:2000,last_year:2026},
  }).status,"possible_entity");
  const exact = normalizeSponsorLookup("Fictional Tech",{
    found:true,displayName:"Fictional Tech LLC",friendlinessTier:"moderate",
    totals:{n_lca:42,n_certified:30,last_year:2026},source:"local-dol-index",
  });
  assert.deepEqual({status:exact.status,tier:exact.tier,lca:exact.lca,certified:exact.certified},
    {status:"matched",tier:"moderate",lca:42,certified:30});
  assert.match(exact.note,/not approval/);
});

test("default Explore discovery includes unknown types and silent sponsorship without changing application gates", () => {
  const client = fs.readFileSync(fileURLToPath(new URL("../../src/lib/explore.ts",import.meta.url)),"utf8");
  const route = fs.readFileSync(fileURLToPath(new URL("../../src/app/api/h1b-history/route.ts",import.meta.url)),"utf8");
  assert.match(client,/employmentTypes: \["c2c", "full_time", "unknown"\]/);
  assert.match(client,/requireSponsorship: false/);
  assert.match(client,/noClearance: false/);
  assert.match(route,/delete env\.H1B_API_BASE/);
  assert.match(route,/delete env\.H1B_API_TOKEN/);
  assert.match(route,/index_missing/);
  assert.doesNotMatch(route,/fetch\s*\(/);
});
