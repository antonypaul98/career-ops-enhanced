# Submit an exactly approved application

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
4. At the final review page, the browser adapter supplies the observed URL,
   rendered fields, artifact digests, application key, and observation time to
   `createExactSubmissionApproval()`. Show the exact package and require the
   literal `SUBMIT_CONFIRMATION_STATEMENT` for this one application.
5. Re-observe the page and call `prepareApprovedSubmission()` immediately
   before `executeApprovedSubmission()`. The injected adapter receives only
   one permitted action: `submit_exact_approved_form`.
6. After the click, keep the tracker unchanged. Capture the actual ATS success
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
