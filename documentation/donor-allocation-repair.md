# Donor allocation links and pledge edits

Rachel Harte's CHC2026 donor record was repaired separately under explicit user authorization. Only its missing allocation links and repair audit metadata were changed; neither family assignment was changed and no email was sent. The local incident backup and verification are under `outputs/rachel-allocation-repair-2026-10-07` in the workspace (not committed).

The portal's **Reconnect allocation links** action is available only to the account identified by `isJamie()`. The API independently requires the exact same email, a verified email claim, and the Admin group. Merely hiding the button is not its security boundary.

The action reads the donor and the families currently assigned to that donor in the selected campaign. It previews only missing links, preserves existing valid links, and never allocates a new family, changes a family record, unallocates a family, or sends an email. Where multiple pledges could accept the missing links, Jamie must choose the target pledge. Conflicting or duplicate links and insufficient capacity require manual review.

A preview fingerprint binds the confirmation to the donor, pledge, family ownership, status and member snapshots. Applying it conditionally updates the donor and writes an audit record in one DynamoDB transaction, with condition checks on every family. More than 98 assigned families require a separate reviewed repair because of the transaction item limit. Already-correct records are a no-op.

Pledge editing now treats allocations as server-owned data: a stale or modified form cannot replace them. Existing allocated requests cannot be deleted, replaced by a new request ID, or reduced below their allocated count. Donors with already-disconnected assignments must be repaired first. Unallocated pledge requests can still be changed or deleted.

The donor update is conditional on the stored pledge snapshot, changes only pledge fields and audit metadata, and appends a `DONOR_CHANGE#<donorId>` audit record atomically. Existing donor history is preserved. This fixes pledge-edit data loss; other legacy allocation writers are outside this change and still use their existing write behavior.

The frontend edits a detached copy and replaces its local donor data with the successful server response. A failed save leaves the existing local data intact. A confirmation-email failure after saving returns a warning with the saved record instead of inviting a repeated save/send.

Deploy the backend donor service before the frontend. Tests are included in the backend suite and frontend `tests/*.test.cjs`. No database migration is required.
