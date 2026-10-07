# Email Issues (review only)

Administrators can open Communications → Email Issues to review three sources:

- **Delivery events:** SES bounces, complaints, rejects, template rendering failures and delivery delays. Only affected bounce/complaint recipients are recorded, not every address on the original message. Event writes are idempotent.
- **Sending failures:** FAILED and UNCERTAIN delivery ledger records, plus SENDING/READY records that have not progressed after five minutes. Accepted sends are not proof of inbox delivery. A reviewed issue can disappear if its source no longer represents a failure.
- **Unsubscribes:** subscribers currently opted out with a recorded unsubscribe date. This excludes unverified signups and people who have since resubscribed. It is a current-state view, not a historical unsubscribe event log.

Admins can add notes, mark a review resolved and reopen it. Every save records the authenticated reviewer, timestamp and incrementing version in a separate review record plus append-only audit records. Concurrent saves are rejected rather than overwriting another admin's work. Changed delivery states and later unsubscribe dates receive fresh review identities.

Review actions never resend mail, change subscriptions, reset delivery claims, or add/remove suppression. Existing subscription filtering and AWS account suppression behavior are unchanged. A complaint or permanent bounce is recorded for manual review only, as requested.

## Collection and deployment

The workflow first deploys `infrastructure/email-events.yml` in eu-west-1. This creates separate `cause-portal-dev` / `cause-portal-live` SES configuration sets and SNS topics. Communications deploys the matching SQS queue, cross-region subscription and event worker in eu-west-2. Only that environment's topic can publish to the queue. Events include no message body in the issue record; only relevant diagnostics and identifiers are retained.

The bulk worker and shared Notifications sender attach the environment's configuration set. Senders outside these helpers are outside this collection scope. No identity-wide SES defaults, existing configuration sets, production data or AWS suppression rules are modified by a development deploy. Sending is not performed by the event consumer.

Deploy backend before frontend. Both pipelines include the infrastructure automatically; no manual table migration is needed. Old SES events are not backfilled. Review the event dead-letter queue if event processing repeatedly fails (five attempts, 14-day retention).

Lists use bounded pages (50 events or 250 scanned source records). Search and status filters apply to loaded records; the page explicitly shows when more records are available. An empty scan page may still have a next cursor. Review metadata reads are consistent and retry unprocessed keys before returning an error rather than displaying an incorrect review state.

## Verification

Run `node v2/main/services/tests/run.js` and frontend `node --test tests/*.test.cjs`. Tests mock AWS and cover authorization, event types, per-recipient accuracy, duplicate notifications, partial batch retries, environment isolation, pagination, review concurrency and preserving source records. Frontend checks cover failures returned as resolved HTTP responses and save/load behavior. Build and lint the frontend before deployment.

Development smoke tests may publish synthetic SES-shaped events to the development topic and exercise review operations using only those synthetic records. This does not send emails. Remove synthetic records after verification.

References: [SES event format](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html), [cross-region SNS subscriptions](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-sns-subscription.html).
