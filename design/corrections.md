# Specification corrections before implementation

Dated 2026-10-11, after review of the research in this folder. These supersede the earlier documents where they
conflict; `design-spec.md` and `typography.md` have been amended to match.

---

## 1. The adaptive demonstration must be generated, not written

**Was:** `section-map.md` A5 specified the two recommendation strings as literal content.
**Correction:** the landing demonstration runs the application's **real model-free domain functions** in component
scope and renders whatever they return — `newCase` → `parseFixture` → `finishInvestigation` →
`newCorrespondence` → `validateExtraction(demoQuotes(…))` → `defaultCandidate` → `applyCorrespondence`. This is the
identical call sequence `lib/agents.ts` uses for demo mode (lines 100–102). No recommendation text is hardcoded.

Verified by executing that pipeline before building any UI on it:

| After | `timing` | `nextAction` |
|---|---|---|
| Exporter, "We will send the corrected invoice on 2026-10-12." | `unknown` | "Clarify missing correction dates and obtain specialist timing review before relying on this plan." |
| Carrier, "We can reissue the corrected B/L on 2026-10-16." | `conflict` | "Escalate to a trade specialist and clarify the carrier timeline and presentation options with the relevant parties." |

The earlier studies showed the escalation text after step 1, which contradicted the domain result. Corrected.

## 2. Synthetic demonstration is separated from case data

- Every landing figure is drawn from the synthetic fixture pack and carries a persistent synthetic marker.
- The workspace reads **only** from the selected case: `c.asOf`, `c.deadline`, `c.docs[].version`, `c.findings`,
  `c.recoveryPlan`, `c.statements`. No fixture value may appear in a workspace view.
- **Countdowns state their basis.** "2 days" becomes "2 days from case date 2026-10-10", because `asOf` is the
  case's assessment date, not today.
- **Counterparty dates are reported availability.** Rendered as "reported available" with
  "authenticity unverified" adjacent — never as a commitment or a schedule.
- Assumption, reported and unresolved are three distinct states: `plan.earliestDate` is an assumption,
  a dated statement is reported, and an absent date renders `Not established` and plots no point.

## 3. Source comparisons resolve against the saved version

- A new `locateQuote(text, quote)` resolves a quotation inside the **exact saved document version** and returns
  `{line, occurrences}`. Multiline quotations match on their first line. **Ambiguous** (more than one occurrence)
  and **not found** both suppress the line number rather than guessing one. A line number is never invented.
- **Quoted LC requirement vs computed rule are now distinguished.** `validate()` produces `expected` values of two
  kinds: a value read from the LC (`currency: USD`, with its own quote and line) and a computed rule
  (`A supported … value`, `YYYY-MM-DD calendar date`, `Integer from 1 to 365`, the calculated deadline). Only the
  first is labelled "LC requires" and given a line number; the second is labelled "Validation rule" with no line.
- The comparison is labelled **"required / states"**, never "expected / corrected", so it cannot imply a corrected
  document exists. A corrected version is shown only when `c.docs[].version > 1`.

## 4. The real workflow is preserved

- Receiving revised documents (`reply`) and rechecking them (`recheck`) stay two separate actions with two
  separate controls. No combined button.
- **Approval text states the actual binding** from `lib/domain.ts` `transition()`: the document versions
  (`documentVersions(n)` covers LC, invoice and B/L) and, when a recovery plan exists, `planId`. Rendered as:
  "Binds letter of credit v1, commercial invoice v1, bill of lading v1" plus "and recovery plan <id>" when
  `c.recoveryPlan` is set.
- The frontend only *displays* `c.status`, `c.approval` and `plan.approvalRequired`. It introduces no approval rule.

## 5. History is compact without losing evidence

- Entries group by a **material-field signature**, not headline similarity:
  `timing · nextAction · reason · sorted evidenceRefs · sorted unresolved · approvalRequired ·
  actions(kind/owner/dueDate/dependsOn)`. Two revisions collapse only when all of these match.
- Every grouped entry exposes **View full revision** per underlying revision, showing that revision's complete
  plan, its own timestamp, its approval record and its document versions.
- Correspondence keeps its verbatim text, every extracted statement, and prior assessments.
- The JSON export is untouched: it still serialises the whole `Case`.

## 6. Readiness claims are separated into four distinct states

Previously one amber "pending" string covered all of them. Now:

| State | Means | Evidence |
|---|---|---|
| **Configured** | A server setting is present | `readiness()` booleans |
| **Saved** | A URL or ID is stored on the case | `c.evidence.*` non-empty |
| **Receipt accepted** | The ingest endpoint returned a valid receipt | a trace id recorded on an event |
| **Verified** | A human opened it and confirmed | **not implemented — never claimed** |

"A saved URL does not mean verified" is stated in the view. **"Private workspace" is removed**: no access control
beyond owner-scoped D1 queries is implemented, so the phrase overstated it.

## 7. Typography — the recommendation changed

The earlier recommendation (Alternative A, Source Serif 4 for all prose) was made largely on hero evidence.
Re-tested on **dense workspace content** per requirement 7 — `studies/type-comparison-workspace.png`:

**Alternative C wins and is now the recommendation:** Source Serif 4 (headings) · Source Sans 3 (body, controls) ·
IBM Plex Mono (evidence, dates, amounts, line numbers). All three SIL OFL, availability and licence files verified.

Evidence from the render, not assertion:
- In A, serif key/value labels wrap — "B/L reported available" breaks to two lines — making the deadline column
  ragged. C fits them on one line.
- A's monospace button ("Reassess saved correspondence") is wide and reads as a code token. C's sans control is
  compact and reads as an action.
- A's serif Unresolved list scans slowly; this is a checklist, not prose.
- C keeps Source Serif 4 for headings, so the landing↔workspace coherence mechanism is unchanged.

Source Sans 3 is the designed companion to Source Serif 4 (both Adobe), so the pairing is principled rather than a
third family chosen for novelty.

**Other type corrections**
- **The 15px/16px conflict is resolved.** `--body: 16px` is the prose floor. `--body-sm: 15px` is explicitly a
  *secondary/dense* role (captions, table cells, chip text) and is never used for primary prose. The old
  `body{font-size:15px}` is gone.
- **Low-contrast small text replaced.** `--mute` darkened `#5d6b62 → #4d5d53`, `--faint` `#8a988f → #6d7f74`.
  `--faint` is restricted to ≥12px mono labels.
- **No blanket opacity on historical values.** A superseded value is marked with strike-through at full colour
  weight; `opacity` is not used to de-emphasise any value a reader may need.
- **Spacing scale made internally consistent:** `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96`. The earlier
  `22 / 30 / 44` steps broke the doubling and are removed.

## 8. Navigation and responsive behaviour

- The explicit `view: 'home' | 'case'` state is preserved; `refresh()` still never touches it, so a background
  refresh cannot dismiss the landing or the modal.
- **Mobile navigation is now complete.** The ≤560px `display:none` on the rail is replaced by a disclosure drawer
  reaching every destination, plus Home. Previously Home was reachable only via the breadcrumb and the four
  destinations were unreachable.
- Long references, statuses and quotations wrap (`overflow-wrap:anywhere` on data cells; no `white-space:nowrap`
  on variable-length content).
- Keyboard: visible focus on every control, disclosures operable by keyboard, modal focus trapped and restored,
  `prefers-reduced-motion` honoured.

## Logo — resolved

`public/LC Rescue Desk document logo.png` was supplied (2172×724, RGBA with real transparency). It is used
directly; nothing is substituted. A mark-only crop for small sizes is `public/logo-mark.png` (400×400), produced
from that same file.

**Exact brand colours sampled from the asset** — these replace the values estimated from a screenshot:

| | Estimated earlier | **Actual** |
|---|---|---|
| Dark | `#0d3a2c` | **`#023527`** |
| Sage | `#5ba288` | **`#478f81`** |

Because the artwork is dark on transparent, **the rail is now a light surface**. A forest rail would require
recolouring the supplied mark, which the brief forbids. This also matches the "two grounds only" rule better than
the previous arrangement.
