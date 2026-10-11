# Assess a revised LC — Phase 1 domain contract

Implemented helpers are available to callers in `lib/lc-updates.ts`. Phase 2 now
exposes API operations; see [the API/frontend contract](lc-updates-phase2.md).
Frontend controls remain unfinished. No model, network,
telemetry, storage, authentication or clock lookup occurs in these helpers.
They clone inputs and receive dates, reviewer assertions and identifiers from
their caller. Existing model/usage counters are preserved.

## Operations

- `stageLcAssessment(case, StageInput): Case` checks the request revision, an
  already investigated case, next LC version, complete-text assertion and
  same LC reference. `extraction` contains `documentBinding: sourceBinding(doc)`
  and unknown `fields`; there is no extraction success flag. All required fields
  must survive literal and value validation. Saved fields are revalidated against
  current documents. Optional bound invoice/B/L `documentEvidence` can supply
  fresh extraction. Unverifiable saved evidence throws `FreshInvestigationRequired`
  with the document kinds; no source is guessed or merged.
- The returned `pendingLcAssessment` holds both complete LC sources; all seven
  before/after terms and exact quotes; deadlines and their shipment, expiry and
  presentation-period inputs; resolved, persistent, new and materially changed
  findings; affected active decisions and correspondence; and an explicit
  uncovered-text review requirement. Staging changes only assessment/audit data,
  revision and events. Replacing a pending assessment records it as superseded.
- `selectLcBasis(case, SelectInput): { case, followUp }` requires current revision,
  assessment id and exact assessment/candidate/base bindings. It also compares
  the active analysis and decisions against the staging snapshot, revalidates
  extraction, and recalculates findings and deadline on the supplied current
  `asOf` date. Selection requires a separate explicit assertion of complete text,
  selection for covered checks and external review of uncovered changes.
  It archives the previous analysis, source history and decisions, promotes the
  LC, clears active approval/recovery plan/reply assessment, and replaces any
  supported correction draft with a newly version-bound draft. It archives active
  statements and retains original correspondence bindings. Corrections stay
  stopped until fresh evidence establishes timing and fresh request approval is
  given. Unsupported findings and uncovered text changes stay stopped; zero
  covered findings alone cannot clear an uncovered change.
- `dismissLcAssessment(case, AssessmentRequest & { reviewer, at }): Case`
  removes the pending assessment and records dismissal with both source texts.
  It preserves active business data. A stale assessment may be dismissed using
  its original exact content bindings and the current case revision; it may not
  be selected.

All rejection paths throw `CaseError` (stale bindings use status 409) and leave
the input unchanged. Revision numbers must be persisted atomically by a caller;
the helpers themselves do not perform compare-and-swap storage.

## Existing workflow safeguards

Case additions are optional: `pendingLcAssessment`, `lcAssessmentHistory` and
`lcUpdateRequirements`. The existing `Plan` adds optional `documentVersions`.
Legacy cases retain their original workflow.

Pending assessments block approval, receipt and recovery-plan mutation. Selected
cases require current exact document bindings. Existing correspondence validation
still checks quoted commitments and dates. Current feasible recovery evidence
can clear the timing requirement; missing or conflicting new timing restores it.
Recovery cannot clear outside-coverage or specialist-review requirements. Historical
correspondence is never relabeled as current. Reinvestigation cannot clear these
requirements implicitly. After an approved receipt, the binding advances to the
received document pack, and approval, timing statements and the recovery plan
become historical. A clean independent recheck removes the need for correction
timing; any remaining corrections require new timing and approval for that pack.

## Deliberate limits

Grounding accepts complete, unique physical source lines with one unambiguous
value per field; missing fields, duplicate labeled terms, alternatives, substring
values and unsupported layouts require investigation. Dates must be valid ISO
calendar dates, presentation days 1–365, currency uppercase three-letter text,
and amounts positive with at most two decimal places and at most 1 trillion.
These are prototype representation limits, not banking rules. Literal evidence
does not prove correct semantic field classification. Completeness, reviewer
identity/qualifications and assertion timestamps are not independently verified.

Uncovered-text detection masks **only extracted values**, retaining the rest of
each source verbatim for comparison. Wording/format changes may conservatively
require review. It is not clause interpretation or an exhaustive requirements
inventory. Even external-review acknowledgment does not automatically resolve
the flagged unsupported obligations. Full presentation review remains required.

Bindings use exact deterministic serialization, not cryptographic hashes or
authentication. They can be large and include raw source text. Keep them in
case storage; do not send them to telemetry. Historical snapshots increase
storage size; storage budgets and redacted orchestration payloads need validation
before integration. There is no automatic partial-amendment consolidation, legal
amendment acceptance, authenticity check, bank calendar/cutoff evaluation or
bank approval.

## Integration work identified at the end of Phase 1

The current implementation status and exact API contract are documented in
`lc-updates-phase2.md`; the list below records the original handoff.

1. Add owner-authenticated API schemas for stage/select/dismiss, server-assigned
   next versions/ids, trusted reviewer identity/time and current analysis date,
   bounded payloads, and atomic revision compare-and-swap persistence.
2. Add model orchestration that produces the bound extraction input. On
   `FreshInvestigationRequired`, investigate the exact current documents and retry;
   do not silently trust saved fields or substitute fixtures in live mode.
3. Add later explicit specialist/outside-coverage resolution contracts with
   evidence and provenance. Never clear the new requirements based on a model
   success flag. Replan from the selected findings, retaining the selected LC and
   an honest stopped state if drafting fails.
4. Add UI controls for complete text/assertions, both full sources, impact and
   limitations, explicit selection/dismissal, current timing and fresh approval.
   Display old correspondence and decisions as historical evidence.
5. Test API ownership, persistence sizes, stale requests/CAS races, orchestration
   failures, frontend flows and demo zero-call behavior. Validate redacted compact
   live trace export separately; no live provider or trace verification is claimed
   by Phase 1 regression tests.
