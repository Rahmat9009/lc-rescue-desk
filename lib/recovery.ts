import { CaseError, dateOK, documentVersions, plusDays, record } from './domain.ts';
import type { Case } from './domain.ts';

export type Sender = 'exporter' | 'carrier' | 'other';
export type Correspondence = { id:string; sender:Sender; text:string; receivedOn:string; sourceVersions:string; label:'User-provided correspondence · authenticity unverified' };
export type Statement = { id:string; correspondenceId:string; sender:Sender; category:'commitment'|'assumption'; target:'invoice'|'bl'|null; quote:string; date:string|null };
export type Extraction = { statements:Statement[]; missing:string[] };
export type RecoveryAction = { id:string; kind:'request_invoice'|'request_bl'|'human_escalation'|'clarify_timing'|'recheck'; owner:string; dueDate:string|null; dependsOn:string[]; evidenceRefs:string[] };
export type RecoveryPlan = { id:string; createdAt:string; documentVersions:string; correspondenceIds:string[]; deadline:string|null; actions:RecoveryAction[]; nextAction:string; reason:string; evidenceRefs:string[]; unresolved:string[]; timing:'feasible'|'conflict'|'unknown'; approvalRequired:boolean };
export type PlanHistory = { plan:RecoveryPlan | NonNullable<Case['plan']>; approval?:Case['approval']; at:string };
export function versionKey(c:Case):string{return c.docs.map(d=>`${d.kind}:v${d.version}`).join('|');}

const actionKinds = new Set<RecoveryAction['kind']>(['request_invoice','request_bl','human_escalation','clarify_timing','recheck']);
function quotedDate(quote:string, receivedOn:string):string|null {
 const dates=[...quote.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(m=>m[0]);
 const relatives=[...quote.matchAll(/\bin\s+(\d{1,2}|one|two|three|four|five|six|seven)\s+days?\b/gi)];
 const tomorrows=[...quote.matchAll(/\btomorrow\b/gi)];
 if(dates.length+relatives.length+tomorrows.length!==1)return null;
 if(dates.length)return dateOK(dates[0])?dates[0]:null;
 if(/\btomorrow\b/i.test(quote))return plusDays(receivedOn,1);
 const relative=relatives[0];
 if(relative){const words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7};return plusDays(receivedOn,words[relative[1].toLowerCase()]??Number(relative[1]));}
 return null;
}
function quoteCategory(quote:string):Statement['category']|null {
 if(/\b(will|can)\s+not\b|\bwon't\b|\bcan't\b/i.test(quote))return null;
 if(/\b(expect|estimate|probably|perhaps|may|might|hope|should)\b/i.test(quote))return 'assumption';
 if(/\b(will|can|commit|ready|available)\b/i.test(quote))return 'commitment';
 return null;
}
function targetFor(sender:Sender, quote:string):Statement['target'] {
 if(/\b(bank|waiver|extension|accepted|presented)\b/i.test(quote)||! /\b(send|issue|reissue|correct|ready|available|deliver|provide)\b/i.test(quote))return null;
 if(sender==='exporter'&&/\b(invoice|corrected document|correction)\b/i.test(quote))return 'invoice';
 if(sender==='carrier'&&/\b(b\/l|bill of lading|corrected document|reissue|correction)\b/i.test(quote))return 'bl';
 return null;
}
function sourceSentences(text:string):string[] {
 return text.split(/\r?\n/).flatMap(line=>line.match(/[^.!?]+(?:[.!?]+(?=\s|$))?/g)||[]).map(sentence=>sentence.trim()).filter(Boolean);
}
function completeQuote(text:string, quote:string):string {
 const matches=[...new Set(sourceSentences(text).filter(sentence=>sentence.includes(quote)))];
 if(matches.length>1)throw new CaseError('Correspondence quote matches multiple statements; timing is ambiguous.',502);
 return matches[0]||quote;
}
export function validateExtraction(c:Case, correspondence:Correspondence, raw:unknown):Extraction {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new CaseError('Coordinator extraction is invalid.',502);
 const data=raw as Record<string,unknown>;
 if(Object.keys(data).length!==1||!Array.isArray(data.quotes)||data.quotes.length>12||data.quotes.some(q=>typeof q!=='string'||!q.trim()||q.length>1000))throw new CaseError('Coordinator quotes are invalid or include unsupported claims.',502);
 const completeQuotes:string[]=(data.quotes as string[]).map(quote=>{
  if(!correspondence.text.includes(quote))throw new CaseError('Correspondence claim lacks an exact supporting quote.',502);
  return completeQuote(correspondence.text,quote);
 });
 // A provider may select an incomplete excerpt or omit an explicit dated sentence.
 // Recover only complete, unambiguous source sentences that code can parse.
 for(const sentence of sourceSentences(correspondence.text))if(quotedDate(sentence,correspondence.receivedOn)&&quoteCategory(sentence)&&targetFor(correspondence.sender,sentence)&&!completeQuotes.includes(sentence))completeQuotes.push(sentence);
 const statements:Statement[]=[];
 for(const quote of completeQuotes){
  const category=quoteCategory(quote),target=targetFor(correspondence.sender,quote);
  if(!category||!target)throw new CaseError('Correspondence quote does not support a correction statement from this sender.',502);
  if(statements.some(s=>s.quote===quote))continue;
  statements.push({id:`${correspondence.id}:s${statements.length+1}`,correspondenceId:correspondence.id,sender:correspondence.sender,category,target,quote,date:quotedDate(quote,correspondence.receivedOn)});
 }
 const targets=new Set([...(c.statements||[]).filter(s=>c.correspondence?.find(r=>r.id===s.correspondenceId)?.sourceVersions===correspondence.sourceVersions),...statements].filter(s=>s.date).map(s=>s.target));
 const missing=[...new Set(c.findings.filter(f=>f.doc==='invoice'||f.doc==='bl').map(f=>f.doc))].filter(k=>!targets.has(k==='invoice'?'invoice':'bl')).map(k=>`No supported ${k==='invoice'?'exporter invoice':'carrier B/L'} availability date.`);
 if(!c.deadline)missing.push('Presentation deadline is not established from the saved documents.');
 return {statements,missing};
}
export function demoQuotes(text:string):{quotes:string[]} {
 return {quotes:text.split(/\r?\n/).map(line=>line.trim()).filter(line=>quoteCategory(line)&&/\b(invoice|corrected document|correction|b\/l|bill of lading|reissue)\b/i.test(line))};
}
export function validateRecoveryPlan(c:Case, candidate:unknown, statements:Statement[]):RecoveryPlan {
 if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))throw new CaseError('Remedy plan is invalid.',502);
 const raw=candidate as Record<string,unknown>;
 if(!Array.isArray(raw.actions)||raw.actions.length<1||raw.actions.length>8)throw new CaseError('Remedy actions are invalid.',502);
 const current=statements.filter(s=>c.correspondence?.find(r=>r.id===s.correspondenceId)?.sourceVersions===versionKey(c));
 const refs=new Set([...c.findings.map(f=>`finding:${f.id}`),...current.map(s=>`statement:${s.id}`),...(c.deadline?['deadline']:[])]);
 const actions:RecoveryAction[]=raw.actions.map((value:unknown)=>{
  if(!value||typeof value!=='object')throw new CaseError('Remedy action is invalid.',502);
  const a=value as Record<string,unknown>;
  if(typeof a.id!=='string'||!/^a[1-8]$/.test(a.id)||!actionKinds.has(a.kind as RecoveryAction['kind'])||typeof a.owner!=='string'||!a.owner.trim()||a.owner.length>80||!(a.dueDate===null||typeof a.dueDate==='string'&&dateOK(a.dueDate))||!Array.isArray(a.dependsOn)||!Array.isArray(a.evidenceRefs)||a.evidenceRefs.length===0||a.dependsOn.some(x=>typeof x!=='string')||a.evidenceRefs.some(x=>typeof x!=='string'||!refs.has(x)))throw new CaseError('Remedy action has an unsupported date or evidence reference.',502);
  if(a.kind==='request_invoice'&&a.owner!=='Exporter'||a.kind==='request_bl'&&a.owner!=='Carrier')throw new CaseError('Correction request owner conflicts with the saved case.',502);
  return a as RecoveryAction;
 });
 const ids=new Set(actions.map(a=>a.id));if(ids.size!==actions.length)throw new CaseError('Duplicate remedy action.',502);
 for(let i=0;i<actions.length;i++)for(const dep of actions[i].dependsOn){if(!ids.has(dep)||actions.findIndex(a=>a.id===dep)>=i)throw new CaseError('Remedy action dependency is missing or out of order.',502);}
 for(const a of actions){if(a.dueDate){const supported=current.some(s=>s.date===a.dueDate&&s.category==='commitment'&&s.target===(a.kind==='request_invoice'?'invoice':a.kind==='request_bl'?'bl':s.target)&&a.evidenceRefs.includes(`statement:${s.id}`));if(!supported)throw new CaseError('Remedy date is unsupported by the cited correspondence.',502);}if((a.kind==='request_invoice'||a.kind==='request_bl')&&!a.dueDate)throw new CaseError('Correction request lacks a supported date.',502);}
 const relevant=current.filter(s=>s.category==='commitment'&&s.date&&c.findings.some(f=>f.doc===s.target));
 const late=c.deadline?relevant.filter(s=>s.date!>c.deadline!).sort((a,b)=>a.date!.localeCompare(b.date!)):[];
 const latest=late.at(-1);
 const missingTargets=[...new Set(c.findings.filter(f=>f.doc==='invoice'||f.doc==='bl').map(f=>f.doc))].filter(k=>!relevant.some(s=>s.target===k));
 const deadlineEdge=!!(c.deadline&&relevant.some(s=>s.date===c.deadline));
 const timing:RecoveryPlan['timing']=latest?'conflict':!c.deadline||missingTargets.length||deadlineEdge?'unknown':'feasible';
 if(timing==='conflict'||timing==='unknown'){
  if(!actions.some(a=>a.kind==='human_escalation')||!actions.some(a=>a.kind==='clarify_timing')||actions.some(a=>a.kind==='request_invoice'||a.kind==='request_bl'))throw new CaseError('Recovery plan conflicts with unresolved timing.',502);
 }else for(const kind of ['invoice','bl'] as const)if(c.findings.some(f=>f.doc===kind)&&!actions.some(a=>a.kind===(kind==='invoice'?'request_invoice':'request_bl')))throw new CaseError('Recovery plan omits a required correction request.',502);
 const unresolved=[...missingTargets.map(k=>`No explicit ${k==='invoice'?'exporter invoice':'carrier B/L'} commitment with a date.`),'Correspondence authenticity and actual issuance remain unverified.','Bank extension, waiver, issuer confirmation, and successful presentation are unconfirmed.'];
 if(deadlineEdge)unresolved.unshift('Availability on the presentation deadline does not establish time for document verification and presentation.');
 let nextAction:string,reason:string,evidenceRefs:string[];
 if(timing==='conflict'){
  nextAction='Escalate to a trade specialist and clarify the carrier timeline and presentation options with the relevant parties.';
  reason=`The cited ${latest!.sender==='carrier'?'carrier B/L':'exporter invoice'} correction availability ${latest!.date} falls after the saved presentation deadline ${c.deadline}.`;
  evidenceRefs=['deadline',`statement:${latest!.id}`];
 }else if(timing==='unknown'){
  nextAction='Clarify missing correction dates and obtain specialist timing review before relying on this plan.';
  reason='The saved evidence does not establish a complete correction timeline against the presentation deadline.';
  evidenceRefs=[...relevant.map(s=>`statement:${s.id}`),...(c.deadline?['deadline']:[])];
 }else{
  nextAction='Review the updated correction requests for human approval before contacting the issuers.';
  reason=`Explicit quoted availability dates are on or before the saved ${c.deadline} deadline; issuance and presentation remain unverified.`;
  evidenceRefs=['deadline',...relevant.map(s=>`statement:${s.id}`)];
 }
 const correctionActions=actions.some(a=>a.kind==='request_invoice'||a.kind==='request_bl');
 return {id:crypto.randomUUID(),createdAt:new Date().toISOString(),documentVersions:documentVersions(c),correspondenceIds:(c.correspondence||[]).map(r=>r.id),deadline:c.deadline??null,actions,nextAction,reason,evidenceRefs,unresolved,timing,approvalRequired:correctionActions};
}
export function defaultCandidate(c:Case, statements:Statement[]):{actions:RecoveryAction[]} {
 const actions:RecoveryAction[]=[];const add=(kind:RecoveryAction['kind'],owner:string,dueDate:string|null,evidenceRefs:string[],dependsOn:string[]=[])=>actions.push({id:`a${actions.length+1}`,kind,owner,dueDate,dependsOn,evidenceRefs});
 const relevant=statements.filter(s=>s.category==='commitment'&&s.date&&c.findings.some(f=>f.doc===s.target));
 const timingUnresolved=!!(c.deadline&&relevant.some(s=>s.date!>=c.deadline!));
 if(timingUnresolved||!c.deadline||new Set(c.findings.filter(f=>f.doc==='invoice'||f.doc==='bl').map(f=>f.doc)).size>new Set(relevant.map(s=>s.target)).size){const refs=[...(c.deadline?['deadline']:[]),...statements.map(s=>`statement:${s.id}`),...c.findings.map(f=>`finding:${f.id}`)];add('human_escalation','Trade specialist',null,refs);add('clarify_timing','Human coordinator',null,refs,['a1']);}
 else{for(const kind of ['invoice','bl'] as const){if(!c.findings.some(f=>f.doc===kind))continue;const s=relevant.filter(s=>s.target===kind).at(-1)!;add(kind==='invoice'?'request_invoice':'request_bl',kind==='invoice'?'Exporter':'Carrier',s.date,[`statement:${s.id}`,...c.findings.filter(f=>f.doc===kind).map(f=>`finding:${f.id}`)]);}add('recheck','Desk',null,c.findings.map(f=>`finding:${f.id}`),actions.map(a=>a.id));}
 return {actions};
}
export function newCorrespondence(c:Case,sender:Sender,text:string):Correspondence {
 if(!['approval','waiting','stopped'].includes(c.status)||!c.plan)throw new CaseError('Investigate a correction case before adding correspondence.');
 if(!['exporter','carrier','other'].includes(sender)||!text.trim()||text.length>8000)throw new CaseError('Provide a sender and up to 8,000 characters of correspondence.');
 return {id:crypto.randomUUID(),sender,text:text.trim(),receivedOn:c.mode==='demo'?c.asOf:new Date().toISOString().slice(0,10),sourceVersions:versionKey(c),label:'User-provided correspondence · authenticity unverified'};
}
export function applyCorrespondence(c:Case,receipt:Correspondence,extraction:Extraction,candidate:unknown):Case {
 const n=structuredClone(c);
 n.correspondence=[...(n.correspondence||[]),receipt];n.statements=[...(n.statements||[]),...extraction.statements];
 const prior=n.recoveryPlan||n.plan!;
 const plan=validateRecoveryPlan(n,candidate,n.statements);
 n.planHistory=[...(n.planHistory||[]),{plan:structuredClone(prior),approval:n.approval?structuredClone(n.approval):undefined,at:new Date().toISOString()}];
 n.recoveryPlan=plan;n.approval=undefined;n.status=plan.timing==='feasible'&&plan.approvalRequired?'approval':'stopped';
 record(n,'Counterparty coordinator','User-provided correspondence assessed',`${receipt.sender} · authenticity unverified · ${extraction.statements.length} supported quote(s). ${extraction.missing.join(' ')}`);
 record(n,'Remedy planner','Recovery plan updated',`${plan.timing}: ${plan.reason} Fresh human approval required for changed correction requests. No external messages sent.`);
 n.revision++;return n;
}
export function reassessSavedCorrespondence(c:Case):Case {
 if(!c.plan||!c.correspondence?.length||!['approval','waiting','stopped'].includes(c.status))throw new CaseError('A saved correction case with correspondence is required.');
 const n=structuredClone(c),at=new Date().toISOString(),priorStatements=structuredClone(n.statements||[]);
 const currentReceipts=(n.correspondence||[]).filter(r=>r.sourceVersions===versionKey(n));
 if(!currentReceipts.length)throw new CaseError('Saved correspondence belongs to earlier document versions.');
 const repaired=currentReceipts.flatMap(receipt=>validateExtraction(n,receipt,{quotes:priorStatements.filter(s=>s.correspondenceId===receipt.id).map(s=>s.quote)}).statements);
 n.priorAssessments=[...(n.priorAssessments||[]),{at,statements:priorStatements}];
 n.statements=[...priorStatements.filter(s=>!currentReceipts.some(r=>r.id===s.correspondenceId)),...repaired];
 const prior=n.recoveryPlan||n.plan!;
 const candidate=defaultCandidate(n,repaired);
 const plan=validateRecoveryPlan(n,candidate,repaired);
 n.planHistory=[...(n.planHistory||[]),{plan:structuredClone(prior),approval:n.approval?structuredClone(n.approval):undefined,at}];
 n.recoveryPlan=plan;n.approval=undefined;n.status=plan.timing==='feasible'&&plan.approvalRequired?'approval':'stopped';
 record(n,'Verifier','Saved correspondence reassessed',`Original user-provided text rechecked without model calls. ${repaired.length} complete supported quote(s). Authenticity remains unverified.`);
 record(n,'Remedy planner','Recovery plan updated',`${plan.timing}: ${plan.reason} Earlier assessment and plan retained in history. No external messages sent.`);
 n.revision++;return n;
}
