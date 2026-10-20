# Start an application in the candidate's browser

`start-application.mjs` is the final, candidate-controlled bridge from the
reviewed readiness chain to an ordinary system browser. It re-runs job,
eligibility, verified-fit, exact-bundle, and C12 approval gates through
`candidate-submission-handoff.mjs`, then requires a second confirmation bound
to the exact application key, content digest, and URL digest.

The input is a private JSON object containing `readiness_input`, `approval`,
and `start_confirmation`. Create the confirmation with
`createApplicationStartConfirmation()` only after showing the candidate the
exact URL and reviewed handoff. Keep the file inside the Career Ops data root.

```bash
node start-application.mjs --input data/private/application-042-start.json
node start-application.mjs --input data/private/application-042-start.json --open
```

The first command validates and prints the launch plan. The second performs one
OS-level request to open only that exact HTTPS URL. On macOS it uses `open`; on
Windows it uses `rundll32.exe url.dll,FileProtocolHandler`; on Linux it uses
`xdg-open`. No shell is used.

The resume token stays stable while the application key, approved content, and
URL are unchanged. Pause for login, MFA, CAPTCHA, new or changed fields, and
the final Submit action. If the URL, answers, artifacts, role, or job identity
changes, rebuild and reapprove the exact package instead of resuming it.

Career Ops does not fill or advance the browser form through this command and
never presses Submit. A successful browser-open request is not proof that the
page loaded and is never submission evidence. Keep the tracker at its current
state until the candidate submits and an actual success page or employer
acknowledgement is reviewed through the C13 lifecycle flow.
