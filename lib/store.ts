import { env } from "cloudflare:workers";
import { Case, CaseError } from "./domain";
import { serializeSnapshot } from './snapshot-size';
function db() { if(!env.DB)throw new CaseError("Case storage is not configured.",503);return env.DB; }
export async function listCases(owner:string):Promise<Case[]> { const rows=await db().prepare("SELECT snapshot FROM cases WHERE owner = ? ORDER BY updated_at DESC LIMIT 20").bind(owner).all<{snapshot:string}>();return rows.results.map(r=>JSON.parse(r.snapshot)); }
export async function getCase(owner:string,id:string):Promise<Case> { const r=await db().prepare("SELECT snapshot FROM cases WHERE id = ? AND owner = ?").bind(id,owner).first<{snapshot:string}>();if(!r)throw new CaseError("Case not found.",404);return JSON.parse(r.snapshot); }
export async function insertCase(owner:string,c:Case) {await db().prepare("INSERT INTO cases (id, owner, revision, snapshot, updated_at) VALUES (?, ?, ?, ?, ?)").bind(c.id,owner,c.revision,serializeSnapshot(c),new Date().toISOString()).run();}
export async function saveCase(owner:string,c:Case,previous:number) {const r=await db().prepare("UPDATE cases SET revision = ?, snapshot = ?, updated_at = ? WHERE id = ? AND owner = ? AND revision = ?").bind(c.revision,serializeSnapshot(c),new Date().toISOString(),c.id,owner,previous).run();if(r.meta.changes!==1)throw new CaseError("Another action changed this case. Refresh to recover.",409);}
