# Landing thread field

Dated 2026-10-11. A continuously moving background on the landing page, built on the React Bits
**Threads** component. It runs alongside the existing hero entrance (`components/animated-content.tsx`),
which is unchanged. This instruction supersedes the earlier "only user-caused state animates" rule in
[`design-spec.md`](design-spec.md) §4, for this field only. The workspace has no ambient motion.

## Source

| | |
|---|---|
| Component | `src/ts-default/Backgrounds/Threads/Threads.tsx` + `Threads.css` |
| Repository | https://github.com/DavidHDev/react-bits |
| Revision | `482ab1cd3f567467a8dc9f49683bcefe54223e2c` (2026-10-11, "improve orb, fallingtext, lightpillar, galaxy, silk, particles, pixelcard, shapegrid, dither, aurora and improve docs") |
| Licence | `LICENSE.md` at that revision: MIT + Commons Clause License Condition v1.0, © 2026 David Haz. Use as part of an application is permitted; selling or redistributing the component itself is not. The full notice is retained in the header of `components/threads.tsx`. |

The shaders, two-pass render (instanced line strips into a texture, then a screen pass), prop set and
clamping, and frame loop are the source's, unchanged. `Threads.css` is copied unchanged into
`app/globals.css`.

## Observed in the official demo vs. chosen here

**Observed** at https://reactbits.dev/backgrounds/threads (2026-10-11):
- The default **Silk** preset (90 lines, white on `#120f17`, angle 25°) starts as a tight bundle at the
  left and frays to the right. Its wave shape changed visibly within a 3-second interval.
- Presets: Silk, Classic, Rope, Strands, Contour, Curtain. **Strands** is 14 lines, thickness 2.6,
  amplitude 2.2, distance 0.7, angle 0°.
- The props table matches the source defaults. The demo's "Mouse Interaction" switch rendered as on,
  although the prop's default is `false`.

**Chosen for this page**, none of which come from the demo:
- Forest `#023527` strands blending toward sage `#478f81` on the paper ground, rather than light on dark.
- No cursor steering or parting. Pointer input never moves the field.
- Fewer, thicker, crisper strands than Silk, composed around the product preview instead of filling a box.
- Reading zones kept clear with CSS masks, not by lowering opacity or speed.

## Adaptations to the source (`components/threads.tsx`)

1. **One canvas per effect run.** The canvas is created in the effect and removed in its cleanup, and
   the cleanup also calls `WEBGL_lose_context`. With the source's JSX canvas, a StrictMode remount would
   call `getContext` on the context it had just lost, and repeated navigation would accumulate live
   contexts.
2. **Failure is reported.** `onStatus('failed')` fires when WebGL2 is missing, a shader fails to compile
   or link, or the context is lost. The source returned and left an empty box.
3. **Reduced motion is followed live.** The source read `prefers-reduced-motion` once. A `change`
   listener now holds or releases the loop, and reduced motion still draws one complete still frame.
4. **No window pointer listeners** unless `enableMouseInteraction` or `parting` is enabled at mount.
5. **`maxDpr`** prop (source: fixed 2). Measured below; left at 2.
6. **`data-state`** (`running` | `still` | `failed`) on the container, plus the `onStatus` callback.
7. **CSS moved** unchanged into `app/globals.css`.
8. **Container `aria-hidden`.**
9. **Refs written in a layout effect,** not during render (this project's `react-hooks/refs` lint
   rule). The layout effect precedes the wake effect, so frames still read the latest props.

Kept from the source: `IntersectionObserver` suspension offscreen, `visibilitychange` suspension in
hidden tabs, `ResizeObserver` sizing, the 1920px render cap, and full GPU-object cleanup.

## Composition (`components/thread-field.tsx`, `app/globals.css`)

Two fields share one pause control:

- **Hero.** A full-bleed layer behind the hero section. Above 1080px, strands enter low on the left,
  pass behind the preview card, and loop apart above and to its right. A radial mask clears the
  headline, lede, primary action and note. The preview's quotations, dates and synthetic label stay
  on its own white surface. At 1080px and below (phones included), the field becomes a band anchored
  to the measured bottom of the hero note (`--field-clear`). The grid gap opens to
  `clamp(88px, 22vw, 140px)` so the band has room, and it crosses behind the top edge of the card.
- **Closing action** ("Work the October 12 conflict end to end."). The motif returns, with strands
  gathering toward the button from the right edge. The heading is masked clear. The section's padding
  grows (72 / 56px) so the strands have room; no section was added. At 560px and below the field
  starts under the heading and runs behind and beneath the full-width button.
- **Control.** "Pause background motion" / "Resume background motion", a quiet mono text button
  under the preview. It is the second focusable after the hero's primary action. It is hidden under
  reduced motion, and hidden when no field can animate (every renderer failed).
- **Fallback.** `StillThreads` is a composed SVG of the same gather-and-part reading, drawn once. It
  sits behind the same masks.
- **Entrance coordination.** The field fades in over 900ms once its first frame exists, and never
  shares an element with `AnimatedContent`. A background refresh re-renders the landing without
  remounting either (verified below).
- **StrictMode.** vinext does not wrap the App Router root, so the landing is wrapped in
  `<StrictMode>` in `app/desk.tsx`. Whenever Home mounts on the client, that boundary is the inserted
  node, and development runs both renderers and the entrance through mount → cleanup → mount. A
  StrictMode boundary inside `ThreadField` was tried first and did nothing: React only double-invokes
  when the inserted fiber is inside the boundary.

### Tuned values and why

All were tuned in the running page at 1440×900 and 390×844.

| | Hero, wide | Hero, stacked | Closing, wide | Closing, stacked |
|---|---|---|---|---|
| lineCount | 44 | 24 | 26 | 20 |
| thickness / softness | 1.4 / 0.6 | 1.1 / 0.2 | 1.3 / 0.6 | 1.1 / 0.2 |
| amplitude / distance | 2.7 / 0.34 | 2.8 / 0.9 | 4.2 / 0.55 | 2.6 / 0.8 |
| waves / split / fray | 0.85 / 0.05 / 0.7 | 0.7 / 0.05 / 0.8 | 0.8 / 0.08 / 0.7 | 0.7 / 0.08 / 0.7 |
| angle | 18° | −10° | 184° | 184° |
| taper / brightness | 0.55 / 1.35 | 0.45 / 1.35 | 0.55 / 1.3 | 0.5 / 1.3 |
| speed | 0.95 | 0.95 | 0.95 | 0.95 |

- **Speed 0.95** (source 0.6): at 0.6 the field reads as nearly still over a 5-second look. At 0.95,
  7.6–8.3% of viewport pixels change in every 3-second window (measured below), yet no strand moves
  fast enough to pull the eye off the headline.
- **Amplitude 2.7, distance 0.34, split 0.05** (hero, wide): strands leave the bundle almost at once and
  swing wide enough to clear the card's top and right edges. That is where they visibly gather and
  part. With a lower amplitude the field stayed hidden behind the card. A tight bundle (distance 0.05,
  split 0.36) put a heavy dark rope behind the hero note, so it was rejected.
- **Angle 18°:** rising left to right puts the start of each strand low and leaves the top-left
  reading zone empty without a large mask.
- **Fewer strands on stacked layouts:** chosen for composition, not performance. At 390px and DPR 2,
  44 soft strands merged into one blurred ribbon. Lower softness (0.2) keeps each strand crisp at the
  small canvas size.
- **Closing amplitude 4.2:** the source scales amplitude and spacing by the canvas's cross-dimension,
  and the closing strip is only ~250px tall. Lower values collapsed into a dense moiré band.
- **Taper 0.45–0.55:** outer strands fade so sage stays an accent and the forest strands carry the form.

## Verification (2026-10-11, dev server, Chrome 154, Intel Iris Xe via ANGLE/D3D11)

| Check | Result |
|---|---|
| Moves after the entrance settles | Entrance elements at opacity 1, no inline transform, from 2.5s. Viewport pixels changed: 7.71% and 7.58% across consecutive 3s windows. In the recording: 8.04% (2.0→3.8s). |
| Pause / resume | Paused: state `still`, 0 renderer rAF in 2s, 0.00% pixel change. Resumed: `running`, ~61 rAF/s, 8.25% change in 2s. |
| Reduced motion on load | `still`, 0 rAF in 2s, 0.00% change over 2s, toggle hidden, hero entrance not applied. |
| Reduced motion changed live | → no-preference: `running`, 61 rAF/s, toggle shown. → reduce: `still`, 0 rAF. |
| WebGL2 unavailable | 0 canvases, 2 `StillThreads`, both `aria-hidden`, toggle hidden, no errors. |
| Context lost while running | Hero swaps to `StillThreads`. Closing keeps running and the toggle stays (it now tracks every field). |
| Offscreen | Both fields out of view: 0 renderer rAF in 2s. Only the closing field visible: ~60/s. |
| Hidden tab | 0 renderer rAF in 2s. ~61/s after it becomes visible. |
| StrictMode + Home ↔ workspace ×5 | Each client-side Home mount creates 4 contexts and loses 2 (StrictMode mount → cleanup → mount for both fields). Always exactly 1 canvas per field, 0 in the workspace. Leaving Home releases both (after 5 trips: 22 created, 20 lost, 2 live). |
| Background refresh on Home | `/api/cases` held 3s, then released: same two canvas elements, no new context, 0 style writes on entrance elements, view stays Home. Workspace Refresh, then Home, also works. |
| Accessibility | Fields `aria-hidden="true"`, `pointer-events: none`. Control reachable by keyboard after the primary action. |
| Overflow / hydration | 1440: `scrollWidth` = `clientWidth`. 390: 390 = 390. No console errors or hydration warnings. |

### Performance trace

Chrome traces (10s each) with in-page rAF frame intervals; the field is in view in every case. This
is a dev build on one laptop. It is evidence, not a guarantee of 60fps on other hardware.

| Scenario | Frame p50 / p95 / max (ms) | Frames > 20ms | Renderer rAF callback mean / p95 | Main-thread busy |
|---|---|---|---|---|
| 1440×900 DPR 1, running | 16.7 / 16.8 / 33.4 | 2 of 599 | 0.31 / 0.71 ms | 13.4% |
| 1440×900 DPR 1, paused | 16.7 / 16.8 / 17.7 | 0 | — | 4.1% |
| 1440×900 DPR 2, running | 16.7 / 16.8 / 18.9 | 0 | 0.34 / 0.80 ms | 14.6% |
| 390×844 DPR 3, running | 16.7 / 16.8 / 50.1 | 5 of 594 | 0.25 / 0.69 ms | 9.0% |
| 390 DPR 3, CPU ×4, running (run 1) | 16.7 / 33.3 / 50.0 | 46 of 553 | 2.18 / 6.04 ms | 81.0% |
| 390 DPR 3, CPU ×4, running (run 2) | 16.7 / 16.8 / 33.4 | 3 of 599 | 1.63 / 4.35 ms | 65.1% |
| 390 DPR 3, CPU ×4, paused | 16.7 / 16.8 / 17.4 | 0 | — | 47.7% |
| 390 DPR 3, CPU ×4, **maxDpr 1** (2 runs) | 16.7 / 16.8–17.0 / 33.6 | 9 and 25 | 1.32–2.30 ms | 51.9–83.4% |

On desktop the running field adds about 9 percentage points of renderer main-thread busy time over
the paused baseline (13.4% vs 4.1%). GPU-process main-thread task time is not reported as GPU load: it includes present/vsync
waits and did not scale with pixel count (74.8% at DPR 1 vs 37.1% at DPR 2).

**Mobile decision.** Mobile keeps the source's DPR cap of 2 (a 780×434 canvas) and gets no density
reduction for performance. Unthrottled at DPR 3, p95 matched desktop. Under ×4 CPU throttling,
halving the resolution brought no consistent improvement (long frames 9 and 25 at DPR 1 vs 46 and 3
at DPR 2), so the cost is CPU-side per frame, not fill. Run-to-run variance under throttling is large
(see the two running rows). A real low-end phone has not been measured.

## Artefacts

Local only, in the ignored `output/threads-background/` folder:
- Screenshots: `desktop-1440-hero.png`, `desktop-1440-hero-3s-later.png`, `desktop-1440-closing.png`,
  `desktop-1440-full.png`, `mobile-390-top.png`, `mobile-390-hero-field.png`,
  `mobile-390-closing.png`, `desktop-1440-webgl-fallback.png`
- Recording: `threads-background-recording.mp4` (14.4s, continuous and uncut; entrance settled →
  sustained motion → pause → resume → reply demo → closing action) and the raw `.webm` it was cut from.
