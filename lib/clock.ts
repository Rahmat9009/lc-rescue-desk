/* The instant that case-timeline decisions treat as "now": the live assessment date and the deadline
   check on receiving revised documents. Production always uses the real clock. A fixed instant exists
   only for tests: the Worker reads it from the LC_TEST_FIXED_NOW binding (lib/runtime.ts), which is
   deployment configuration that no request can set. lib/domain.ts takes the Clock type only, so its
   runtime import closure stays empty. */
export type Clock=()=>Date;
export const systemClock:Clock=()=>new Date();
export function dayOf(clock:Clock):string{return clock().toISOString().slice(0,10);}
const INSTANT=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
export function fixedClock(iso:string):Clock{const t=Date.parse(iso);if(!INSTANT.test(iso)||Number.isNaN(t))throw new Error('LC_TEST_FIXED_NOW must be a UTC instant such as 2026-10-10T12:00:00Z.');return ()=>new Date(t);}
