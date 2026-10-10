# LC Rescue Desk

A neatHack prototype for investigating LC document conflicts, proposing issuer corrections, recording human approval, responding to simulated counterparty replies, and checking revised document versions.

## Current working scope

- English UTF-8 text-native LC, invoice and bill of lading, up to 16,000 characters each.
- Source-grounded extraction, currency/reference/explicit consignee conflicts, numeric/date checks and calculated presentation deadline.
- Exporter correction and carrier reissue request drafts. Approval binds source versions.
- Revised versions and originals retained; independent recheck; complete JSON audit export.
- Carrier delay and buyer-waiver scenarios produce safe escalation.
- Owner-scoped D1 persistence with compare-and-swap revision checks.

**Demo mode is deterministic fixture execution. It runs zero LLM agents.** Live mode executes three document investigators concurrently, then a remedy planner and counterparty coordinator. Code, rather than the model, controls validation, approval and final state. Full live workflow execution and persisted trace readback remain unverified.

No bank-ready certification is claimed. Full UCP/ISBP interpretation, bank holidays, original-document authenticity, PDFs/OCR, recipient verification, external messaging and bank submission are outside this build. Only explicit consignee terms are compared; general name variation is not implemented. Counterparty reply scenarios are simulated in both modes. Live revised documents are user uploads, not model-generated third-party instruments.

## Local development

Use Node 24 and pnpm. From this folder:

```sh
pnpm install
pnpm run build
pnpm exec wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_steady_namorita.sql
pnpm run dev
```

Apply that schema only to a fresh local database. Production uses tracked schema migrations automatically. For repeated development, preserve the local database. The Vite dev server uses a local auth mock and serves the demo at `http://127.0.0.1:5173/`; the built Wrangler server started by `pnpm run start` requires Sites-authenticated identity and does not provide a local sign-in route.

For live local runs, keep an ignored root `.dev.vars` with the names in `.env.example`. The Vite dev server reads this root file. Every build copies it into `dist/server/.dev.vars` for the generated Wrangler config, and `pnpm run start` refreshes that copy before launch. Keep the root file and local `.wrangler/state` database; rebuilds do not require another schema import. Do not commit either secret file. For a hosted run, configure the same values as server runtime settings, not in client code.

```sh
pnpm run typecheck
node --test tests/domain.test.mjs
# Requires the built Worker from pnpm run build:
node --test tests/api.test.mjs
node --test tests/live.test.mjs
```

The in-process API test runs Miniflare with an isolated test D1 database. It does not open a preview server. Browser visual/interaction QA has not been performed in this environment.

## Live model and neatlogs configuration

- `GEMINI_API_KEY`: server secret for Google's Gemini API.
- `LC_MODEL`: a Gemini model ID available to that key and supporting JSON output. The verified local choice is `gemini-3.1-flash-lite`; keep the selected value in `.dev.vars`.
- `NEATLOGS_WRITE_KEY`: server secret, **HTTP write key** starting `nlw_`.
- `NEATLOGS_PROJECT`: exact neatlogs project **name** (not its UUID).

The SDK project key is a different credential. This hosted Worker uses the documented HTTP integration because the Node SDK requires dynamic code generation unavailable in Workers.

Live document input and model outputs are sent to Gemini. The Worker uses raw `fetch` to Google's [OpenAI-compatible chat completions endpoint](https://ai.google.dev/gemini-api/docs/openai) with JSON-object output, minimal reasoning and an 8,192-token output budget. Start with synthetic or anonymized documents. Failed live actions preserve the previous case state and record the failure; they do not fall back to fixtures. Provider-reported token usage is accumulated. No pricing or currency cost is invented; use the selected model's actual billing for cfo.ai.

A small direct request with `gemini-3.1-flash-lite` returned HTTP 200 and parseable JSON with provider usage. That verifies local authentication and this response format only; full live investigations and neatlogs readback still need separate verification.

Tracing builds one complete nested WORKFLOW/AGENT/LLM/GUARDRAIL tree per invocation and posts it to `https://ingest.neatlogs.com/v1/trace` with `User-Agent: LCRescueDesk/0.1`. Every node ends before export; all concurrent workers are awaited even when one fails. Status, timing, model IDs, provider-reported tokens, extraction quotes and deterministic findings remain in the trace. The service-generated trace ID and acknowledged span count are recorded only on a valid receipt. Tokens are absent when usage is unknown, rather than invented as zero.

The HTTP trace intentionally omits raw source documents, exact system prompts, duplicate AGENT input/output copies, repeated finding details in planner/coordinator inputs, and full coordinator draft text. Document kind, version and byte length identify the saved source; LLM outputs retain extraction quotes, and the guardrail retains the checked findings. Originals and full drafts remain in the local case. This limits duplicated telemetry while preserving the full span tree. Transport diagnostics showed a 6,144-byte single-node trace and a 6,000-byte 12-node synthetic trace accepted, while 8,192- and 12,288-byte traces received HTML 403 responses from `awselb/2.0`. The exact upstream limit is unconfirmed; larger valid traces can still be rejected. Failure events record request bytes and node counts without changing the case result. Neatlogs payload readback remains unverified.

The Node SDK local Doctor initially passed, but the mocked live Worker test exposed an EvalError while importing it. The hosted application was changed to HTTP injection; the SDK diagnostic does not validate this hosted HTTP path.

### Required evidence loop

1. Configure the HTTP write key, exact project name and model settings securely.
2. Open a **live** case with synthetic source documents and run investigation.
3. Find the exact trace ID in the audit trail and read it back in the neatlogs dashboard.
4. Check a finalized root, three parallel investigator agents and their LLM children, deterministic guardrail, remedy planner and coordinator; inspect source/output and provider usage.
5. Exercise an invalid JSON or unsupported extraction branch; inspect the real failure trace, fix the cause, and rerun with a fresh correlation marker.
6. Inspect recheck and simulated-reply workflows separately. Record actual trace links in Evidence.

| Workflow | Trigger | Expected capture | Verification |
| --- | --- | --- | --- |
| Investigation | Investigate live case | Root; 3 investigators/LLMs; guardrail; planner/LLM; coordinator/LLM for supported conflicts | Pending actual application run + finalized readback |
| Recheck | Upload revised documents, then recheck | New root; 3 investigators/LLMs; guardrail; correction roles only if new findings | Pending |
| Reply assessment | Simulated delay/waiver or uploaded revision receipt in live case | Root; coordinator/LLM | Pending |
| Fixture rehearsal | Demo actions | No neatlogs export or LLM calls | API and domain tests |

An export request, a local Doctor pass, or a trace ID alone is not evidence that the application's trace was persisted correctly.

## Sponsor setup still required

- [neatlogs setup guide](https://neatlogs.com/hackathon/neatlogs-setup-guide.html): create organization/project and collect the HTTP write key (`nlw_`) and exact project name for this Worker. The SDK guide also describes a separate Project API key. Never paste keys into chat.
- [Entire event guide](https://hack.entire.io/neathacks-2026/): connect the **GitHub development repository**, install the official CLI and create an accessible checkpoint. The Sites source commit is not an Entire checkpoint. This guide returned HTTP 403 during research; no CLI commands are invented here.
- [cfo.ai event signup](https://cfo.ai/neathacks): the organizer's supplied email says signup requires a card and to cancel immediately under Settings → Billing. Create the actual plan and attach its link.
- [Discord support](https://neatlogs.com/discord): ask organizers about credits or account setup issues.

## Demo rehearsal

1. New case → Synthetic demo → Investigate.
2. Show EUR vs USD and explicit B/L consignee conflict, each with source quotes.
3. Review drafts → Approve correction requests.
4. Receive synthetic revised versions → Recheck. Show retained originals in Documents.
5. Open a second case and choose Carrier delay. Show that the deadline prevents a resolved outcome.
6. Export case evidence, then show **real** sponsor artifacts after account setup.

Do not pitch fixture execution as actual multi-agent execution. No benchmark against a competent single-agent baseline has yet been run. Record fairness, latency, token cost, discrepancy precision and correction outcome when building that comparison.

## Verified build checkpoint

2026-10-10: strict TypeScript check, production build, and all 22 tests passed. Live-runtime tests use mocked model and ingest HTTP endpoints; they do not prove real model quality or neatlogs persistence. Browser interaction and visual QA remain unverified.
