/**
 * Explainable discovery order, NOT an ATS match %, immigration eligibility,
 * or probability of being hired. All offers remain visible, even with
 * unknown/adverse sponsorship or clearance evidence.
 */
const safeDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(value + "T00:00:00Z"));

export function priorityReasons(offer, history = null, now = new Date()) {
  const reasons = [];
  let points = 0;
  const add = (value, reason) => { points += value; reasons.push(reason); };
  if (offer.fit?.band === "strong") add(6, "Strong title-to-target-role overlap (not verified skills)");
  else if (offer.fit?.band === "related") add(3, "Related target role");
  if (offer.sponsorship === "offered") add(9, "Sponsorship mentioned by this posting; role-specific details require confirmation");
  else if (offer.sponsorship === "not_offered") add(-12, "Posting says sponsorship is not offered");
  else reasons.push("Posting sponsorship not established");

  if (offer.clearance === "required") add(-8, "Clearance requirement indicated in posting");
  else if (offer.clearance === "not_required") add(1, "Posting explicitly says clearance not required");
  else reasons.push("Clearance requirement unknown");

  if (offer.employmentType === "full_time") add(2, "Full-time classified from posting");
  else if (offer.employmentType === "c2c") add(1, "C2C classified from posting");
  else reasons.push("Employment type unverified");

  // History is a separate *company* signal. An unverified legal-entity match,
  // stale data, missing index, or Reddit anecdote must never add points.
  if (history?.status === "matched" && Number.isSafeInteger(history.lca) && history.lca > 0 &&
      history.lastYear >= now.getUTCFullYear() - 2) {
    if (history.tier === "strong" || history.tier === "moderate")
      add(4, "DOL employer LCA history and recent overall activity; not proof of sponsorship for this role");
    else if (history.tier === "weak")
      add(1, "Some recent employer filing history; not role authorization");
  }
  if (safeDate(offer.postedAt)) {
    const ageDays = Math.floor((now.getTime() - Date.parse(offer.postedAt + "T00:00:00Z")) / 86400000);
    if (ageDays >= 0 && ageDays <= 7) add(2, "Recently posted");
    else if (ageDays >= 0 && ageDays <= 30) add(1, "Posted within 30 days");
  }
  return { points, reasons, isHiringProbability: false, eligibilityVerified: false };
}

export function comparePriority(a, b, histories = {}, now = new Date()) {
  const ar = priorityReasons(a, histories[a.company] || null, now).points;
  const br = priorityReasons(b, histories[b.company] || null, now).points;
  return br - ar || String(b.postedAt || "").localeCompare(String(a.postedAt || "")) ||
    String(a.company || "").localeCompare(String(b.company || "")) ||
    String(a.url || "").localeCompare(String(b.url || ""));
}
