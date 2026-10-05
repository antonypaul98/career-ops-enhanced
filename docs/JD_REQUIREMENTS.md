# Structured employer requirements (C03)

Run `npm run jd:requirements -- /path/to/jd.md` to print JSON. This reads only
the explicit JD and never confirms candidate skills or writes career data.
An empty or unrecognized requirements section exits 1 with an inconclusive
diagnostic; it is not a clean match.

The adapter reuses `jd-skill-gap.mjs` section boundaries and `skill-extract.mjs`
vocabulary/aliases. The legacy skill-gap API retains its output. Requirements
carry stable document-scoped IDs, a SHA-256 of the original JD, canonical skill
names, original text, required/preferred/unspecified strength, and uncertainty.
Offsets are zero-based UTF-16; lines and columns are one-based UTF-16; ends are
exclusive. Both the keyword and its complete source requirement are preserved.
Duplicates with the same canonical name, strength and polarity share one
record; every occurrence survives. Different strength/polarity stays separate.

Only explicit strength words determine required/preferred. Generic headings
such as Qualifications stay unspecified. Negated statements, mixed strength,
alternatives, and unparsed requirements require review. Unknown prose is
retained verbatim instead of inferring technologies from umbrella terms.
The conservative parser is not a semantic understanding of arbitrary job prose;
read the original clause, particularly for durations, alternatives and scope.

`candidate_evidence` is always false at document and requirement levels.
Candidate evidence must come separately from approved career sources; a JD
keyword, canonicalization, or role persona cannot authorize a resume claim.
Output contains employer information only, with no candidate evidence join.
