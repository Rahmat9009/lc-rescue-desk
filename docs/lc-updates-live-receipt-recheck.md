# Revised-LC live receipt and recheck verification

Completed on 11 October 2026 for **PHASE4-VERIFY-20261011-174225**. Local owner-scoped application readback verifies **revision 10, Reviewed, no covered findings**, LC/invoice/B/L all **v2**, deadline **2026-10-21**. Full presentation review remains required. This is a synthetic prototype check, with no issuer authenticity, amendment acceptance, bank approval or external communication established.

## Approval and unchanged fixtures

The starting saved revision was **7 / waiting**. The human's approval recorded revision **6**, timestamp `2026-10-11T19:04:14.655Z` (22:04:14.655 Qatar), recovery plan `1a64c66f-feb4-4e65-a342-c42284c0f7c1`, and exact source bindings **LC v2 / invoice v1 / B/L v1**. Both approval and plan matched the saved sources before any model execution. No approval, staging, selection or correspondence planning was repeated.

Revised filenames:

- `PHASE4-VERIFY-20261011-174225-SYNTHETIC-REVISED-INV-v2.txt`
- `PHASE4-VERIFY-20261011-174225-SYNTHETIC-REVISED-BL-v2.txt`

The fixtures retain their explicit synthetic source headers. Only `currency: EUR` became `currency: USD`, and `consignee: SYNTHETIC BUYER LTD` became `consignee: TO ORDER OF SYNTHETIC TEST BANK`. Restoring these replacements reproduces each original source exactly; all other fields and case references were preserved. Documents were received through the existing owner-scoped `reply / available` application action as user-provided text, with authenticity unverified.

The independently expected deadline is `min(2026-10-11 + 21 days, 2026-10-21) = min(2026-11-01, 2026-10-21) = 2026-10-21`. Shipment also precedes the latest shipment date, 2026-10-12. Invoice USD 48,000 is below the USD 50,000 ceiling; the corrected consignee matches the explicit LC instruction.

## Bounded execution and narrow fix

The inspected path required four attempts: one receipt coordinator and three parallel investigators for a separate clean recheck. Maximum authorized budget: five additional attempts. Actual: **five**, including one unsuccessful receipt and one controlled retry; no planner repair, extraction retry or extra drafting calls.

The first receipt's parsed coordinator response failed the existing exact-output guard. Revision **8 / waiting** retained original invoice/B/L v1, both conflicts and matching approval; no receipt or recheck was falsely reported. The rejected provider JSON was omitted from the compact trace, so the specific mismatched field cannot be reconstructed. The known failure is an exact field/value/type/schema mismatch, not a demonstrated provider transport error.

The previous coordinator input supplied seven facts while its validator required twelve exact fields. The narrow fix supplies all twelve required literal fields, including unconfirmed authenticity/bank acceptance and the next action, with explicit JSON types and no extra keys. Validation remains strict; safe diagnostics identify only expected mismatched field names and the count of unsupported keys, without echoing provider content. Missing flags, altered deadline/version/type, confirmation claims and extra keys remain rejected in regression tests. No production diagnostic endpoint or fault switch was added.

Offline checks passed before retry. The built Worker contained the final prompt, and the identified local development process was restarted from current source without altering saved case storage. The retry reused the exact fixture files and original human approval.

| Operation | Saved result | Actual attempts | Provider input / output tokens | Qatar time |
| --- | --- | --- | --- | --- |
| First receipt, rejected validation | r8 / waiting, sources 2/1/1 | 1 | 164 / 145 | 22:15:41–22:15:46 |
| Receipt retry | r9 / received, sources 2/2/2, both conflicts retained | 1 | 207 / 137 | 22:24:14–22:24:17 |
| Separate independent recheck | r10 / reviewed, sources 2/2/2, covered findings empty | 3 | 588 / 720 | 22:24:17–22:24:21 |

Additional reported usage: **959 input / 1,002 output tokens**, zero missing usage responses. Saved case cumulative count: **19 attempts / 19 parsed responses**, usage **5,078 / 3,415** tokens. Model: configured Gemini `gemini-3.1-flash-lite`. Billed cost was not available.

## Persistence and evidence

Owner-scoped GET readback exactly matched the saved r9 and r10 results. Receipt retained the original findings unchanged; only the separate recheck cleared them. All three new extraction events and records bind current v2 sources. An additional read-only audit independently established unique supporting source-line grounding for every current field and reran deterministic checks, obtaining no covered conflicts and the expected deadline.

The archived approval remains unchanged at its original **2/1/1** bindings and plan ID; it was not rebound to revised documents. Active approval was cleared on receipt. History retains six source versions (each document v1 and v2), four prior plans including the approved plan, one rejected planner proposal, seven extraction records, the selected assessment and previous analysis, both correspondence records, and the failed first receipt event. Current statements were archived under their original bindings. The original LC v1 run had no human approval, as already documented; no historical approval was invented. Final serialized snapshot was 95,435 bytes, within the application boundary.

## Trace evidence

| Operation | Run ID | Neatlogs trace ID | Receipt |
| --- | --- | --- | --- |
| Rejected receipt | `25cbe66b-2b89-44cf-962c-2bc92fb6d2b6` | `bff1cc3367d4144865e5b5fe81e5f204` | 4 acknowledged spans / 3 submitted nodes; 1,572 bytes |
| Receipt retry | `b7ce1ca2-874e-4939-8dde-6bdb12c43508` | `10b1a0923ab8d56bf34722af6a65dbe4` | 4 acknowledged spans / 3 submitted nodes; 1,603 bytes |
| Recheck | `cdc28e00-5b13-4652-90f5-9361836cafdd` | `e3a9c94d573d38c1871c8d9392ccfe4e` | 9 acknowledged spans / 8 submitted nodes; 2,960 bytes |

These are validated ingestion acknowledgments recorded in the persisted case, **not independent neatlogs persisted readback**. No authenticated neatlogs reader is exposed through the available tools. Manual readback must locate these IDs, confirm the failed first workflow and successful later workflows, finalized spans and actual token usage, selected assessment `791b5a11-9a93-4ed0-b046-37e608ba4a32`, receipt base revision/source versions 8 / 2/1/1, and recheck base 9 / 2/2/2 with successful deterministic checks. Exact source bindings and full histories are retained locally; compact exporter intentionally omits raw sources/provider output and duplicate histories. The recorded byte counts describe these requests, not neatlogs' official transport limit.

## Checks and remaining boundaries

- Typecheck and build passed with the final receipt contract.
- Full suite: **91 passed, zero failed**, all test providers mocked. Existing revised-LC API regression covers fresh approval, current receipt/recheck bindings and retained history; the added receipt contract tests preserve strict failure behaviour.
- Whitespace and verification script syntax checks passed.
- Lint still fails on the pre-existing `app/desk.tsx:269` set-state-in-effect error, confirmed in Git HEAD; 15 warnings remain. No frontend files were edited during this task.

The live receipt/recheck scenario is complete. Remaining gates are independent neatlogs readback, the existing frontend lint error and full trade/bank presentation review. All work is uncommitted; no push or deployment occurred.

Task changes: `lib/domain.ts`, `lib/agents.ts`, `tests/reply-contract.test.mjs`, the mocked receipt assertions in `tests/lc-update-api.test.mjs`, repeat-protected `scripts/verify-lc-live-receipt.mjs`, and read-only `scripts/verify-lc-receipt-readback.mjs`. Retained evidence is in `output/playwright/receipt-recheck-ledger.json`, `receipt-retry-ledger.json`, `receipt-retry-saved-case.json`, `receipt-retry-final-case.json`, `receipt-readback-audit.json` and `revised-fixtures/`.
