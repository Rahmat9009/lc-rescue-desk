import { env } from "cloudflare:workers";
import { type Clock, fixedClock, systemClock } from "./clock";
export type Runtime={GEMINI_API_KEY?:string;NEATLOGS_WRITE_KEY?:string;NEATLOGS_PROJECT?:string;LC_MODEL?:string;LC_TEST_FIXED_NOW?:string};
export function runtime():Runtime{return env as unknown as Runtime;}
/* Real clock unless the test-only LC_TEST_FIXED_NOW binding is configured (see lib/clock.ts). */
export function clock():Clock{const fixed=runtime().LC_TEST_FIXED_NOW;return fixed?fixedClock(fixed):systemClock;}
export function readiness(){const r=runtime();return {model:!!r.GEMINI_API_KEY,neatlogs:!!(r.NEATLOGS_WRITE_KEY&&r.NEATLOGS_PROJECT),modelName:r.LC_MODEL||null,liveReady:!!(r.GEMINI_API_KEY&&r.NEATLOGS_WRITE_KEY&&r.NEATLOGS_PROJECT&&r.LC_MODEL)};}
