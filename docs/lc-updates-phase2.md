# Assess a revised LC — Phase 2 API and frontend contract

This document records the Phase 2 contract. Frontend controls and later synthetic live verification were subsequently completed; see [Phase 4 verification](lc-updates-phase4-verification.md) and [receipt/recheck verification](lc-updates-live-receipt-recheck.md). The request/binding contract below remains current.

Stage, select and dismiss are reachable through the case API. No frontend controls
have been added. The existing Phase 1 helpers remain the business contract. No new
specialist-clearance or amendment-acceptance operation exists.

## Read and export

`GET /api/cases/:id` authenticates the signed-in owner and returns:

```js
{
  case: /* complete persisted Case, including source texts and audit history */,
  lcAssessmentRequest: /* transport binding object below, or null */,
  followUp: /* current required work, described below */
}
```

The existing owner-scoped `GET /api/cases` remains available while an assessment
is pending. Complete snapshots can still be exported by the existing application.
Read operations perform no model or telemetry calls.

## Action requests

All actions use same-origin `POST /api/cases/:id`, JSON content type and the current
case revision. Authentication and owner-scoped loading happen before orchestration.
Reviewer identity, timestamps, assessment ids and LC version numbers come from
the server. The client may not supply them in assertions or candidate documents.

```js
const staged = await postCase(caseId, {
  type: 'stage_lc',
  revision: currentCase.revision,
  candidate: { name: 'revised-credit.txt', text: completeRevisedLcText },
  assertion: {
    completeText: true,
    note: 'I supply this complete text as the proposed basis for covered checks.'
  }
});

const selected = await postCase(caseId, {
  type: 'select_lc',
  ...staged.lcAssessmentRequest,
  assertion: {
    completeText: true,
    selectForCoveredChecks: true,
    outsideCoverageReviewed: true,
    note: 'Use this complete version for covered checks; external review was performed.'
  }
});

// Alternative to selection. Refresh first if another action changed the revision.
const dismissed = await postCase(caseId, {
  type: 'dismiss_lc',
  ...latestResponse.lcAssessmentRequest
});
```

`postCase` above means a normal authenticated same-origin fetch, followed by JSON
parsing and checking the HTTP status. `completeRevisedLcText` is the whole supplied
LC text, including all supported fields and the same reference. No partial
amendment merge, inferred missing value or buyer-promise conversion occurs.

The `lcAssessmentRequest` object is:

```js
{
  revision: 2,
  assessmentId: 'server-generated-assessment-id',
  assessmentBinding: '64 lowercase hexadecimal characters',
  baseBinding: '64 lowercase hexadecimal characters',
  candidateBinding: '64 lowercase hexadecimal characters'
}
```

These three tokens are SHA-256 digests of the Phase 1 exact serialized bindings.
Copy them from the API; do not send the large raw domain strings or calculate a
different serialization in the browser. The server compares tokens against the
stored assessment and passes the original exact bindings to the domain helpers.
These tokens do not replace ownership, revision checks or domain validation.

## Successful responses and concurrency

New action responses have this shape:

```js
{
  case: /* persisted snapshot, possibly newer if concurrent work followed the operation */,
  lcAssessmentRequest: /* current pending assessment tokens, or null */,
  followUp: ['confirm_current_timing', 'draft_correction_requests'],
  operation: { type: 'select_lc', assessmentId: '...', committedRevision: 3 },
  // Live only; an acknowledgment is not persisted readback verification.
  telemetry: { eventSaved: true, acknowledged: true, persistedReadback: false, traceId: '...' }
}
```

The ordinary correction-action responses also include `lcAssessmentRequest` and
`followUp`. Selection persists atomically before any subsequent workflow or trace
export. Selection itself performs no model drafting because supported corrections
require fresh current timing first. Its new deterministic draft remains blocked.

Staging performs one live LC investigator call, completes only uniquely matching
source-line excerpts, then invokes the Phase 1 validator/comparator and CAS save.
Saved invoice/B/L fields must already have provable current grounding. Missing
grounding returns an explicit requirement; this phase does not automatically
investigate the other documents or expose a full reinvestigation action.

If the case changes during the LC call, persistence returns 409 and cannot overwrite
newer work. Selection and dismissal also use atomic revision checks. Telemetry
receipt annotations use a separate CAS with the same business revision; they do
not invalidate the assessment. If newer work intervenes, that annotation is not
written, `eventSaved` is false, and the response reads the latest saved case when
available. `operation.committedRevision` identifies the operation's original commit.

## Follow-up and existing correction workflow

- `select_or_dismiss_assessment`: show the pending comparison. Disable investigation,
  recheck, approval, receipt/reply, correspondence and reassessment controls. Read and
  export remain available. Evidence-link edits are permitted but increment revision,
  making selection stale; the user must restage or dismiss.
- `confirm_current_timing`: collect fresh correspondence using the existing
  `correspondence` action with `sender: 'exporter' | 'carrier' | 'other'` and `text`.
  Old correspondence stays bound to its original document versions. It cannot
  satisfy timing for the selected LC. Estimates, missing dates, deadline conflicts
  and availability on the deadline remain blocked under the existing validator.
- `draft_correction_requests`: live drafting is pending. It runs automatically via
  the existing planner and coordinator only when current timing is feasible and
  neither specialist nor uncovered-text requirements remain. The initial updated
  correspondence model calls extract quotes and propose evidence-bound actions.
- `retry_drafting`: validated timing and the selected basis survived a drafting
  failure. Status stays `stopped`, approval is cleared, and a `draftingRequired`
  optional requirement prevents approval. Existing `reassess` repairs/validates
  saved current correspondence and retries live strategy/draft generation when
  allowed. Do not reinterpret an HTTP 200 with a stopped case as draft success.
- `fresh_request_approval`: current timing and live drafts passed their checks.
  Use existing `approve`, then `reply` with both new invoice/B/L text documents
  in live mode, followed by `recheck`. There is still no external message sending.
- `review_outside_coverage` or `specialist_review`: keep the case blocked. The
  external-review assertion does not clear unsupported requirements. No clearance
  action has been added. Another complete, valid LC basis may resolve a covered
  finding; it cannot silently erase prior unresolved outside-coverage work.
- `full_presentation_review`: only covered checks passed. Full specialist/bank
  examination remains necessary; this is not presentation or bank approval.

On receipt, prior timing, recovery plans and approvals become historical. A clean
independent recheck clears the correction-timing requirement. Further corrections
or specialist findings remain stopped and cannot reuse the preceding pack's decisions.

## Errors and UI behavior

Input/schema rejection is 400; missing authentication 401; wrong owner/not found
404; same-origin failure 403; stale revision/bindings/CAS 409; snapshot budget 413;
malformed/failed model output 502; unavailable live settings 503.

LC execution errors return `{error, code}`; authentication, ownership and schema
failures retain the existing `{error}` response shape. `code` is `fresh_investigation_required`,
`stale_case`, `snapshot_too_large` or `lc_action_rejected`. Fresh-grounding errors
include `freshInvestigationRequired: ['invoice', 'bl']` as applicable. A live stage
failure after model execution can include `case`: the saved diagnostic revision
with active business state preserved and actual usage/events retained. Adopt that
returned revision, or refetch, before another request. A stale or oversized write
never returns an uncommitted proposed case as saved. On 409, refetch and review the
new state; do not replay old tokens blindly.

For later frontend work: display `pendingLcAssessment.sources` in full side by side,
`coveredTerms`, both `deadlines` including inputs, all four finding-delta categories,
`affected` decisions/correspondence, and `outsideCoverage` plus limitations. Preserve
the distinction between the active LC and the pending candidate. Show saved assertions
as assertions and archived decisions/correspondence as historical evidence. Use
current `case.status`, requirements and pending state to gate controls. Never label
selection as amendment acceptance, authenticity verification or bank approval.

## Storage, tracing and verification boundaries

Snapshots have an application budget of **900,000 UTF-8 bytes**, enforced before
insert/update. Evidence and history are never truncated to fit. Large source
bindings are accepted through compact request tokens, but accumulated history can
still exhaust the snapshot budget. Older large snapshots remain readable/exportable;
over-budget updates are refused. Request bodies retain the existing 60,000-character
limit; candidate text is 1–16,000 characters and name 1–120, assertion note 1–1,000.

Live traces reuse the existing exporter and preserve actual finalized investigator,
validation/comparison, planning and CAS spans, including errors. LC update traces
contain assessment ids, source versions/digests and quote references/digests, not
full sources, raw bindings, assertion text, raw provider output, duplicate histories
or full drafts. Telemetry failures preserve the committed business result. An
accepted trace receipt is an acknowledgment; persisted readback remains unverified.
On a lost stage CAS, model activity is still traced but its usage cannot be added
to the newer case without overwriting it; no usage merge is performed. The existing
`modelRuns` counter counts successfully parsed provider HTTP responses, not every
attempt; error LLM spans record failed attempts separately.

Demo branches use the synthetic parser and existing deterministic recovery path.
Stage, selection, dismissal, their failure paths and the whole demo correction loop
perform zero model and telemetry-export calls. Verification uses Miniflare, isolated
synthetic D1 databases and intercepted model/telemetry hosts. No real provider or
telemetry request, frontend flow or persisted remote trace readback is verified here.
