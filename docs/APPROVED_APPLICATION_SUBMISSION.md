# Submit an exactly approved application

## Concrete headed-browser adapter

`submit-application-browser.mjs` is the packaged local Playwright adapter for
one application at a time. Its JSON input, persistent browser profile,
observations, and receipts must live under the private Career Ops data root.
Per-application selectors are private data; the public repository contains no
ATS account, candidate data, or site-specific bypass.

```bash
npm run submit:application:browser -- --mode inspect \
  --input data/private/<application>-browser.json \
  --profile-dir data/private/browser-profiles/<application> \
  --output data/private/<application>-observation.json

npm run approve:application:submission -- --mode review \
  --input data/private/<application>-browser.json \
  --inspection data/private/<application>-observation.json \
  --output data/private/<application>-submission-review.json

npm run approve:application:submission -- --mode approve \
  --input data/private/<application>-browser.json \
  --inspection data/private/<application>-observation.json \
  --output data/private/<application>-browser-approved.json \
  --challenge <exact-challenge-digest-shown-in-review> \
  --statement "I approve submitting this exact application, with this exact URL, fields, and artifacts, one time."

npm run submit:application:browser -- --mode submit \
  --input data/private/<application>-browser-approved.json \
  --profile-dir data/private/browser-profiles/<application> \
  --output data/private/<application>-submission-result.json \
  --receipt data/private/<application>-receipt.json
```

`inspect` never submits. It records the current final-review DOM so the exact
application-specific approval can bind to it. `review` re-runs the gates and
creates a digest for exactly that application, URL, rendered field set,
attachment set, observation, and browser contract; it authorizes nothing.
`approve` requires that exact digest plus the literal one-application statement
and creates the sealed private input for `submit`. Output files are create-only
so a prior approval cannot be silently replaced. `submit` re-runs every
readiness gate, re-reads the DOM immediately before the action, and permits one
click on the one selector and button text in the approved private contract.
Any login, MFA, CAPTCHA, unexpected control, changed field, changed attachment,
URL change, or changed Submit control pauses or blocks. The persistent profile
preserves candidate-assisted resume state without storing credentials here.

After the click, a visible configured ATS/employer success element is captured
to a private evidence file. The command verifies that receipt but deliberately
does not write `Applied`; the existing C13 lifecycle confirmation and canonical
tracker writer remain the only status-mutation path. A click, request, browser
open, or missing success element is never a receipt.

This adapter is not a CAPTCHA/MFA solver, credential manager, arbitrary-
JavaScript runner, or cross-ATS selector guesser. A supported desktop session
or the candidate supplies the private selector contract and handles protected
steps. Physical-browser acceptance remains separate from CI.

`enhanced/approved-application-submission.mjs` is the narrow safety kernel for
the final consequential Submit action. A supported browser adapter can call it
after `start-application.mjs` opens the application and the candidate reaches
the final review page. It does not bypass login, MFA, CAPTCHA, or changed form
fields, and it is not a general web-form robot.

## Initiation path

1. Build the private readiness input and exact reviewed bundle with
   `prepare-application.mjs` and the existing evidence-bound workflow.
2. Validate and open the exact URL with `start-application.mjs --input
   data/private/<application>-start.json --open`.
3. In the browser, pause for the candidate to complete protected login, MFA,
   CAPTCHA, disclosures, or any unexpected field. Rebuild the package if the
   URL, rendered fields, or attachments differ.
4. At the final review page, run browser `inspect`, then run approval `review`.
   Show the candidate the resulting application identity, exact URL, reviewed
   fields, artifact digests, and challenge digest. The review authorizes zero
   actions.
5. Only after the candidate reviews that exact output, run approval `approve`
   with the displayed challenge digest and literal
   `SUBMIT_CONFIRMATION_STATEMENT`. A reusable “yes”, a challenge from another
   application, or any stale/changed package fails closed. Repeat inspect and
   review after any change.
6. Re-observe the page and call `prepareApprovedSubmission()` immediately
   before `executeApprovedSubmission()`. The injected adapter receives only
   one permitted action: `submit_exact_approved_form`.
7. After the click, keep the tracker unchanged. Capture the actual ATS success
   page or employer acknowledgement in the private candidate data root. Verify
   it with `verifySubmissionReceipt()`, bridge it into the existing C13 flow
   with `createAppliedLifecycleDraftFromReceipt()`, then confirm and record it
   through the canonical lifecycle writer. Retries use the authorization
   digest and are idempotent.

The final approval binds the application key, reviewed content digest, target
URL digest, rendered-field digest, attachment digest, observation digest, and
resume token. Any change makes it stale. A browser click or request is never a
receipt and never authorizes Applied.

## Minimal device acceptance

Run this only in a separately user-initiated desktop browser session with one
application-specific approval. Do not use a real submission merely to test.
Use a user-controlled ATS sandbox/test posting, or combine acceptance with an
application the candidate has independently chosen to submit.

1. Confirm the pre-submit page exactly matches the reviewed URL, answers, and
   attachment hashes. Verify no submit occurs before the literal final
   approval.
2. Trigger login, MFA/CAPTCHA, and one unexpected-field scenario; each must
   pause with the same resume token and zero Submit actions.
3. Return to the unchanged final page, grant the exact approval, and verify the
   adapter performs one Submit action only.
4. Before capturing a success page, confirm the tracker is not Applied.
5. Capture the actual success receipt, complete the reviewed lifecycle step,
   and confirm Applied is recorded once; retry and confirm there is no second
   tracker mutation.

Record browser/OS, application key, commit SHA, observation time, receipt
reference and private evidence SHA-256. Do not commit candidate content,
credentials, screenshots, resume bytes, answers, or receipts.

## Attachment bytes and interrupted sessions

Inspection uses the same exact package comparison as final approval: URL,
application key, answers, field set and artifact digests must all match.
Field labels must also match their live associated label or ARIA label.
A visible filename is not attachment evidence. The adapter reads the single
selected browser `File`, hashes its actual bytes with SHA-256, and compares
that digest with the approved package. Missing, empty, multiple, unreadable,
or over-25-MiB files pause as unverifiable. Server-side attachment links or
filename-only summaries are unsupported and must not be substituted for bytes.
The file is read again immediately before an approved action.
The CLI also reserves the approval digest in a durable, exclusive private
`data/private/submission-attempts/` record before the click. Reopening a browser
or changing profiles cannot replay that approval. Failed/uncertain attempts
remain consumed: inspect the actual ATS result before explicitly approving
another attempt. Never delete the reservation to retry automatically.

A persistent browser profile does not promise persistent authentication.
Expired sessions, login, MFA and CAPTCHA pause with the same package resume
token and no action. The candidate completes authentication; rerun inspect
and the exact review/approval flow afterward. Lost file selections must be
reattached and reverified. Browser/observation failures also produce a
serializable pause; receipt failures after a click retain the submission
state and never authorize Applied or retry the click automatically.

## Native Safari device validation

Prefer native Safari for additional macOS validation where supported. Safari's
native `safaridriver` requires Safari Settings → Developer → Allow remote
automation. Playwright WebKit is not native Safari and is not a substitute
for this evidence. The packaged persistent-browser runner currently supports
Chromium; it cannot attach to an ordinary Safari login profile. Preserve the
Chromium regression suite and record Safari failures or unsupported operations
explicitly, rather than claiming Safari application acceptance from engine-only
checks. No real job submission is necessary for device validation.

To run the synthetic native Safari observer check (no Submit method is exposed):

```bash
/usr/bin/safaridriver -p 48157
# In another terminal:
node scripts/native-safari-acceptance.mjs --synthetic --output /tmp/safari-evidence.json
```

This replaces the contents of a dedicated automation tab on Example Domain
with a synthetic form and in-memory files. It does not test a real ATS, native
file-picker selection, server uploads, or the candidate's authenticated profile.
