# Bulk email safety

Bulk mail uses `/communications/preview` followed by `/communications/process`. Both endpoints require an administrator. The separate preview route prevents an older backend from interpreting preview as a send during a version mismatch. Deploy the backend before the frontend.

1. `action: preview` accepts the email, audience options, optional `existingEmailId`, and a 32-character hexadecimal `requestId`. It validates and normalises addresses, reads every DynamoDB page, deduplicates addresses, and saves an immutable recipient snapshot. It does not enqueue or send emails. The same request ID cannot be reused for different content.
2. `action: send` accepts that request ID. It queues the saved snapshot. Repeat confirmations and retries reuse the same run. A preview expires after 24 hours if it has not been confirmed. Missing/invalid addresses block confirmation instead of silently skipping nominators.

For nominators, `excludeTeamLeads: false` includes both nominators and team leads. `true` selects nominators only. Deleted records are excluded. Resends recover saved campaign options; the portal also supplies the campaign explicitly. By default, resends exclude recorded previous sends. Sending another copy to everyone requires the explicit resend option and a new preview.

## Delivery ledger

The communications table and its indexes use on-demand capacity so bulk delivery claims and transactional completion writes are not constrained by the former one-write-per-second provisioned limit. Each recipient has a conditional DynamoDB delivery claim. Normalised address plus mailing identity identifies delivery; unsent-only resends share that identity, while explicitly sending another copy uses a new identity. Concurrent workers cannot both claim it. Completed sends are recorded atomically with the existing `RECIPIENT` audit record. `SENT` means SES accepted the message; it does not mean inbox delivery.

The SES SDK is configured with `maxRetries: 0`. Known throttling failures can retry. Permanent SES rejection is marked `FAILED`. Network timeouts, lost send acknowledgements, a crash after claiming a recipient, or failure to record an accepted send are held for review and are not automatically sent again. There is no reliable exactly-once API across SES and DynamoDB: this deliberately prioritises avoiding duplicate emails over blindly retrying uncertain delivery.

Queue handlers return partial batch failures. FIFO records behind a failed record in the same group are retried; unrelated recipient groups may continue. Stable FIFO deduplication IDs help with producer retries, while the persistent ledger protects beyond the FIFO deduplication window. After five failed receives, queues retain failed messages in their dead-letter queues for 14 days. Generation and send visibility timeouts are six times their Lambda timeouts.

The portal shows the latest run's accepted, pending, failed and review counts. A stale `SENDING` claim is shown as needing review after five minutes. `READY` or unclaimed messages in a dead-letter queue can still appear pending; inspect the DLQs if pending does not progress. The older completion queue is retained for compatibility; new sends record completion directly in the transaction and do not use it.

## Reviewing failures

Read `MAIL_RUN` / run ID and `MAIL_DELIVERY#<deliveryScope>` / normalised email in the communications table. For `UNCERTAIN`, `FAILED`, or stale `SENDING`, inspect CloudWatch and any recorded `sesMessageId`. Do not delete or reset a delivery claim just to make the queue retry. Confirm whether SES accepted the message first. An intentional new send to a recipient who may already have received it must be explicitly reviewed.

Legacy queued payloads lack the new confirmed recipient snapshot. New workers will hold them for review, not send them automatically. Check queues are empty or arrange review of existing messages before rollout. Do not revert workers to the old non-idempotent implementation with v2 messages pending.

## Validation

`node v2/main/services/tests/run.js` runs the regression suite with AWS and SES mocked; it never sends email. `tests/mailSafety.test.js` covers audience selection, team leads, address normalisation, prior-send exclusions, immutable previews, API retries, producer retries, concurrent workers, partial batch failures, SES throttling/rejection/ambiguity, database failures after acceptance, explicit new resends, and status summaries. CI runs the suite before deploying communications.
