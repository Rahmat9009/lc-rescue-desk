export type Kind = "lc" | "invoice" | "bl";
export type Mode = "demo" | "live";
export type Doc = { kind: Kind; name: string; text: string; version: number; synthetic: boolean };
export type Finding = { id: string; doc: Kind; field: string; title: string; expected: string; actual: string; quote: string; owner: string; severity: "blocker" | "review" };
export type Fields = Record<string, { value: string; quote: string }>;
export type Event = { at: string; actor: string; title: string; detail: string; run?: string };
export type Plan = { summary: string; invoiceDraft: string; carrierDraft: string; earliestDate: string; assumption: string; documentVersions?:string };
export type ReplyAssessment = { facts: string[]; assumptions: string[]; unconfirmed: string[]; nextHumanAction: string };
import type { Correspondence, Statement, RecoveryPlan, PlanHistory, PlanningFailure, Sender } from './recovery';
import type { LcAssessment, LcAssessmentAudit, LcRequirements } from './lc-updates';
import type { ExtractionRecord } from './source-grounding';
import type { Clock } from './clock.ts';
export type Case = { id: string; revision: number; mode: Mode; status: "new"|"approval"|"waiting"|"received"|"reviewed"|"stopped"; asOf: string; docs: Doc[]; history: Doc[]; fields: Partial<Record<Kind, Fields>>; extractionHistory?:ExtractionRecord[]; planningFailures?:PlanningFailure[]; findings: Finding[]; events: Event[]; deadline?: string; plan?: Plan; approval?: { revision: number; documentVersions: string; at: string; planId?:string }; replyAssessment?: ReplyAssessment; correspondence?:Correspondence[]; statements?:Statement[]; priorAssessments?:{at:string; statements:Statement[]}[]; recoveryPlan?:RecoveryPlan; planHistory?:PlanHistory[]; pendingLcAssessment?:LcAssessment; lcAssessmentHistory?:LcAssessmentAudit[]; lcUpdateRequirements?:LcRequirements; evidence: { neatlogs: string; entire: string; checkpoint: string; business: string }; modelRuns: number; modelAttempts?:number; usage: { input: number; output: number; missing:number }; createdAt: string };
export const labels: Record<Kind,string> = { lc: "Letter of credit", invoice: "Commercial invoice", bl: "Bill of lading" };
export const required: Record<Kind,string[]> = { lc: ["reference","currency","max_amount","consignee","latest_shipment","expiry","presentation_days"], invoice: ["reference","lc_reference","currency","amount"], bl: ["reference","lc_reference","consignee","shipment_date"] };
export class CaseError extends Error { status:number; constructor(message: string, status = 400) { super(message); this.status=status; } }
export function dateOK(s: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s+"T00:00:00Z")) && new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s; }
export function plusDays(s: string, days: number): string { const d=new Date(s+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10); }
export function documentVersions(c: Case): string { return c.docs.map(d=>`${d.kind}:${d.version}:${d.text}`).join("\n"); }
export function record(c: Case, actor: string, title: string, detail: string, run?: string) { c.events.push({at:new Date().toISOString(),actor,title,detail,...(run?{run}:{})}); }
export function fixtureDocs(): Doc[] { return [
 {kind:"lc",name:"LC-2026-1042.txt",version:1,synthetic:true,text:"SYNTHETIC DEMO — not a bank instrument\nreference: LC-2026-1042\ncurrency: USD\nmax_amount: 50000\nconsignee: TO ORDER OF MERIDIAN BANK\nlatest_shipment: 2026-10-09\nexpiry: 2026-10-12\npresentation_days: 21"},
 {kind:"invoice",name:"INV-1042-v1.txt",version:1,synthetic:true,text:"SYNTHETIC DEMO — beneficiary invoice\nreference: INV-1042\nlc_reference: LC-2026-1042\ncurrency: EUR\namount: 48000"},
 {kind:"bl",name:"BL-1042-v1.txt",version:1,synthetic:true,text:"SYNTHETIC DEMO — carrier-issued document\nreference: BL-1042\nlc_reference: LC-2026-1042\nconsignee: NORTHSTAR TRADING LTD\nshipment_date: 2026-10-08"}
 ]; }
export function newCase(mode: Mode, docs: Doc[], asOf: string): Case {
 if (!dateOK(asOf)) throw new CaseError("Choose a valid case date.");
 if (docs.length!==3 || new Set(docs.map(d=>d.kind)).size!==3 || docs.some(d=>!required[d.kind] || !d.text.trim() || d.text.length>16000)) throw new CaseError("Provide one LC, one invoice and one bill of lading, each up to 16,000 characters.");
 return {id:crypto.randomUUID(),revision:0,mode,status:"new",asOf,docs,history:structuredClone(docs),fields:{},findings:[],events:[{at:new Date().toISOString(),actor:"Desk",title:"Case opened",detail:mode==="demo"?"Synthetic documents. Deterministic rehearsal; no model calls.":"Text documents will be sent to the configured model and neatlogs."}],evidence:{neatlogs:"",entire:"",checkpoint:"",business:""},modelRuns:0,usage:{input:0,output:0,missing:0},createdAt:new Date().toISOString()};
}
export function parseFixture(doc: Doc): Fields {
 const out: Fields={};for(const line of doc.text.split(/\r?\n/)){const m=line.match(/^([a-z_]+):\s*(.+)$/);if(m && required[doc.kind].includes(m[1])) out[m[1]]={value:m[2].trim(),quote:line};}return out;
}
export function groundedFields(doc: Doc, raw: unknown): Fields {
 if(!raw || typeof raw!=="object" || Array.isArray(raw)) throw new CaseError("Worker returned invalid fields.",502);
 const out: Fields={};for(const key of required[doc.kind]){
  const item=(raw as Record<string,unknown>)[key];if(item===null || item===undefined) continue;
  if(typeof item!=="object" || !("value" in item) || !("quote" in item)) throw new CaseError(`Ungrounded extraction: ${key}`,502);
  const {value,quote}=item as {value:unknown;quote:unknown};
  if(typeof value!=="string" || typeof quote!=="string" || !value.trim() || !quote.trim() || !doc.text.includes(quote) || !quote.toLowerCase().includes(value.toLowerCase())) throw new CaseError(`Source evidence does not support ${key}.`,502);
  out[key]={value:value.trim(),quote};
 }return out;
}
export function validate(c: Case): Finding[] {
 const findings: Finding[]=[];const v=(k:Kind,f:string)=>c.fields[k]?.[f]?.value || "";
 const add=(doc:Kind,field:string,title:string,expected:string,actual:string,severity:"blocker"|"review"="blocker")=>findings.push({id:`${doc}.${field}`,doc,field,title,expected,actual,quote:c.fields[doc]?.[field]?.quote || "No supported source value",owner:doc==="bl"?"Carrier":doc==="invoice"?"Exporter":"Trade specialist",severity});
 for(const k of ["lc","invoice","bl"] as Kind[])for(const f of required[k])if(!v(k,f))add(k,f,"Missing source evidence",`A supported ${f} value`,"Missing","review");
 for(const [k,f] of [["lc","latest_shipment"],["lc","expiry"],["bl","shipment_date"]] as [Kind,string][])if(v(k,f)&&!dateOK(v(k,f)))add(k,f,"Invalid date", "YYYY-MM-DD calendar date",v(k,f),"review");
 for(const [k,f] of [["lc","max_amount"],["invoice","amount"],["lc","presentation_days"]] as [Kind,string][])if(v(k,f)&&(!/^\d+(\.\d+)?$/.test(v(k,f))||Number(v(k,f))<=0))add(k,f,"Invalid numeric term","A positive numeric value",v(k,f),"review");
 const days=Number(v("lc","presentation_days"));if(v("lc","presentation_days")&&(!Number.isInteger(days)||days>365))add("lc","presentation_days","Unsupported presentation period","Integer from 1 to 365",v("lc","presentation_days"),"review");
 for(const k of ["invoice","bl"] as Kind[])if(v(k,"lc_reference")&&v("lc","reference")&&v(k,"lc_reference")!==v("lc","reference"))add(k,"lc_reference","LC reference conflicts",v("lc","reference"),v(k,"lc_reference"));
 if(v("invoice","currency")&&v("lc","currency")&&v("invoice","currency").toUpperCase()!==v("lc","currency").toUpperCase())add("invoice","currency","Invoice currency conflicts",v("lc","currency"),v("invoice","currency"));
 if(Number(v("invoice","amount"))>Number(v("lc","max_amount")))add("invoice","amount","Invoice exceeds stated ceiling",v("lc","max_amount"),v("invoice","amount"),"review");
 // Only an explicit consignee instruction is compared; this is not general UCP name matching.
 if(v("bl","consignee")&&v("lc","consignee")&&v("bl","consignee").toUpperCase().replace(/\s+/g," ")!==v("lc","consignee").toUpperCase().replace(/\s+/g," "))add("bl","consignee","Consignee conflicts with explicit LC instruction",v("lc","consignee"),v("bl","consignee"));
 if(dateOK(v("bl","shipment_date"))&&dateOK(v("lc","latest_shipment"))&&v("bl","shipment_date")>v("lc","latest_shipment"))add("bl","shipment_date","Shipment after stated latest date",v("lc","latest_shipment"),v("bl","shipment_date"));
 c.deadline=undefined;if(dateOK(v("bl","shipment_date"))&&dateOK(v("lc","expiry"))&&Number.isInteger(days)&&days>0&&days<=365){c.deadline=[plusDays(v("bl","shipment_date"),days),v("lc","expiry")].sort()[0];if(c.asOf>c.deadline)add("lc","expiry","Calculated presentation deadline passed",c.deadline,c.asOf);}return findings;
}
export function basePlan(c:Case): Plan {return {summary:"Request an exporter-issued invoice correction and a carrier-issued B/L reissue. Keep originals and verify each received version.",invoiceDraft:`Draft to exporter: please review ${c.docs.find(d=>d.kind==="invoice")?.name}. ${c.findings.filter(f=>f.doc==="invoice").map(f=>`${f.field}: source says ${f.actual}; LC requires ${f.expected}.`).join(" ")} Provide a new issued version.`,carrierDraft:`Draft to carrier: please review ${c.docs.find(d=>d.kind==="bl")?.name}. ${c.findings.filter(f=>f.doc==="bl").map(f=>`${f.field}: source says ${f.actual}; explicit LC instruction is ${f.expected}.`).join(" ")} Confirm earliest reissue availability. No message has been sent.`,earliestDate:plusDays(c.asOf,1),assumption:"Next-day turnaround assumption, not a carrier commitment. Bank closures and presentation location are not evaluated."};}
export function lcFollowUpBlocked(c:Case):boolean {return !!(c.lcUpdateRequirements&&(c.lcUpdateRequirements.documentVersions!==documentVersions(c)||c.lcUpdateRequirements.timingConfirmationRequired||c.lcUpdateRequirements.outsideCoverageUnresolved||c.lcUpdateRequirements.specialistReviewRequired||c.lcUpdateRequirements.draftingRequired));}
export function finishInvestigation(c:Case) {
 if(c.pendingLcAssessment)throw new CaseError("Select or dismiss the pending LC assessment before investigation.");
 c.findings=validate(c);
 if(c.lcUpdateRequirements&&c.lcUpdateRequirements.documentVersions===documentVersions(c)&&!c.findings.length)c.lcUpdateRequirements.timingConfirmationRequired=false;
 if(lcFollowUpBlocked(c)){
  c.status="stopped";c.approval=undefined;
  if(c.findings.length&&!c.findings.some(f=>f.severity==="review"||["expiry","shipment_date","lc_reference"].includes(f.field)))c.plan={...basePlan(c),documentVersions:documentVersions(c)};
  record(c,"Verifier","LC basis follow-up required","Current timing or specialist review remains unresolved after LC selection.");
 }else if(c.findings.length===0){c.status="reviewed";record(c,"Verifier","Covered checks passed","Only implemented checks passed. Full bank examination remains required.");}
 else if(c.findings.some(f=>f.severity==="review" || ["expiry","shipment_date","lc_reference"].includes(f.field))){c.status="stopped";record(c,"Verifier","Specialist review required","Missing evidence, deadline, numeric or reference issue exceeds the supported correction path.");}
 else {c.status="approval";c.plan=basePlan(c);record(c,"Remedy planner","Correction plan ready",`${c.findings.length} issue(s). Human approval required before opening correction requests.`);}
}
export type Action = {type:"investigate"|"approve"|"reply"|"recheck"|"evidence"|"correspondence"|"reassess"; revision:number; reply?:"available"|"delayed"|"waiver"; docs?:Doc[]; evidence?:Case["evidence"]; sender?:Sender; text?:string};
export function replyEvidence(c:Case,a:Action) {
 return {replyScenario:a.reply,resultingStatus:c.status,calculatedDeadline:c.deadline??null,earliestAvailability:c.plan?.earliestDate??null,invoiceVersion:c.docs.find(d=>d.kind==="invoice")!.version,blVersion:c.docs.find(d=>d.kind==="bl")!.version,documentsReceived:c.status==="received"};
}
/** Code-controlled receipt facts and unverified flags. The coordinator may not
 * infer a schedule, authenticity, amendment acceptance or bank approval. */
export function replyCoordinatorFields(c:Case,a:Action) {
 return {...replyEvidence(c,a),timelineBasis:"assumption",carrierCommitment:"unconfirmed",issuerAuthenticity:"unconfirmed",bankAcceptance:"unconfirmed",nextHumanAction:c.status==="received"?"recheck":"specialist_review"};
}
export function validateReplyAssessment(c:Case,a:Action,raw:unknown):ReplyAssessment {
 if(a.type!=="reply" || !a.reply || !c.plan || !raw || typeof raw!=="object" || Array.isArray(raw))throw new CaseError("Coordinator output invalid.",502);
 const expected=replyCoordinatorFields(c,a);
 const output=raw as Record<string,unknown>;
 const mismatches=Object.entries(expected).filter(([key,value])=>output[key]!==value).map(([key])=>key);
 const extraFields=Object.keys(output).filter(key=>!Object.hasOwn(expected,key)).length;
 if(mismatches.length||extraFields)throw new CaseError(`Coordinator claims do not match case evidence or mark assumptions and unconfirmed commitments correctly. Mismatched or missing fields: ${mismatches.join(', ')||'none'}. Unsupported extra fields: ${extraFields}.`,502);
 const facts=[`Simulated ${a.reply} reply scenario recorded.`,`Calculated presentation deadline from supported document fields: ${c.deadline??"not established"}.`];
 if(c.status==="received")facts.push(`User-uploaded invoice v${expected.invoiceVersion} and B/L v${expected.blVersion} are retained for recheck; issuer authenticity is not established.`);
 return {facts,assumptions:[`Earliest availability ${c.plan.earliestDate} is a planning assumption, not a scheduled carrier timeline.`],unconfirmed:["No verified carrier commitment or processing schedule is supplied.","Issuer authenticity and issuing-bank acceptance remain unconfirmed."],nextHumanAction:c.status==="received"?"Recheck the revised documents, then arrange full trade and bank presentation review.":a.reply==="waiver"?"Ask a trade specialist and issuing bank to review the waiver before proceeding.":"Escalate timing to a trade specialist and confirm the carrier's actual availability before proceeding."};
}
/* `now` defaults to the real clock; the Worker passes lib/runtime.ts clock(). Kept inline so this
   module retains no runtime imports (tests/lc-updates.test.mjs guards that boundary). */
export function transition(c:Case,a:Action,now:Clock=()=>new Date()): Case {
 if(a.revision!==c.revision)throw new CaseError("Case changed. Refresh before continuing.",409);const n=structuredClone(c);
 if((a.type==="approve"||a.type==="reply")&&(n.pendingLcAssessment||lcFollowUpBlocked(n)))throw new CaseError("Select or dismiss the pending LC assessment and complete LC basis follow-up before authorizing corrections.");
 if((a.type==="approve"||a.type==="reply")&&n.plan?.documentVersions&&n.plan.documentVersions!==documentVersions(n))throw new CaseError("A plan matching the current document versions is required.");
 if(a.type==="approve"){
  if(n.status!=="approval" || !n.plan)throw new CaseError("A reviewed correction plan is required.");n.approval={revision:n.revision,documentVersions:documentVersions(n),at:new Date().toISOString(),...(n.recoveryPlan?{planId:n.recoveryPlan.id}:{})};n.status="waiting";record(n,"Human reviewer","Correction requests approved","Approval binds these document versions and the current recovery plan. Requests recorded internally; no external messages sent.");
 }else if(a.type==="reply"){
  if(n.status!=="waiting"||!n.approval||n.approval.documentVersions!==documentVersions(n)||n.recoveryPlan&&n.approval.planId!==n.recoveryPlan.id)throw new CaseError("An approval matching current documents and plan is required.");
  if(!["available","delayed","waiver"].includes(a.reply||""))throw new CaseError("Choose a reply scenario.");
  if(a.reply==="waiver"){n.status="stopped";record(n,"Counterparty coordinator","Buyer waiver is insufficient","Simulated reply. A buyer waiver is not issuing-bank acceptance; escalate for specialist and bank review.");}
  else if(a.reply==="delayed"){n.plan!.earliestDate=plusDays(n.asOf,6);n.status="stopped";record(n,"Counterparty coordinator","Delay invalidates the plan",`Simulated delay scenario assumes earliest reissue availability on ${n.plan!.earliestDate}; no carrier commitment verified. ${n.deadline&&n.plan!.earliestDate>n.deadline?`Beyond calculated ${n.deadline} deadline.`:"Specialist timing reassessment required."} Pack remains unresolved.`);}
  else if(n.deadline&&(n.plan!.earliestDate>n.deadline || n.mode==="live"&&now().toISOString().slice(0,10)>n.deadline)){n.status="stopped";record(n,"Verifier","Turnaround exceeds deadline","Escalate before requesting revisions.");}
  else if(n.mode==="demo"){
   n.docs=n.docs.map(d=>{if(d.kind==="lc")return d;let text=d.text;for(const f of n.findings.filter(f=>f.doc===d.kind))text=text.replace(new RegExp(`^${f.field}:.*$`,"m"),`${f.field}: ${f.expected}`);return {...d,text,version:d.version+1,name:d.name.replace(/v\d+/,`v${d.version+1}`),synthetic:true};});n.history.push(...n.docs.filter(d=>d.kind!=="lc").map(d=>structuredClone(d)));n.status="received";record(n,"Counterparty coordinator","Synthetic revised documents received","Fixture invoice and B/L version 2. Recheck required.");
  }else{
   if(!a.docs||a.docs.length!==2||new Set(a.docs.map(d=>d.kind)).size!==2||a.docs.some(d=>!['invoice','bl'].includes(d.kind)||!d.text.trim()||d.text.length>16000))throw new CaseError("Upload both revised text-native invoice and B/L.");n.docs=n.docs.map(d=>{const r=a.docs!.find(r=>r.kind===d.kind);return r?{...r,version:d.version+1,synthetic:false}:d;});n.history.push(...n.docs.filter(d=>d.kind!=="lc").map(d=>structuredClone(d)));n.status="received";record(n,"Counterparty coordinator","Revised documents uploaded","User-provided documents. Issuer authenticity unverified. Recheck required.");
  }
  if(n.status==="received"&&n.lcUpdateRequirements){
   if(n.recoveryPlan)n.planHistory=[...(n.planHistory||[]),{plan:structuredClone(n.recoveryPlan),approval:structuredClone(n.approval),at:new Date().toISOString()}];
   if(n.statements?.length)n.priorAssessments=[...(n.priorAssessments||[]),{at:new Date().toISOString(),statements:structuredClone(n.statements)}];
   n.recoveryPlan=undefined;n.approval=undefined;n.statements=[];
   n.lcUpdateRequirements.documentVersions=documentVersions(n);n.lcUpdateRequirements.timingConfirmationRequired=true;
  }
 }else if(a.type==="evidence"){
  if(!a.evidence)throw new CaseError("Evidence fields required.");for(const key of ["neatlogs","entire","business"] as const){const u=a.evidence[key];if(typeof u!=="string" || u && (!/^https:\/\//.test(u)||u.length>1000))throw new CaseError("Use HTTPS evidence links under 1,000 characters.");}if(typeof a.evidence.checkpoint!=="string"||a.evidence.checkpoint.length>200)throw new CaseError("Checkpoint ID is too long.");n.evidence={...a.evidence};record(n,"Team","Sponsor evidence saved","User-supplied links; accessibility and contents need manual verification.");
 }else throw new CaseError("Action requires investigation orchestration.");n.revision++;return n;
}
