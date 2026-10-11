# Revised LC blocker diagnosis and bounded continuation

The saved synthetic case now successfully stages and selects its revised LC.
Grounding reuse is established without new document investigation. Planner repairs
remain bounded and validated. The live correction cycle is still incomplete:
the first fresh correspondence proposal was rejected, and execution stopped.

## Exact original planner problem

The user supplied a neatlogs readback excerpt for trace
`fff98f8586ed89c6062dd9fdcd9ba058`. Its a3 `clarify_timing` action cited:

```text
missing:No supported carrier B/L availability date.
```

This identifier is unsupported. `missing` was a diagnostic array in the input,
not an evidence namespace. The model introduced the `missing:` prefix in its
proposal. The application did not generate that evidence identifier.
For clarification/escalation, `finding:bl.consignee` and `deadline` are permitted
alternatives. Validated statements use exactly `statement:<correspondence-id>:s1`;
findings use exactly `finding:<finding-id>`.

The shown a1 invoice date, **2026-10-12**, is supported by the original synthetic
exporter text and precedes the original 15 October deadline. It is not an invented
date. However, the proposal also requested invoice correction while carrier timing
was absent. Replacing the a3 reference alone still fails the existing global timing
guard: all required issuer timing must be supported before correction requests.

The supplied trace display omitted null/empty fields. Their raw presence cannot
be inferred. The regression fixture transparently supplies explicit null dates
and empty dependencies to isolate the observed unsupported reference; it is not
represented as a raw trace export. The compact trace input also omitted the original
statement list, so its complete membership cannot be independently reconstructed
from that input display. The invalid `missing:` namespace is nevertheless certain.

## Exact cached grounding problem

The original saved fields contain complete literal values as quotations. The
initial investigator contract allowed contiguous excerpts; Phase 1's validator
requires a complete unique source line. Each of these eight quotations equals
zero complete lines, triggering `Ambiguous or incomplete source quotation for
<field>`. No date or amount was missing from these quoted values.

| Document/field | Original quotation | Exact supporting line |
| --- | --- | --- |
| Invoice reference | `PHASE4-VERIFY-20261011-174225-INV` | `reference: PHASE4-VERIFY-20261011-174225-INV` |
| Invoice LC reference | `PHASE4-VERIFY-20261011-174225` | `lc_reference: PHASE4-VERIFY-20261011-174225` |
| Invoice currency | `EUR` | `currency: EUR` |
| Invoice amount | `48000` | `amount: 48000` |
| B/L reference | `PHASE4-VERIFY-20261011-174225-BL` | `reference: PHASE4-VERIFY-20261011-174225-BL` |
| B/L LC reference | `PHASE4-VERIFY-20261011-174225` | `lc_reference: PHASE4-VERIFY-20261011-174225` |
| B/L consignee | `SYNTHETIC BUYER LTD` | `consignee: SYNTHETIC BUYER LTD` |
| B/L shipment date | `2026-10-11` | `shipment_date: 2026-10-11` |

The LC-reference quotation appears in two physical lines in each document: the
document reference and the LC reference. The former contains an `-INV`/`-BL`
suffix and has the wrong field label. Existing literal token boundaries and field
label rules reject it. Exactly one strictly supporting line remains. Duplicate
supporting lines, duplicate labels, alternatives, unsupported values and stale
source versions remain rejected. This is not unrestricted substring matching.

## Narrow backend changes

- `lib/source-grounding.ts` contains the unchanged strict field checks and a pure
  normalization adapter. It retains `originalFields`/`providerQuote` and records
  `sourceLine`, line number, version and exact document binding separately.
- `lib/lc-updates.ts` revalidates cached fields through that adapter, preserves
  active analysis during staging and retains normalization evidence in the
  assessment/history. Selection archives raw previous analysis and provenance.
- `lib/agents.ts` preserves investigator records and counts attempted calls
  separately from parsed provider responses. New attempt increments are exact;
  legacy counters start from saved parsed-response counts, so previously failed
  historical attempts cannot generally be reconstructed. This case's prior seven
  attempts were already known from Phase 4.
- `lib/recovery.ts` supplies literal allowed references, supported commitment
  dates, context-specific permitted action kinds/dates, and the authoritative
  deadline. Unresolved timing permits only escalation and clarification, with
  null dates. Missing diagnostics never become evidence references.
- Invalid structured proposals receive at most **one** model repair with their
  specific validation feedback and the same evidence contract. Extraction is not
  repeated. Every proposal is validated. Two invalid proposals, repair-provider
  failure or unrepairable output leave a stopped case, retained extraction,
  archived affected decisions and cleared approval. No deterministic substitute
  is labelled as model planning. Failed and successful validation spans remain
  in one finalized invocation trace.
- `lib/lc-update-actions.ts` retains original candidate quotations, preserves API
  error-status semantics, and records base source digests plus selected versions.
- `lib/domain.ts` adds optional extraction history, rejected-proposal history and
  attempt accounting. Legacy snapshots remain compatible.

No frontend, API action names, authentication or database schema changed. No
dependency, diagnostic endpoint or persistent fault switch was added.

## Bounded live continuation

Case `c931202a-076f-4ea1-b661-41685c9a33c9`, reference
`PHASE4-VERIFY-20261011-174225`, continued from revision 2. Initial investigation
and old correspondence were not repeated. Expectations remained independently
calculated: 11 October shipment + 21 days = 1 November;
min(1 November, revised expiry 21 October) = **21 October 2026**.

| Operation | Revision/state | New attempts | Input/output tokens | Observed result |
| --- | --- | --- | --- | --- |
| Stage complete same-reference LC | 3 / approval | 1 | 231 / 315 | Active LC v1, fields, findings, plan, approval and deadline 15 October unchanged; candidate deadline 21 October |
| Explicit selection | 4 / stopped | 0 | 0 / 0 | LC v2, invoice/B/L v1; deadline 21 October; previous analysis/source/plan retained; fresh timing and drafting required |
| Fresh exporter correspondence | 5 / stopped | 2 | 784 / 300 | Successful extraction retained; model proposal rejected for requesting invoice correction while carrier timing was missing |

This saved case had **no original approval**. Its absence after selection was
confirmed; invalidation of a present old approval is covered by offline regression
tests, not claimed as an observed live transition here. The prior unsuccessful
correspondence was not invented as a historical successful receipt.

The new rejected proposal used a supported **16 October** invoice date and exact
current statement reference, but included `request_invoice` alongside carrier
clarification/escalation. The timing guard rejected that partial correction.
The exact structured output is retained in `planningFailures` and a regression
fixture. The final context-specific action schema and single-repair logic were
completed and verified offline **after this stop**. No additional live call or
repair was made; their live provider behavior remains unverified.

New usage: **3 attempts / 3 parsed responses**, **1,015 input / 615 output tokens**,
zero missing usage reports. Cumulative case totals: 10 attempts/responses,
2,429 input / 1,831 output tokens. Billed cost unavailable.
Authenticated local case readback matched the saved revision 5 snapshot.
The recorded run planned 11 base calls for the full continuation. With the final
repair logic the same full path permits at most 13: one optional repair for each
of the two correspondence actions. The repeat-protected script was updated to
recognize that bound; its recorded ledger retains the original execution plan.

## Trace evidence and readback boundary

Assessment ID: `791b5a11-9a93-4ed0-b046-37e608ba4a32`.

| Operation | Run ID | Accepted trace ID | Acknowledged spans |
| --- | --- | --- | --- |
| Stage | `2e1b74fd-e6a1-4319-aa13-429d848103e3` | `3d37af70addb6adb959e7f5d98c209b8` | 7 |
| Select | `d7d71a34-61b6-4df0-a307-6ba52b8344d4` | `a083f718521c90629af0945fb2a20150` | 5 |
| Fresh correspondence failure | `83bba615-9d20-423d-b131-6b0f73fbfa49` | `76180427a4e3e7ae4018b49e2b470234` | 7 |

All three are ingestion acknowledgments, not independent persisted verification.
Connector discovery found no connected neatlogs reader; browser-session discovery
failed in the execution environment. No secret or authentication files were read.
The user's original trace excerpt supplies partial manual readback evidence only
for the original run, not finalization or complete new trace bindings.

Remaining authenticated check: fetch the three new IDs; match the case/assessment
IDs, base revisions 2/3/4, base source digests, candidate LC v2 and selected versions
2/1/1. Verify finalized span ends, actual LLM usage and outcomes: staging/selection
passed; correspondence workflow and timing guard failed while both model responses
completed. Expected cumulative attempt ordinals are 8 for staging and 9/10 for
fresh extraction/planning. Check complete trees contain no raw documents or
duplicated histories. Observed transport sizes/count offsets are not official
neatlogs limits.

## Verification and remaining integration

- Typecheck and build passed. Full mocked suite: **88 passed, zero failures**.
- Exact old bad reference and exact new partial-correction proposal are rejected;
  supported escalation and complete two-issuer proposals pass.
- Single successful repair, two invalid proposals and provider failure after the
  single repair are tested, including attempt accounting, finalized spans,
  preserved successful extraction and blocked approval.
- Grounding ambiguity, literal values, stale versions, legacy normalization,
  serialization, historical provider quotations and unchanged staging are tested.
- Whitespace checks passed. Lint retains the previously identified frontend
  `set-state-in-effect` error; no frontend files were edited in this follow-up.

Existing `stage_lc`/`select_lc` requests are unchanged. Optional case fields
`extractionHistory`, assessment `sourceGrounding`, `planningFailures` and
`modelAttempts` are available through existing owner-scoped read/export responses.
No frontend control is required for normalization or bounded repair. A future
history view can distinguish original provider excerpts from validated supporting
lines and show rejected proposal reasons. Approval must continue to follow saved
status/requirements; HTTP 200 alone does not establish successful planning.

Remaining live work: fresh carrier timing, validated current drafts, fresh approval,
revised document receipt and independent recheck. The stricter planner schema and
bounded repair require a later authorized live check. Persisted neatlogs readback
and the pre-existing lint gate remain outstanding. All changes are uncommitted;
the synthetic case and saved unrelated cases were preserved.

Evidence: `output/playwright/phase4-continuation-ledger.json`,
`output/playwright/phase4-continuation-case.json`, and repeat-protected
`scripts/verify-lc-continuation.mjs`. The original Phase 4 evidence remains intact.
