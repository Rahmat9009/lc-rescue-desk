'use client';
/*
 * "Assess a revised LC" — Phase 3 frontend for the API contract in docs/lc-updates-phase2.md.
 *
 * Binding tokens are copied verbatim from the server's `lcAssessmentRequest` and spread back
 * into select/dismiss requests. Nothing here recomputes a fingerprint, serialization or digest.
 * Selection commits an analysis basis only: never amendment acceptance, authenticity or bank
 * approval. Both complete source texts are reachable, because highlighted quotations cannot
 * substitute for reviewing the whole proposed basis.
 */
import { useState } from 'react';
import { ChevronDown,TriangleAlert,Upload } from 'lucide-react';
import type { Case,Finding,Kind } from '../lib/domain';
import { labels } from '../lib/domain';

type Req={revision:number;assessmentId:string;assessmentBinding:string;baseBinding:string;candidateBinding:string};
type Assessment=NonNullable<Case['pendingLcAssessment']>;
type Props={
 c:Case; req:Req|null; followUp:string[]; busy:string; error:string;
 freshNeeded:string[]|null; staleNotice:string;
 onStage:(candidate:{name:string;text:string},note:string)=>void;
 onSelect:(note:string)=>void;
 onDismiss:()=>void;
 onDismissError:()=>void;
};
const LIMIT_TEXT=16000,LIMIT_NAME=120,LIMIT_NOTE=1000;
const fmtFollowUp:Record<string,string>={
 select_or_dismiss_assessment:'Select or dismiss the pending assessment',
 confirm_current_timing:'Confirm current timing with fresh correspondence',
 draft_correction_requests:'Draft correction requests',
 retry_drafting:'Retry drafting — timing and basis survived a drafting failure',
 fresh_request_approval:'Fresh approval of the correction requests',
 review_outside_coverage:'Review changes outside covered checks',
 specialist_review:'Trade specialist review',
 full_presentation_review:'Full specialist and bank presentation review',
};

/* Evidence.source is the canonical serialized document binding, not a display name.
   Read the name out of it defensively and never render the raw binding. */
type Ev={source:string;version:number;value:string;quote:string};
function sourceName(source:string):string|null{
 try{const o=JSON.parse(source) as {name?:unknown};return typeof o?.name==='string'?o.name:null;}catch{return null;}
}
function evLabel(e:Ev):string{const n=sourceName(e.source);return n?`${n} v${e.version}`:`v${e.version}`;}
function Quote({e,label}:{e:Ev;label:string}){
 return <div className="lc-q"><span className="lc-q-h">{label} · {evLabel(e)}</span><code>{e.quote}</code></div>;
}
function FindingLine({f,tag}:{f:Finding;tag?:string}){
 return <li><b>{f.title}</b> <span className="q">{labels[f.doc as Kind]} · {f.field}</span>
  {tag&&<span className="q"> · {tag}</span>}<br/><code>{f.quote}</code></li>;
}

export default function LcAssessment(p:Props){
 const {c,req,busy,error,freshNeeded,staleNotice}=p;
 const a=c.pendingLcAssessment as Assessment|undefined;
 const reqs=c.lcUpdateRequirements;
 const [name,setName]=useState('revised-credit.txt'),[text,setText]=useState(''),[note,setNote]=useState('');
 const [complete,setComplete]=useState(false);
 const [selComplete,setSelComplete]=useState(false),[selCovered,setSelCovered]=useState(false),[selOutside,setSelOutside]=useState(false);
 const [selNote,setSelNote]=useState('');
 const [showSources,setShowSources]=useState(false);

 const eligible=c.status!=='new';
 const stageReady=!!text.trim()&&text.length<=LIMIT_TEXT&&!!name.trim()&&name.length<=LIMIT_NAME
  &&!!note.trim()&&note.length<=LIMIT_NOTE&&complete&&!busy;
 const selectReady=selComplete&&selCovered&&selOutside&&!!selNote.trim()&&selNote.length<=LIMIT_NOTE&&!!req&&!busy;

 async function pick(file:File|undefined){
  if(!file)return;
  if(!file.name.toLowerCase().endsWith('.txt')||file.size>LIMIT_TEXT){return;}
  setText(await file.text()); setName(file.name.slice(0,LIMIT_NAME));
 }

 return <div className="block" id="assess-lc">
  <h2>Assess a revised LC</h2>
  <p className="sub">Accepts <b>complete</b> revised letter-of-credit text carrying the same reference. It is not partial
   amendment advice: no clause is merged, no missing value inferred, and no buyer promise converted into a term.</p>

  {error&&<div className="notice err" role="alert"><TriangleAlert size={16} aria-hidden="true"/>
   <span>{error}{freshNeeded?.length?` Investigate the current ${freshNeeded.map(k=>labels[k as Kind].toLowerCase()).join(' and ')} again so its fields are grounded, then restage.`:''}</span>
   <button className="icon-btn" aria-label="Dismiss error" onClick={p.onDismissError}>×</button></div>}
  {staleNotice&&<div className="notice warnbar" role="status"><span>{staleNotice}</span></div>}

  {!!p.followUp.length&&<dl className="props lc-follow">
   <dt>Required next</dt><dd>{p.followUp.map(f=>fmtFollowUp[f]||f).join(' · ')}</dd></dl>}

  {/* ---------- no pending assessment: stage one ---------- */}
  {!a&&<>
   {!eligible
    ?<p className="basis">Investigate this case before assessing a revised LC. The comparison needs grounded current fields.</p>
    :<details className="fold"><summary>Stage a proposed LC<ChevronDown size={13} aria-hidden="true"/></summary>
      <div className="inner lc-stage">
       <p className="basis">Assessment is read-only against your saved work: the active LC, its findings and any approval
        stay exactly as they are until you explicitly select the proposed version.</p>
       <label className="fieldlabel">File name
        <input className="field-in" value={name} maxLength={LIMIT_NAME} onChange={e=>setName(e.target.value)}/></label>
       <div className="lc-texthead">
        <span className="fieldlabel" id="lc-text-label">Complete revised LC text</span>
        <label className="upload"><Upload size={14} aria-hidden="true"/>Upload .txt
         <input type="file" accept=".txt,text/plain" onChange={e=>pick(e.target.files?.[0])}/></label>
       </div>
       <textarea aria-labelledby="lc-text-label" className="lc-text" value={text} maxLength={LIMIT_TEXT}
        onChange={e=>setText(e.target.value)} placeholder={'reference: LC-2026-1042\ncurrency: USD\n…'}/>
       <p className="basis">{text.length.toLocaleString()} / {LIMIT_TEXT.toLocaleString()} characters</p>
       <label className="fieldlabel">Reviewer note
        <input className="field-in" value={note} maxLength={LIMIT_NOTE} onChange={e=>setNote(e.target.value)}
         placeholder="I supply this complete text as the proposed basis for covered checks."/></label>
       <label className="assert"><input type="checkbox" checked={complete} onChange={e=>setComplete(e.target.checked)}/>
        <span>This is the <b>complete</b> revised LC text, not an extract or amendment notice.</span></label>
       <button className="btn" disabled={!stageReady} onClick={()=>p.onStage({name:name.trim(),text},note.trim())}>
        {busy==='stage'?'Assessing…':'Assess proposed LC'}</button>
      </div></details>}
  </>}

  {/* ---------- pending assessment: the impact ---------- */}
  {a&&<div className="lc-pending">
   <div className="lc-head">
    <div><span className="label">Pending assessment · not yet applied</span>
     <h3>Proposed {a.sources.proposed.name} v{a.sources.proposed.version} against active {a.sources.previous.name} v{a.sources.previous.version}</h3></div>
    <span className="chip attention">Awaiting your decision</span>
   </div>

   <dl className="props">
    <dt>Active LC</dt><dd>{a.sources.previous.name} <span className="q">v{a.sources.previous.version} · in force for covered checks</span></dd>
    <dt>Proposed LC</dt><dd>{a.sources.proposed.name} <span className="q">v{a.sources.proposed.version} · not in force</span></dd>
    <dt>Analysis date</dt><dd>{a.asOf}</dd>
    <dt>Staged by</dt><dd>{a.assertion.reviewer} <span className="q">{a.assertion.at.slice(0,10)} · asserted complete text</span></dd>
    <dt>Reviewer note</dt><dd className="q">{a.assertion.note}</dd>
   </dl>

   <h4 className="lc-h">Deadline</h4>
   <div className="versus">
    <div className="vs-cell"><span className="label">Active deadline</span><time>{a.deadlines.before.date}</time>
     <span className="vs-note">in force</span></div>
    <div className="vs-gap" aria-hidden="true">vs</div>
    <div className={a.deadlines.after.date!==a.deadlines.before.date?'vs-cell late':'vs-cell'}>
     <span className="label">Proposed deadline</span><time>{a.deadlines.after.date}</time>
     <span className="vs-note">proposed — takes effect only if you select this version</span></div>
   </div>
   <div className="lc-basis-grid">
    {([['Active',a.deadlines.before],['Proposed',a.deadlines.after]] as const).map(([k,d])=>
     <dl className="props" key={k}>
      <dt>{k} shipment</dt><dd>{d.shipment.value} <span className="q">{evLabel(d.shipment)}</span></dd>
      <dt>{k} expiry</dt><dd>{d.expiry.value} <span className="q">{evLabel(d.expiry)}</span></dd>
      <dt>{k} presentation days</dt><dd>{d.presentationDays.value}</dd>
      <dt>{k} shipment + days</dt><dd>{d.shipmentPlusDays} <span className="q">earlier of this and expiry controls</span></dd>
     </dl>)}
   </div>

   <h4 className="lc-h">Covered terms</h4>
   {a.coveredTerms.filter(t=>t.changed).length===0
    ?<p className="basis">No covered term changed between these versions.</p>
    :a.coveredTerms.filter(t=>t.changed).map(t=><div className="lc-term" key={t.field}>
      <span className="mm">changed · {t.field.replaceAll('_',' ')}</span>
      <div className="lc-qgrid"><Quote e={t.before} label="Active"/><Quote e={t.after} label="Proposed"/></div></div>)}
   {a.coveredTerms.filter(t=>!t.changed).length>0&&
    <details className="fold"><summary>Unchanged covered terms ({a.coveredTerms.filter(t=>!t.changed).length})<ChevronDown size={13} aria-hidden="true"/></summary>
     <div className="inner"><dl className="props">{a.coveredTerms.filter(t=>!t.changed).map(t=>
      <div key={t.field} style={{display:'contents'}}><dt>{t.field.replaceAll('_',' ')}</dt><dd><code>{t.after.quote}</code></dd></div>)}</dl></div></details>}

   <h4 className="lc-h">Findings if selected</h4>
   <div className="lc-delta">
    {([['Resolved',a.findings.resolved.length],['Persistent',a.findings.persistent.length],
       ['New',a.findings.new.length],['Materially changed',a.findings.materiallyChanged.length]] as const)
      .map(([k,n])=><div key={k}><strong>{String(n).padStart(2,'0')}</strong><span>{k}</span></div>)}
   </div>
   <details className="fold"><summary>Finding detail<ChevronDown size={13} aria-hidden="true"/></summary><div className="inner">
    {a.findings.resolved.length>0&&<><span className="label">Resolved by the proposed version</span>
     <ul className="lc-list">{a.findings.resolved.map(f=><FindingLine key={'r'+f.id} f={f}/>)}</ul></>}
    {a.findings.new.length>0&&<><span className="label">New under the proposed version</span>
     <ul className="lc-list">{a.findings.new.map(f=><FindingLine key={'n'+f.id} f={f}/>)}</ul></>}
    {a.findings.materiallyChanged.length>0&&<><span className="label">Materially changed</span>
     <ul className="lc-list">{a.findings.materiallyChanged.map(x=><FindingLine key={'m'+x.after.id} f={x.after} tag={`was: ${x.before.actual} vs ${x.before.expected}`}/>)}</ul></>}
    {a.findings.persistent.length>0&&<><span className="label">Persistent</span>
     <ul className="lc-list">{a.findings.persistent.map(x=><FindingLine key={'p'+x.after.id} f={x.after}/>)}</ul></>}
   </div></details>

   <h4 className="lc-h">Decisions and correspondence affected</h4>
   <dl className="props">
    <dt>Approval</dt><dd>{a.affected.approval
     ?<>Recorded {a.affected.approval.at.slice(0,10)} <span className="q">would become historical</span></>
     :<span className="none">None recorded</span>}</dd>
    <dt>Correction plan</dt><dd>{a.affected.plan?<span className="q">would become historical</span>:<span className="none">None recorded</span>}</dd>
    <dt>Recovery plan</dt><dd>{a.affected.recoveryPlan?<>{a.affected.recoveryPlan.timing} <span className="q">would become historical</span></>:<span className="none">None recorded</span>}</dd>
    <dt>Correspondence</dt><dd>{a.affected.correspondence.length
     ?<>{a.affected.correspondence.length} saved {a.affected.correspondence.length===1?'reply':'replies'} <span className="q">stay bound to the document versions they were received against; they cannot satisfy timing for a newly selected LC</span></>
     :<span className="none">None recorded</span>}</dd>
   </dl>

   <h4 className="lc-h">Outside covered checks</h4>
   <dl className="props">
    <dt>Unresolved</dt><dd>{a.outsideCoverage.unresolved
     ?<span className="lc-blocked">Yes — selection will not clear this</span>:<span className="q">No</span>}</dd>
    <dt>Reason</dt><dd className="q">{a.outsideCoverage.reason||'—'}</dd>
   </dl>
   {(a.outsideCoverage.previousRemainder||a.outsideCoverage.proposedRemainder)&&
    <details className="fold"><summary>Text outside the covered terms<ChevronDown size={13} aria-hidden="true"/></summary>
     <div className="inner lc-qgrid">
      <div className="lc-q"><span className="lc-q-h">Active remainder</span><code>{a.outsideCoverage.previousRemainder||'—'}</code></div>
      <div className="lc-q"><span className="lc-q-h">Proposed remainder</span><code>{a.outsideCoverage.proposedRemainder||'—'}</code></div></div></details>}
   {a.limitations.length>0&&<ul className="lc-limits">{a.limitations.map(l=><li key={l}>{l}</li>)}</ul>}

   {/* Complete sources — a few quotations cannot substitute for the whole proposed basis. */}
   <h4 className="lc-h">Complete source texts</h4>
   <p className="basis">Review the whole proposed basis, not only the quoted terms.</p>
   <button className="btn ghost sm" aria-expanded={showSources} onClick={()=>setShowSources(s=>!s)}>
    {showSources?'Hide both complete texts':'Show both complete texts'}</button>
   {showSources&&<div className="lc-sources">
    {([['Active — in force',a.sources.previous],['Proposed — not in force',a.sources.proposed]] as const).map(([k,d])=>
     <section className="cmp-col" key={k}>
      <header><b>{k}</b><em>v{d.version}</em><span>{d.name}</span></header>
      <ol className="cmp-lines">{d.text.split(/\r?\n/).map((ln,i)=>
       <li key={i}><span className="n" aria-hidden="true">{i+1}</span><code>{ln||' '}</code></li>)}</ol>
     </section>)}
   </div>}

   {/* ---------- decision ---------- */}
   <h4 className="lc-h">Decision</h4>
   <p className="basis">Selecting a basis changes which LC the covered checks run against. It does <b>not</b> establish
    amendment acceptance, document authenticity, issuer confirmation or bank approval.
    {reqs?.outsideCoverageUnresolved?' Unresolved text outside covered checks stays blocked after selection; this acknowledgement does not clear it.':''}</p>
   <div className="lc-decide">
    <label className="assert"><input type="checkbox" checked={selComplete} onChange={e=>setSelComplete(e.target.checked)}/>
     <span>I reviewed the <b>complete</b> proposed text above.</span></label>
    <label className="assert"><input type="checkbox" checked={selCovered} onChange={e=>setSelCovered(e.target.checked)}/>
     <span>Use this version as the basis for <b>covered checks</b>.</span></label>
    <label className="assert"><input type="checkbox" checked={selOutside} onChange={e=>setSelOutside(e.target.checked)}/>
     <span>Review of changes <b>outside</b> covered checks was performed separately. This does not clear any unresolved requirement.</span></label>
    <label className="fieldlabel">Decision note
     <input className="field-in" value={selNote} maxLength={LIMIT_NOTE} onChange={e=>setSelNote(e.target.value)}
      placeholder="Use this complete version for covered checks; external review was performed."/></label>
    <div className="rowbtns">
     <button className="btn" disabled={!selectReady} onClick={()=>p.onSelect(selNote.trim())}>
      {busy==='select'?'Selecting…':'Use this version for covered checks'}</button>
     <button className="btn ghost" disabled={!req||!!busy} onClick={p.onDismiss}>
      {busy==='dismiss'?'Dismissing…':'Dismiss assessment'}</button>
    </div>
   </div>
  </div>}

  {/* ---------- after selection ---------- */}
  {!a&&reqs&&<div className="lc-after">
   <h4 className="lc-h">Selected basis in force</h4>
   <dl className="props">
    <dt>Active LC</dt><dd>{c.docs.find(d=>d.kind==='lc')?.name} <span className="q">v{c.docs.find(d=>d.kind==='lc')?.version} · committed for covered checks</span></dd>
    <dt>Fresh timing</dt><dd>{reqs.timingConfirmationRequired?<span className="lc-blocked">Required — earlier correspondence cannot satisfy it</span>:<span className="q">Satisfied</span>}</dd>
    <dt>Outside covered checks</dt><dd>{reqs.outsideCoverageUnresolved?<span className="lc-blocked">Unresolved — blocked</span>:<span className="q">No unresolved items recorded</span>}</dd>
    <dt>Specialist review</dt><dd>{reqs.specialistReviewRequired?<span className="lc-blocked">Required</span>:<span className="q">Not required</span>}</dd>
    {reqs.draftingRequired!==undefined&&<><dt>Correction drafts</dt>
     <dd>{reqs.draftingRequired?<span className="lc-blocked">Blocked — selection committed, drafting did not complete. Approval stays unavailable until drafting is retried.</span>:<span className="q">Not blocked</span>}</dd></>}
   </dl>
   <p className="basis">Fresh timing and fresh approval of the correction requests remain separate steps. Covered checks
    passing is not presentation or bank approval.</p>
  </div>}

  <details className="fold"><summary>Assessment history ({(c.lcAssessmentHistory||[]).length})<ChevronDown size={13} aria-hidden="true"/></summary>
   <div className="inner">
    {(c.lcAssessmentHistory||[]).length===0
     ?<p className="basis">No assessment has been staged on this case.</p>
     :(c.lcAssessmentHistory||[]).map((h,i)=><div className="rev" key={i}><dl>
       <dt>Outcome</dt><dd>{h.outcome}</dd>
       <dt>At</dt><dd>{h.at}</dd>
       <dt>Revision</dt><dd>{h.resultingRevision}</dd>
       <dt>Proposed</dt><dd>{h.assessment.sources.proposed.name} v{h.assessment.sources.proposed.version}</dd>
       <dt>Staged note</dt><dd className="q">{h.assessment.assertion.note}</dd>
       {h.selection&&<><dt>Decision note</dt><dd className="q">{h.selection.note}</dd></>}
      </dl></div>)}
   </div></details>
 </div>;
}
