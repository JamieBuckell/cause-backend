# Service endpoint review

## Scope and validation

Reviewed all 101 JavaScript endpoint files across 13 services, including HTTP handlers, queue workers, migrations and backup handlers. The Serverless configuration contains 76 HTTP routes; handler references and path parameter declarations were checked.

Run `npm test` from `backend` (or any service directory). The suite currently contains 412 passing tests, including the existing reset-password tests. Tests use mocked DynamoDB, Cognito, SES and queues; they do not send email or modify cloud data. Node.js with `node:test`, installed campaign dependencies (including moment-timezone), and Python 3 are required. Python's independent MIME parser verifies attachment decoding.

The endpoint inventory tests fail if an endpoint is added without being accounted for. Coverage includes route access, malformed requests, successful operations, injected dependency failures, worker retries, migration transformations and retired-handler no-op behavior. These are behavior tests, not a claim of complete branch coverage.

## Attachment incident

The raw email builder declared CSV attachments as base64 while inserting plain CSV. A recipient client decoding that declaration produces corrupt data even if another client displays the attachment correctly. The builder now encodes attachment bytes, uses CRLF and wrapped base64, and nests text/HTML alternatives inside a mixed multipart message. PDF attachments retain their binary bytes. See [MIME transfer encoding](https://www.rfc-editor.org/info/rfc2045/) and [multipart structure](https://www.rfc-editor.org/info/rfc2046/).

The supplied allocation CSV was valid UTF-8. It was passed through the corrected builder and an independent MIME parser: all 1,482 bytes matched. Synthetic regression fixtures cover Unicode CSVs with and without PDF attachments; private recipient data was not copied into the repository. No live email was sent.

## Corrections

- Dependency failures now stop handlers instead of returning an ignored response from an inner promise callback. Queue workers propagate failures for retries.
- DynamoDB reads paginate; batch writes chunk and retry unprocessed items with bounded retries. Shared validation preserves false and zero values.
- Password resets handle encoded school email addresses and missing verification state. User operations validate supported roles; user lists paginate Cognito results.
- Family and nominator changes enforce organisation and ownership boundaries. Allocation removal cannot accidentally remove the last unrelated item. Family splits retain intended groups and reserve distinct references.
- Donor deletion automatically unallocates families and reports the count. The donor page warns before deletion. Donor email changes use consistent keys and collision checks.
- Email-template create/delete manage templates by key. The delete route parameter is now `key`.
- Public subscription creates a subscriber and sends verification. Verification validates the token before changing subscription or donor state.
- No CH24 fallback remains in campaign-dependent operations: callers must supply a campaign. The affected frontend hamper requests now send the selected campaign.
- Volunteer scanner routes remain public, as requested. Bag counts and bulk request shapes are validated.
- Communication recipient filtering, deduplication, key conditions and identifiers were corrected. Reports retain accurate time buckets. Repair jobs preserve existing request identifiers and avoid duplicate allocations.

## Retired handlers

These entry points now return an explicit retired response without reading or writing data. Existing deployment references can safely invoke the stubs.

| Handler | Reason |
| --- | --- |
| comms/email | Unconfigured legacy sender superseded by process |
| comms/notifications | Unconfigured legacy notification cron |
| comms/updateMailsSent | Unconfigured legacy completion worker superseded by complete |
| emails/getById | Unconfigured copy of campaign handler |
| families/update.BK | Backup implementation |
| feedback/feedbackGenerate.hamperspecific | Unconfigured legacy PDF handler |
| dataMigration/fixDonorSKs | Delete-only repair with replacement code commented out |
| comms/reconfigureRecipients | Delete-only repair with copy code commented out |

The already-disabled feedback/transfer entry point remains disabled with its dead implementation removed. Functions.bk delegates to the maintained helper.

## Deployment and limits

All changes are local; no deployment, cloud migration or live email test has occurred. Deploy the affected backend services and frontend together because campaign parameters and email-template route semantics changed. Existing clients must provide explicit campaign identifiers where required.

Tests do not verify deployed IAM permissions, live Cognito/SES configuration, client-specific rendering or actual delivery. Multi-record DynamoDB and Cognito changes still span separate requests; failure propagation does not make those operations atomic. Existing migration handlers should only be run against reviewed data with appropriate backups; this review did not execute them.

## Endpoint inventory

Every file below is included in the endpoint test inventory; focused operation, job and regression suites exercise applicable behavior.

| Service | Endpoint files |
| --- | --- |
| campaign (7) | `create`, `dashboard`, `delete`, `getById`, `list`, `update`, `verify` |
| comms (11) | `complete`, `email`, `generate`, `mailer`, `notifications`, `process`, `recipientFix`, `reconfigureEmails`, `reconfigureRecipients`, `sent`, `updateMailsSent` |
| dataMigration (14) | `addFamilyRequestIds`, `deletedFamilies`, `donorAllocations`, `donors`, `families`, `fixDonorCognitoIDs`, `fixDonorSKs`, `fixFamilySKs`, `fixFamilyUnitCounts`, `fixSKs`, `nominators`, `organisations`, `removeDeletedFamilies`, `subscribersFix` |
| donors (11) | `changePledge`, `confirmPledge`, `delete`, `downloadFile`, `emailUpdate`, `hide`, `register`, `resendVerification`, `sendPledgeDetail`, `update`, `updatePledge` |
| emails (5) | `create`, `delete`, `getById`, `list`, `update` |
| families (8) | `allocate`, `create`, `delete`, `emailAssignment`, `list`, `split`, `update.BK`, `update` |
| feedback (8) | `feedbackGenerate.hamperspecific`, `generatePdf`, `getHamper`, `getVolunteer`, `hamper`, `hamperCheck`, `transfer`, `volunteer` |
| hampers (8) | `check`, `markDirect`, `markDirectBulk`, `overview`, `receive`, `screen`, `undelivered`, `undeliveredDonors` |
| nominators (6) | `approve`, `create`, `delete`, `resetPassword`, `sendWelcome`, `update` |
| organisations (5) | `checkReference`, `create`, `delete`, `getByHash`, `update` |
| reports (2) | `allDropOffs`, `dropOffs` |
| subscription (8) | `check`, `create`, `delete`, `list`, `resubscribe`, `subscribe`, `unsubscribe`, `verification` |
| users (8) | `create`, `delete`, `doFixReferences`, `fixReferences`, `list`, `me`, `resetPassword`, `resetPasswordCommit` |
