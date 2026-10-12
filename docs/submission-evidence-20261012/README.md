# Submission evidence — 12 October 2026

[Final demo / official submission quote-post](https://x.com/RahmatUlla51126/status/2109692189982826518)

The supplied final video is 176.666667 seconds, 1920×1080, 30 fps, H.264 with AAC audio. Its local decode check passed. SHA-256 of the supplied video:

`51d58768a8db3fada3a9babf8dcb792bf767b88385b4e043fee2daa40e76205d`

These images are extracted frames from that video. The video itself is not committed here. Annotations and chapter labels are part of the authored demo, rather than native neatlogs UI. Underlying sponsor captures were labelled as authenticated/read-only in the recording packet.

| Image | Video timestamp | What is visible |
| --- | --- | --- |
| [Rejected receipt](neatlogs-rejected-demo-frame.jpg) | 1:57 | Failed WORKFLOW, coordinator/model tree and strict validation error |
| [Receipt retry](neatlogs-retry-demo-frame.jpg) | 2:11 | Successful coordinator workflow, saved received status, revision 9 and two retained findings |
| [Separate recheck](neatlogs-recheck-demo-frame.jpg) | 2:15 | Three investigators, deterministic checks and saved reviewed outcome with zero findings |
| [cfo.ai plan](cfo-plan-demo-frame.jpg) | 2:40 | Proposed pricing, cost allowances, scenario receipts and unknown-runway caveat |

## Trace references and measurement source

| Step | Trace ID | Attempts | Input / output tokens | Saved outcome |
| --- | --- | --- | --- | --- |
| Rejected receipt | `bff1cc3367d4144865e5b5fe81e5f204` | 1 | 164 / 145 | r8, waiting, two findings |
| Receipt retry | `10b1a0923ab8d56bf34722af6a65dbe4` | 1 | 207 / 137 | r9, received, two findings |
| Separate recheck | `e3a9c94d573d38c1871c8d9392ccfe4e` | 3 | 588 / 720 | r10, reviewed, no covered findings |

Source: [dated live receipt/recheck report](../lc-updates-live-receipt-recheck.md). It recorded ingestion acknowledgments at the time. Later authenticated dashboard captures/exports established the displayed workflow outcomes and input facts; an exhaustive span and source-binding audit remains incomplete. The rejected provider JSON was omitted from compact telemetry, so the exact rejected field is not reconstructed.

The 7→12 comparison concerns coordinator input facts. The strict validator still required 12 output fields. It is one observed recovery, not an accuracy or latency benchmark. Provider-reported tokens are not a billed-cost measurement.

## Incidents feature

[Separate authenticated screenshot](neatlogs-incidents-empty.jpg): on 12 October, this project's Incidents → All → All time list displayed “No incidents yet” and stated that incidents appear after the first Issue snapshot is published.

This does not establish that the application had no failures. The failure and subsequent retry/recheck are in workflow traces. No incident recommendation is claimed to have caused the earlier fix.

## Entire scope

The published checkpoint is `01M4KKQFCR2B3TVHMYEHVKPW5H`, linked to the README development-history edit:

https://entire.io/gh/Rahmat9009/lc-rescue-desk/commit/945e2387867dc6ea2ac80806ca257e26aa97a943

This public checkpoint does not represent the complete development archive. Automatic bulk checkpoint publication remains disabled.

## Business-plan boundaries

Commercial prices and scenario volumes are proposed assumptions. The Gemini allowance is modeled, not observed billing; professional customer review time is unmeasured. Actual runway is undetermined because starting cash is unknown. No paid customers, validated demand or bank acceptance is asserted.

All demonstrated trade documents and correspondence are synthetic. Covered checks passing does not establish issuer authenticity, amendment acceptance, full presentation compliance or bank approval.
