import { CaseError } from './domain.ts';
import type { Case } from './domain.ts';

// Application budget, including exact bindings and retained histories. Never truncate evidence.
export const MAX_SNAPSHOT_BYTES = 900_000;
export function serializeSnapshot(c: Case): string {
  const snapshot = JSON.stringify(c);
  if (new TextEncoder().encode(snapshot).byteLength > MAX_SNAPSHOT_BYTES)
    throw new CaseError('Case snapshot exceeds the 900,000-byte storage budget. Export the retained evidence and review case size before continuing.', 413);
  return snapshot;
}
