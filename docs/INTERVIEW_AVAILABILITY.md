# Interview availability policy

`enhanced/interview-availability.mjs` is a deterministic, read-only policy layer for the job-correspondence backlog.

It accepts only an explicitly user-reviewed or uploaded weekly schedule with an IANA time zone, recurring slots, and optional date exceptions. It reports whether a new weekly schedule is needed, compares proposed interview intervals with approved slots, and checks caller-supplied calendar busy intervals.

The module does not connect to Gmail or Calendar, persist availability, send a reply, or confirm a meeting. Even when a proposal is inside an approved slot and outbound authorization is present, the result is only `reply_eligible`; `outbound.send` remains `false`. A separate reviewed integration must enforce consent, recipient identity, idempotency, and sensitive-content gates before any future send.

Times must include `Z` or an explicit numeric offset. Ambiguous times, calendar conflicts, expired schedules, out-of-slot proposals, cross-day intervals, and unavailable exceptions fail closed for user review. Schedule provenance is represented by a SHA-256 digest rather than echoing the complete private schedule.
