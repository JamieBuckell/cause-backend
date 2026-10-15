# Donor allocation links and pledge edits

Rachel Harte's CHC2026 donor record was repaired separately under explicit user authorization. Only its missing allocation links and repair audit metadata were changed; neither family assignment was changed and no email was sent. The local incident backup and verification are under `outputs/rachel-allocation-repair-2026-10-07` in the workspace (not committed).

The portal's **Reconnect allocation links** action is available only to the account identified by `isJamie()`. The API independently requires the exact same email, a verified email claim, and the Admin group. Merely hiding the button is not its security boundary.

The action reads the donor and the families currently assigned to that donor in the selected campaign. It previews only missing links, preserves existing valid links, and never allocates a new family, changes a family record, unallocates a family, or sends an email. Where multiple pledges could accept the missing links, Jamie must choose the target pledge. Conflicting or duplicate links and insufficient capacity require manual review.

A preview fingerprint binds the confirmation to the donor, pledge, family ownership, status and member snapshots. Applying it conditionally updates the donor and writes an audit record in one DynamoDB transaction, with condition checks on every family. More than 98 assigned families require a separate reviewed repair because of the transaction item limit. Already-correct records are a no-op.

Pledge editing now treats allocations as server-owned data: a stale or modified form cannot replace them. Existing allocated requests cannot be deleted, replaced by a new request ID, or reduced below their allocated count. Donors with already-disconnected assignments must be repaired first. Unallocated pledge requests can still be changed or deleted.

The donor update is conditional on the stored pledge snapshot, changes only pledge fields and audit metadata, and appends a `DONOR_CHANGE#<donorId>` audit record atomically. Existing donor history is preserved. This fixes pledge-edit data loss; other legacy allocation writers are outside this change and still use their existing write behavior.

The frontend edits a detached copy and replaces its local donor data with the successful server response. A failed save leaves the existing local data intact. A confirmation-email failure after saving returns a warning with the saved record instead of inviting a repeated save/send.

Deploy the backend donor service before the frontend. Tests are included in the backend suite and frontend `tests/*.test.cjs`. No database migration is required.

## Normal platform unallocation after references change

Deploy the **families service** (including its IAM update for `dynamodb:ConditionCheckItem`) before the frontend. No migration is required. The unallocation endpoint remains compatible with older clients supplying a current hamper reference and no permanent family ID.

The frontend sends the permanent family ID and adopts the donor returned by the server. Unallocation does not require the browser to find a matching pledge request. The backend consistently reads the selected campaign's donor and owned families, resolves the permanent ID, and removes the exact allocation link. If references have changed, it removes a stale link only when the saved member snapshot uniquely identifies that family among the donor's links and assignments. Ambiguous or conflicting links return a review error without writes. Disconnected assignments with no stale links can also be released.

Family release, donor link removal and audit creation use one conditional transaction. Snapshot-based matching also guards the other family snapshots used to establish uniqueness. Pledge counts and unrelated links are preserved; no email is sent. This handles Kelly Knowles's renumbered Hartlepool allocations through the normal Unallocate action. It does not prevent the underlying reference-renumbering process from creating stale links.
