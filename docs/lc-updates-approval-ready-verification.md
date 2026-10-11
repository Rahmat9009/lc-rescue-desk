# Revised LC recovery ready for fresh approval — 11 October 2026

The saved synthetic case is **revision 6, status `approval`**. LC v2 and the
21 October 2026 deadline remain active. There is **no recorded approval**.
No live staging, selection, approval, receipt or recheck was repeated/performed
in this verification. Only one synthetic carrier correspondence was submitted.

Case: `PHASE4-VERIFY-20261011-174225` (`c931202a-076f-4ea1-b661-41685c9a33c9`).

## Starting state and runtime freshness

Owner-scoped API readback confirmed revision 5, status stopped, LC/invoice/B/L
versions 2/1/1, deadline 2026-10-21 and no active approval. The exporter statement
survived the prior failed proposal:

> Synthetic exporter: We will send the corrected invoice on 2026-10-16.

Its source binding is `lc:v2|invoice:v1|bl:v1`. The prior selected assessment,
original source history and rejected proposal history were retained.

Typecheck, build and the full mocked suite completed before live execution.
The local development server was cold-restarted from current source without
resetting storage. The freshly built Worker contains the single-repair branch,
and the mocked Worker suite exercises successful repair, two invalid proposals
and repair-provider failure. Source SHA-256:
`F41C48923AA8821AADB901D49D5C04F8E58B1268C97031549F8BEA6825086ADB`.
The source stayed unchanged during live execution. Runtime evidence is in
`output/playwright/recovery-runtime.json`.

## Exact carrier fixture and live outcome

Sender: carrier. Exact text:

> Synthetic carrier: We will reissue the B/L on 2026-10-17.

The application recorded received date **2026-10-11**. Correspondence remains
user-provided and authenticity unverified. Correspondence ID:
`7a521355-151e-4633-9ae5-f6347b4e5475`.

The declared maximum was **five model attempts**: extraction, planner, at most one
repair, strategy and draft generation. Actual attempts were **four**, all with
parsed provider responses, and **zero repairs**. The first proposal passed
validation. No successful extraction was repeated and no fault was injected.

The resulting plan was independently revalidated using the existing strict
validator, then read back through the owner API. Both request dates are before
21 October, all references belong to current findings/statements, dependencies
are ordered, and plan/draft document bindings exactly match LC v2, invoice v1
and B/L v1. Timing, drafting and specialist/outside-coverage blocking flags are
clear. The two findings remain open until revised documents are received and
independently checked.

| Action | Supported date | Exact evidence references |
| --- | --- | --- |
| Exporter invoice correction | 2026-10-16 | `finding:invoice.currency`, `statement:9e0ec179-398b-4b6f-a064-f149f1f02be3:s1` |
| Carrier B/L correction | 2026-10-17 | `finding:bl.consignee`, `statement:7a521355-151e-4633-9ae5-f6347b4e5475:s1` |
| Subsequent recheck | null | Both finding references and `deadline`; depends on both correction requests |

The model labels the downstream recheck owner `Bank`. This is a planning label,
not evidence of bank participation or acceptance. The API's independent recheck
uses the application's investigators for covered prototype checks; full issuing-bank
examination remains separate.

## Saved drafts for human review

Exporter draft, verbatim:

> Dear Exporter, please review the submitted invoice. The currency is currently listed as EUR, but it must be issued in USD to align with the agreed terms. Kindly reissue the invoice with the correct currency by 2026-10-21.

Grounding: invoice v1 says `currency: EUR`; selected LC v2 says `currency: USD`.
The exporter's unverified current-version correspondence reports 16 October
availability. The plan uses 16 October for the correction request; the draft's
21 October date is the presentation deadline, not a substitute commitment date.

Carrier draft, verbatim:

> Dear Carrier, please review the submitted bill of lading. The consignee is currently listed as SYNTHETIC BUYER LTD, which conflicts with the LC instruction requiring it to be issued 'TO ORDER OF SYNTHETIC TEST BANK'. Kindly reissue the document with the correct consignee details by 2026-10-21.

Grounding: B/L v1 says `consignee: SYNTHETIC BUYER LTD`; LC v2 says
`consignee: TO ORDER OF SYNTHETIC TEST BANK`. The carrier's unverified current-version
correspondence reports 17 October availability. Neither draft has been sent.
They are based on the selected analysis basis and do not establish amendment
acceptance, authenticity or bank approval. The saved next-day turnaround value
remains explicitly an assumption, not the carrier's reported availability.

**Next UI action:** open this case, review the saved drafts, then click
**Approve correction requests** under **Latest validated action** if you approve
both internal requests. That action will bind LC v2/invoice v1/B/L v1 and the
current recovery-plan ID. It has not been taken on the user's behalf.

## Model and trace accounting

Saved revision: 5 → **6**. New provider-reported usage: **1,690 input / 582 output
tokens**, zero missing reports. Cumulative case totals: **14 attempts/responses**,
**4,119 input / 2,413 output tokens**. Billed cost unavailable.
Live execution occurred around **21:48 on 11 October 2026, Asia/Qatar**.

Run ID: `ab83404b-c63f-4919-bb01-9729206a2c72`.
Accepted trace ID: `9a7ddae0eb02e13c334f5e1fb1dc4a72`.
Receipt acknowledged 11 spans for 10 submitted nodes; request size was 3,818 UTF-8
bytes. These are observations, not neatlogs' official limits. The existing complete
exporter was used; raw documents, full drafts and duplicate histories were omitted
from telemetry rather than truncating the evidence retained in case storage.

The ingestion receipt is accepted. **Independent neatlogs persisted readback remains
unverified.** Available connector discovery returned no authenticated neatlogs
reader. Local case readback proved the saved business state, not remote trace
durability/finalization. Remaining manual trace check: match this case and selected
assessment `791b5a11-9a93-4ed0-b046-37e608ba4a32`, base revision 5, versions 2/1/1,
four completed model spans (attempt ordinals 11–14), one passing planning guard
and finalized span ends. No repair span should exist.

## Mocked receipt and recheck verification

A new isolated Worker regression seeds the exact revision-5 synthetic snapshot
into a separate test database. All providers and telemetry are intercepted.
It verifies:

- Carrier correspondence reuses exporter extraction and generates current drafts
  without staging, selection or document investigator calls.
- Receipt before fresh approval fails without changing document versions.
- Fresh approval binds exact versions 2/1/1 and the current recovery-plan ID.
- An approval bound to the original LC v1 cannot authorize receipt.
- Valid receipt promotes invoice and B/L to v2, clears active approval/timing
  decisions and archives their source-bound approval/statements.
- Recheck invokes all three independent investigators against v2 documents,
  produces no remaining covered findings and retains deadline 21 October,
  LC v1/v2, original invoice/B/L sources, extraction history and selected assessment.
- Owner-scoped serialized readback matches the final test snapshot.

No live approval, receipt or recheck was used to obtain these results.

## Final checks and remaining work

- Typecheck: passed. Build: passed. Full suite: **89 passed, zero failures**.
- Whitespace checks: passed. No production or frontend code changes were needed
  in this continuation. The previously documented frontend lint issue remains.
- Changed files: `tests/lc-update-api.test.mjs`, synthetic fixture
  `tests/fixtures/phase4-selected-recovery.json`, repeat-protected verification
  script `scripts/verify-lc-approval-ready.mjs`, this report and synthetic evidence
  artifacts under `output/playwright`.

There is no current domain blocker to fresh internal approval. Independent
neatlogs readback remains outstanding. Live receipt and recheck are intentionally
pending the user's approval. After approval, upload the corrected synthetic invoice
and B/L, receive the uploaded versions, then run the existing independent recheck.
All changes remain uncommitted. Saved cases, selected LC v2 and retained history
were preserved; the current local development server remains running.
