// Conservative, dependency-free qualifiers for the Explore discovery UI.
// Advisory search filtering only. NEVER substitutes for eligibility/liveness or
// application-specific approval. Unknown evidence is not a positive match.
const STATES = [
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware",
  "florida","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky","louisiana",
  "maine","maryland","massachusetts","michigan","minnesota","mississippi","missouri",
  "montana","nebraska","nevada","new hampshire","new jersey","new mexico","new york",
  "north carolina","north dakota","ohio","oklahoma","oregon","pennsylvania",
  "rhode island","south carolina","south dakota","tennessee","texas","utah","vermont",
  "virginia","washington","west virginia","wisconsin","wyoming","district of columbia",
];
const CODES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ");
const NON_US = /\b(?:canada|united kingdom|england|scotland|wales|ireland|india|germany|france|spain|italy|portugal|netherlands|poland|sweden|norway|denmark|finland|switzerland|austria|belgium|ukraine|romania|brazil|mexico|colombia|argentina|australia|new zealand|singapore|japan|china|pakistan|philippines|south africa|united arab emirates|uae|vietnam|malaysia|indonesia|nigeria|kenya|israel|turkey|türkiye|europe|emea|apac|latam)\b|\bU\.?K\.?\b/i;
const COUNTRY_US = /\b(?:united states(?: of america)?|u\.?s\.?a\.?|u\.?s\.?)\b/i;
const STATES_RE = new RegExp("\\b(?:"+STATES.filter(s=>s!=="washington").filter(s=>s!=="georgia").join("|").replaceAll(" ","\\s+")+")\\b","i");
const STATE_CODES_RE = new RegExp(",\\s*(?:"+CODES.join("|")+")(?![A-Za-z])(?:\\b|$)","i");

export function usLocationVerdict(location) {
  if (typeof location !== "string" || !location.trim()) return "unknown";
  const s = location.trim();
  // Global or cross-border roles are not exclusively US, even if US is listed.
  if (NON_US.test(s) || /\b(?:worldwide|global|anywhere|international)\b/i.test(s)) return "non_us";
  if (COUNTRY_US.test(s) || /\bWashington\s+State\b/i.test(s) ||
      STATES_RE.test(s) || STATE_CODES_RE.test(s) ||
      /\b(?:Atlanta|Savannah),?\s+Georgia\b/i.test(s)) return "us";
  // Remote without an explicit US country/state is NOT US evidence.
  return "unknown";
}

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

export function matchesExploreQualifications(offer, filters) {
  if (filters.usOnly && usLocationVerdict(offer.location) !== "us") return false;
  const kinds = filters.employmentTypes;
  if (Array.isArray(kinds) && kinds.length > 0) {
    // Never upgrade an unclassified/legacy offer to C2C or full-time.
    if (!kinds.includes(offer.employmentType || "unknown")) return false;
  }
  return true;
}
