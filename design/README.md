# LC Rescue Desk — redesign research

These are historical research and study sources. The later implementation and corrections are recorded in [`corrections.md`](corrections.md). Downloaded Mobbin screenshots and local browser renders are retained only in the local workspace, excluded from public Git; permanent reference URLs remain in [`references.md`](references.md).

Research only. **The production frontend was not modified by this task.** Everything here is reference material,
specification and comps. Dated 2026-10-11.

## Documents

| File | What it is |
|---|---|
| [`references.md`](references.md) | Reference shortlist with exact Mobbin URLs, observed details kept strictly separate from proposed adaptations, and the list of what was inspected but not used |
| [`section-map.md`](section-map.md) | All 21 sections: purpose, placement, reference, composition, real LC Rescue content, interaction states, shared components — plus 10 merge/remove/fix recommendations |
| [`design-spec.md`](design-spec.md) | Shared tokens (type, space, surface, border, radius, status colour, motion), the coherence narrative, shared components, and the seven rules this product needs that a generic system would not |
| [`typography.md`](typography.md) | Two alternatives on identical content, licensing verified against the actual OFL files, critiqued against Impeccable's `typeset` criteria, with a recommendation and its tradeoffs |

## Assets

- `references/` — 14 reference screenshots, saved because Mobbin image URLs expire after 30 days. `references.md`
  links each one to its permanent `mobbin.com` page.
- `studies/` — `tokens.css` plus two HTML comps and their renders. Both studies import `tokens.css` **unchanged**;
  that shared import is the coherence claim, made testable.
  - `study-1-hero.html` / `.png` / `-mobile.png` — landing hero and product preview
  - `study-2-latest-action.html` / `.png` / `-mobile.png` — workspace latest action, deadline strip, correspondence, grouped history
  - `type-specimen.html` / `.png` — the two typography alternatives side by side

Open the HTML files directly in a browser; they have no build step and no dependency on the application.

## Recommendation in one paragraph

Take **incident.io's case-detail anatomy** for the workspace (status strip, chronological evidence, right-rail key
dates, grouped change events), **Semrush's review diff** for conflict display (line-number gutter, block tint plus
inline token highlight), **Attio's grouped changes** for plan and audit history, and **Harvey's asymmetric
serif-led hero** for the landing. Set it in **Source Serif 4 + IBM Plex Mono**, where everything the product says
is serif and everything a document states is mono. These belong together because all four are restrained,
near-monochrome and text-forward: none relies on illustration, card chrome or colour for its identity, so combining
them produces one voice rather than four. Full tradeoffs in `typography.md`.

## The three defects this is designed to fix

Found by inspecting the running application (`current/`), not assumed:

1. **The distinctive scenario is invisible.** Deadline 2026-10-12, invoice 2026-10-12, carrier 2026-10-16 exists
   only as prose scattered across three panels. Fixed by `DeadlineStrip` (section B4) — new, and the highest-value
   addition in the map.
2. **"Previous plans (14)", twelve of them identical**, each headed by a raw ISO timestamp like
   `2026-10-11T04:57:52.925Z`. Fixed by grouping into episodes with `ChangeChip` deltas (B10, merged into B11).
3. **The recommendation is stated three times** on one screen — latest-action band, strategy card, correspondence
   card. Fixed by stating it once in B3.

Plus one hard bug found during the audit: **below 560px the rail is `display:none`**, so the brand Home action and
all four destinations are unreachable; only the breadcrumb Home survives. Recorded in section-map B1.

## Unresolved asset need

**The real logo.** It was shown in conversation but no file reached disk, so the studies use a stand-in traced from
that screenshot, and the palette is derived from it. Needed: the original SVG, a dark-background variant, and the
two exact brand hex values.
