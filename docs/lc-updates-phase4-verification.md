# Revised LC Phase 4 verification — 11 October 2026

The mocked frontend/API contract checks pass. The single bounded live run is
**incomplete**: it stopped after an invalid correspondence planner proposal. No
successful model call was repeated, no failure was retried, and no validation was
weakened. Live staging, selection and the selected-version correction cycle are
not claimed as verified.

## Mocked frontend checks

An isolated browser fixture used the actual domain helpers to create the saved
states and mocked same-origin API responses using the implemented contract.
The existing mocked API suite separately verifies the real handler/orchestration
failure and retry behavior. No live provider was deliberately failed.

- Opening the existing fixture loads the server-issued assessment tokens.
- Selection commits LC v2. The original approval is archived and remains invalid.
- A later drafting failure keeps LC v2 active, both current findings visible and
  validated timing saved. There is no approval control in this stopped state.
- The UI explicitly says selection committed and drafting needs a retry.
- **Reassess saved correspondence** recovers drafting without repeating selection:
  one selection, one reassessment. The result still requires fresh human approval.
- A 400 `fresh_investigation_required` response explains that the current invoice
  and B/L need fresh grounding. It creates no pending assessment or staging-success
  display and preserves the active selected basis.

Evidence: [failed drafting](../output/playwright/drafting-failure.png),
[recovered drafting](../output/playwright/drafting-recovered.png),
[fresh-investigation block](../output/playwright/fresh-investigation-blocked.png).

Two defects found in the existing integration were fixed in `app/desk.tsx`:
the picker now loads the full case/tokens when opening its initially selected case;
the latest-action recommendation now explains committed selection and drafting
retry rather than recommending unavailable approval. No controls were added or
interface redesign performed.

Repeat the mocked check with the local server running and `playwright-cli` available:

```powershell
node scripts/verify-lc-ui-fixtures.mjs
node scripts/verify-lc-ui-flow.mjs
playwright-cli -s=lc-phase4 open http://127.0.0.1:5173/
playwright-cli -s=lc-phase4 run-code --filename=output/playwright/mock-setup.js
playwright-cli -s=lc-phase4 run-code --filename=output/playwright/mock-flow.js
playwright-cli -s=lc-phase4 eval 'JSON.stringify(window.__phase4UiResult)'
playwright-cli -s=lc-phase4 close
```

## One bounded synthetic live run

Saved verification case: `PHASE4-VERIFY-20261011-174225`.
Case ID: `c931202a-076f-4ea1-b661-41685c9a33c9`.
The existing local development server used `gemini-3.1-flash-lite` and its configured
complete-trace exporter. All supplied documents were synthetic English text.
API live document flags describe their upload provenance; the text and file names
clearly identify them as synthetic verification material.

Expectations were calculated before any model execution from the application's
UTC clock:

| Input/result | Independently expected | Observed live |
| --- | --- | --- |
| Shipment | 2026-10-11 | 2026-10-11 |
| Latest shipment | 2026-10-12 | 2026-10-12 |
| Presentation period | 21 days | 21 days |
| Shipment plus presentation | 2026-11-01 | Consistent with extracted inputs |
| Original expiry/deadline | min(2026-11-01, 2026-10-15) = **2026-10-15** | **2026-10-15** |
| Proposed expiry/deadline | min(2026-11-01, 2026-10-21) = **2026-10-21** | Not staged or selected |

The planned happy path had 20 model calls: initial investigation/drafts 5; original
exporter/carrier correspondence 2 each; original approval 0; staging 1; selection 0;
fresh exporter correspondence 2; fresh carrier correspondence/drafts 4; fresh
approval 0; receipt coordinator 1; clean independent recheck 3.

| Actual invocation | Attempts / parsed provider responses | Reported input/output tokens | Business result |
| --- | --- | --- | --- |
| Initial investigation | 5 / 5 | 939 / 921 | Two grounded currency/consignee findings; reviewable correction drafts |
| Original exporter correspondence | 2 / 2 | 475 / 295 | Rejected: `Remedy action has an unsupported date or evidence reference.` |
| Total | **7 / 7** | **1,414 / 1,216** | No retries; no missing usage reports |

Billed cost was not available. Token counts are provider-reported usage, not a
cost estimate. The saved action returned HTTP 200 with an actual `Live action
failed` event; the verification checks events and does not treat that response as
business success.

The failed correspondence was not applied. Authenticated local case readback
confirmed revision 2, status `approval`, LC/invoice/B/L all v1, two original
findings, deadline 15 October and no approval. Original internal approval,
staging, selection, fresh correspondence/approval, receipt and recheck were not
executed after the stop. Thus archived decisions and historical correspondence
were verified under mocks, not in this live case.

A model-free call to the existing `currentGroundedFields` on this exact saved
snapshot also returned `fresh_investigation_required` for invoice and B/L. Their
initial investigator quotations were grounded substrings, but not complete source
lines required by the revised-LC contract. This is an independently observed
integration blocker, not an attempted live stage result. Fields were not altered.

The [ledger](../output/playwright/phase4-live-ledger.json) records timestamps,
versions, runs, usage, receipts, stop reason and local case readback.
`scripts/verify-lc-live.mjs` refuses to rerun when that ledger already exists.

## Telemetry: acknowledgments only

| Invocation | Run ID | Accepted trace ID | Submitted nodes / acknowledged spans / request bytes |
| --- | --- | --- | --- |
| Investigation | `2e69811b-9943-403d-8325-f9308d80414e` | `b8041a229683335372f45ab35c804497` | 12 / 13 / 6,005 |
| Failed correspondence | `a16ade5f-ec9a-495c-becf-55755912a630` | `fff98f8586ed89c6062dd9fdcd9ba058` | 5 / 6 / 2,367 |

These are ingestion acknowledgments saved in the business case. Authenticated
neatlogs readback was unavailable: exposed tools and connector discovery provided
no connected neatlogs reader; browser-session discovery was unavailable in the
execution environment. No credentials or stored authentication files were read.
**Persisted source bindings, span outcomes and dashboard/API finalization remain
unverified.** Local case readback does not substitute for remote trace readback.

Manual check: open both exact IDs using authenticated neatlogs access. Match case
ID, run IDs and base revision 0/1; check all source versions are v1; inspect the
three investigator spans, actual usage and finalized ends in the first trace.
Its deterministic guardrail should record the two expected document findings.
In the second trace, inspect the two completed model spans and failed workflow
outcome for the unsupported planner evidence/date. Verify finalized complete trees
and absence of raw documents/duplicated histories. No revised-LC assessment trace
exists for this stopped live run. The measured request sizes and observed span
offset are observations, not neatlogs' official limits.

## Final verification and remaining blockers

- `npm run typecheck`: passed.
- `npm run build`: passed; existing vinext route-classification/plugin timing notices.
- `npm test`: **75 passed**, zero failures. External providers are mocked there.
- Browser regression: passed, including visible findings, no approval control,
  committed selection, retry and explicit fresh-investigation failure.
- `git diff --check`: passed; only checkout CRLF normalization warnings.
- `npm run lint -- --ignore-pattern output --ignore-pattern .playwright-cli`:
  one error and 13 warnings. Generated browser artifacts are excluded from this
  source check. `app/desk.tsx:269` synchronously copies evidence state in an effect;
  the exact effect is already in Git HEAD. It is a pre-existing React lint/render
  performance issue, not introduced by these fixes. No functional revised-LC
  defect was attributed to that effect during these checks.

Submission blockers: the bounded live end-to-end revised-LC flow remains
unverified; the original correspondence planner produced an invalid proposal;
the current initial investigator can save quotations insufficient for later
complete-line grounding, with no existing full reinvestigation action for this
already investigated case; authenticated neatlogs readback remains outstanding;
the repository lint gate remains red on its pre-existing error. Validation and
supported-check boundaries remain intact.

All prior work and saved cases were preserved. The synthetic case and development
server were retained; the isolated mocked browser was closed. Changes remain
uncommitted. No database reset, deployment or external messaging was performed.
