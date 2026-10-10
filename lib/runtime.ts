import { env } from "cloudflare:workers";
export type Runtime={GEMINI_API_KEY?:string;NEATLOGS_WRITE_KEY?:string;NEATLOGS_PROJECT?:string;LC_MODEL?:string};
export function runtime():Runtime{return env as unknown as Runtime;}
export function readiness(){const r=runtime();return {model:!!r.GEMINI_API_KEY,neatlogs:!!(r.NEATLOGS_WRITE_KEY&&r.NEATLOGS_PROJECT),modelName:r.LC_MODEL||null,liveReady:!!(r.GEMINI_API_KEY&&r.NEATLOGS_WRITE_KEY&&r.NEATLOGS_PROJECT&&r.LC_MODEL)};}
