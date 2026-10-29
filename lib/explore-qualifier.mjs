// Core scanner: conservative employment and applicant-requirement evidence.
// No resume, personal information, or raw description is emitted to Explore.
// Company descriptions are untrusted and not necessarily an employment agreement.
// Full-time hours do not prove permanent employment; explicit contract signals
// prevent us from claiming full-time employment from hours alone.
const C2C = /\b(?:c2c|corp(?:oration)?[\s-]*to[\s-]*corp(?:oration)?)\b/i;
const C2C_REJECT = /(?:\b(?:no|not|without|prohibit(?:ed)?|exclude(?:d)?|cannot|can't|won't|do\s+not|does\s+not|not\s+accepting)\b[^.\n;]{0,45}\b(?:c2c|corp(?:oration)?[\s-]*to[\s-]*corp(?:oration)?))|(?:\b(?:c2c|corp(?:oration)?[\s-]*to[\s-]*corp(?:oration)?)\b[^.\n;]{0,45}\b(?:not|unavailable|prohibited|excluded|declined|disallowed))|(?:\bw[\s-]*2\s+only\b)/i;
const CONTRACT = /\b(?:contract(?:or|ual|ing)?|temporary|temp-to-hire|fixed[\s-]*term|freelanc(?:e|er)|1099|c2c|corp[\s-]*to[\s-]*corp)\b/i;
const FULLTIME = /\b(?:full[\s-]*time|permanent\s+(?:employee|employment|position|role|hire)|regular\s+employee)\b/i;

export function employmentVerdict({title="", description="", employmentType=""}={}) {
  const headline = [title, employmentType].filter(x=>typeof x==="string").join("\n").slice(0,1000);
  const body = typeof description==="string" ? description.slice(0,60000) : "";
  const all = headline+"\n"+body;
  if (C2C.test(all) && !C2C_REJECT.test(all)) return "c2c";
  if (FULLTIME.test(all) && !CONTRACT.test(all)) return "full_time";
  return "unknown";
}


// Explicit employer statements only. No mention is UNKNOWN (not an approval).
const SPONSOR_YES = /\b(?:visa|immigration|h[\s-]*1b|work[\s-]*visa|employment[\s-]*visa)[\s\S]{0,45}\b(?:sponsorship\s+(?:is\s+)?(?:available|provided|offered)|sponsor(?:ship)?\s+(?:available|provided|offered)|we\s+sponsor)|\b(?:sponsor(?:s|ing)?\s+(?:for\s+)?(?:work\s+)?visas?|offer(?:s|ing)?\s+(?:visa|immigration)\s+sponsorship)\b/i;
const SPONSOR_NO = /\b(?:no|without|not|cannot|can't|unable|won't|do\s+not|does\s+not|never|ineligible\s+for)\b[^.;\n]{0,80}\b(?:visa\s+sponsorship|immigration\s+sponsorship|h[\s-]*1b\s+sponsorship|sponsor(?:ship|ing)?)\b|\b(?:visa|immigration|h[\s-]*1b)[^.;\n]{0,50}\b(?:sponsorship\s+not\s+(?:available|offered|provided)|not\s+(?:sponsored|eligible)|sponsorship\s+unavailable)\b|\b(?:must|should)\s+(?:already\s+)?(?:be\s+)?(?:legally\s+)?authorized\s+to\s+work[^.;\n]{0,70}\bwithout\s+(?:now\s+or\s+in\s+the\s+future\s+)?sponsorship\b/i;
const CLEARANCE_NO = /\b(?:no|without)\s+(?:active\s+)?(?:security\s+)?clearance\s+(?:is\s+)?(?:required|necessary|needed)\b|\b(?:security\s+)?clearance\s+(?:is\s+)?(?:not|never)\s+(?:required|needed|necessary)\b|\b(?:does\s+not|do\s+not|doesn't)\s+require\s+(?:a\s+)?(?:security\s+)?clearance\b/i;
const CLEARANCE_REQUIRED = /\b(?:active\s+|current\s+|valid\s+)?(?:secret|top\s+secret|ts\/sci|sci|dod|government|security)\s+clearance\s+(?:is\s+)?(?:required|necessary|needed)\b|\b(?:requires?|must\s+have|need\s+to\s+hold|must\s+possess|ability\s+to\s+obtain|eligible\s+for)\b[^.;\n]{0,45}\b(?:secret|top\s+secret|ts\/sci|sci|security\s+clearance)\b|\b(?:us|u\.?s\.?)\s+citizenship\s+(?:is\s+)?required\b/i;

export function sponsorshipVerdict({description=""}={}) {
  const s = typeof description === "string" ? description.slice(0, 80000) : "";
  if (SPONSOR_NO.test(s)) return "not_offered";
  return SPONSOR_YES.test(s) ? "offered" : "unknown";
}
export function clearanceVerdict({description=""}={}) {
  const s = typeof description === "string" ? description.slice(0, 80000) : "";
  const withoutNegative = s.replace(new RegExp(CLEARANCE_NO.source, "gi"), "");
  if (CLEARANCE_REQUIRED.test(withoutNegative)) return "required";
  return CLEARANCE_NO.test(s) ? "not_required" : "unknown";
}
