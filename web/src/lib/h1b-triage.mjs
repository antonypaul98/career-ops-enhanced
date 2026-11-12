/**
 * Interpret the EXISTING local h1b-sponsor CLI. A DOL filing is not a visa
 * approval, employer commitment, work authorization, or verified job opening.
 * A plausible name match is not treated as a verified legal entity.
 */
const ALLOWED_TIERS = new Set(["strong", "moderate", "weak", "staffing-shop", "none", "unknown"]);
const legalSuffix = /\b(?:incorporated|inc|llc|ltd|limited|corp|corporation|co|plc)\b/g;
const canonicalName = s => String(s || "").normalize("NFKC").toLowerCase()
  .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const normalizeName = s => canonicalName(s).replace(legalSuffix, "").replace(/\s+/g, " ").trim();
// A legal suffix supplied explicitly by the caller is stronger evidence of
// their intended DOL record than an ambiguous one-word brand search.
const explicitLegalSuffix = /\b(?:incorporated|inc|llc|ltd|limited|corp|corporation|plc)\b/;

export function normalizeSponsorLookup(company, raw) {
  if (!raw || typeof raw !== "object" || raw.error || raw.found !== true) {
    return { status: "unresolved", tier: "unknown", note: "No verified employer entity match in the installed index." };
  }
  const resolved = String(raw.displayName || "").trim();
  const requested = normalizeName(company);
  // A bare brand such as "Microsoft" is ambiguous even if DOL returns
  // "Microsoft" as an exact label. But an explicit "Microsoft Corporation"
  // query can match the full named legal entity when the name is identical.
  // Neither case establishes the legal employer for a particular job posting.
  const exactLegalName = explicitLegalSuffix.test(canonicalName(company)) &&
    canonicalName(company) === canonicalName(resolved);
  const exact = Boolean(requested && requested === normalizeName(resolved) &&
    (requested.split(" ").length >= 2 || exactLegalName));
  const tier = ALLOWED_TIERS.has(raw.friendlinessTier) ? raw.friendlinessTier : "unknown";
  const lastYear = Number(raw.totals?.last_year);
  const lca = Number(raw.totals?.n_lca);
  const certified = raw.totals?.n_certified === null || raw.totals?.n_certified === undefined ?
    null : Number(raw.totals.n_certified);
  return {
    status: exact ? "matched" : "possible_entity",
    tier: exact ? tier : "unknown",
    resolvedName: resolved.slice(0, 150),
    // A DOL index is employer history only, never proof of eligibility now.
    lca: Number.isSafeInteger(lca) && lca >= 0 ? lca : null,
    certified: certified === null ? null : Number.isSafeInteger(certified) && certified >= 0 ? certified : null,
    lastYear: Number.isInteger(lastYear) && lastYear >= 2000 && lastYear <= 2100 ? lastYear : null,
    fetchedAt: typeof raw.fetchedAt === "string" ? raw.fetchedAt.slice(0, 32) : null,
    source: typeof raw.source === "string" ? raw.source.slice(0, 200) : null,
    note: exact
      ? "DOL employer filing history, not approval of this job's visa sponsorship or an H-1B transfer."
      : "Possible DOL entity, not confirmed to be the hiring legal employer; no ranking boost.",
  };
}
