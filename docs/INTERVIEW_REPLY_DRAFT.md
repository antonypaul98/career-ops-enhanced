# Interview reply draft policy

`enhanced/interview-reply-draft.mjs` creates a draft only after binding the exact source message, linked application, approved proposal digest, reviewed weekly schedule, verified recipient, thread, and explicit outbound-authorization scope.

The policy accepts only interview proposals and rescheduling messages whose remaining review reason is the expected availability/calendar check. Salary, visa/work authorization, offers, untrusted instructions, ambiguous application links, mismatched recipients, changed proposal times, conflicts, and out-of-slot times fail closed for human review.

Every result keeps `outbound.send` false and requires exact-content approval. The module has no Gmail or Calendar connector, does not persist availability, does not confirm a meeting, does not mutate the tracker, and cannot submit an application. Stable draft keys support idempotent processing, while a notification proposal tells the caller when a draft is ready for user review.
