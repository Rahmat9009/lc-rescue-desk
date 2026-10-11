'use client';
import { useEffect,useRef,useState } from 'react';
import { ArrowRight,Check,CheckCheck,ChevronDown,Clock,Download,FileText,FolderOpen,Layers,LoaderCircle,Menu,Minus,Plus,RefreshCw,ShieldCheck,TriangleAlert,Upload,Workflow,X } from 'lucide-react';
import { Case,Doc,Finding,Kind,ReplyAssessment,basePlan,finishInvestigation,fixtureDocs,labels,newCase,parseFixture,required } from '../lib/domain';
import { RecoveryPlan,Sender,applyCorrespondence,defaultCandidate,demoQuotes,newCorrespondence,validateExtraction } from '../lib/recovery';
type Config={liveReady:boolean;model:boolean;neatlogs:boolean;modelName:string|null};
const statusLabel={new:'Ready to investigate',approval:'Approval required',waiting:'Waiting for corrections',received:'Recheck required',reviewed:'Covered checks passed',stopped:'Specialist review required'};
const shortLabels:Record<Kind,string>={lc:'LC',invoice:'Invoice',bl:'B/L'};
const stages=['Investigate','Review plan','Coordinate','Recheck','Reviewed'];
const sample=fixtureDocs();
const navigation=[['desk','Rescue desk',Layers],['documents','Documents',FolderOpen],['readiness','Readiness',ShieldCheck]] as const;
const headings={desk:['Rescue desk','Keep the payment moving.','Find the conflict, coordinate the correction, and verify what comes back.'],documents:['Documents','Every version. Every source.','Source text and the extraction evidence supporting each field.'],readiness:['Readiness','Make the work verifiable.','Configuration, saved evidence links and what remains unverified.']} as const;

/* ---------- provenance -----------------------------------------------------------------------
   Both of these read what was saved, never what happens to be current.
   approval.documentVersions is `kind:version:text` joined by \n; document body lines never begin
   with `lc:` / `invoice:` / `bl:` (they use `reference:`, `lc_reference:` …), so this is exact. */
function approvalBinding(a:NonNullable<Case['approval']>):string{
 const parsed=[...a.documentVersions.matchAll(/^(lc|invoice|bl):(\d+):/gm)].map(m=>`${labels[m[1] as Kind].toLowerCase()} v${m[2]}`);
 return parsed.length?parsed.join(', '):'the saved document versions';
}
/* A finding was raised against whichever saved version actually contains its quote. Prefer the
   current version; otherwise fall back through retained history. Never assert a version that
   does not contain the quote. */
function findingSource(c:Case,f:Finding):{doc:Doc|null;stale:boolean}{
 const current=c.docs.find(d=>d.kind===f.doc);
 if(current&&current.text.includes(f.quote))return {doc:current,stale:false};
 const prior=c.history.filter(d=>d.kind===f.doc&&d.text.includes(f.quote)).sort((a,b)=>b.version-a.version)[0];
 return {doc:prior||null,stale:!!prior};
}
function anyStale(c:Case):boolean{return c.findings.some(f=>findingSource(c,f).stale);}

/* ---------- source resolution ----------------------------------------------------------------
   Quotations resolve inside one exact saved version. Multiline quotations match on their first
   line. Ambiguous or absent matches suppress the line number rather than invent one. */
type Located={line:number|null;note:'ok'|'ambiguous'|'absent'};
function locateQuote(text:string,quote:string):Located{
 const needle=(quote||'').split(/\r?\n/)[0].trim();
 if(!needle)return {line:null,note:'absent'};
 const hits=text.split(/\r?\n/).reduce<number[]>((a,l,i)=>(l.trim()===needle||l.includes(needle)?[...a,i+1]:a),[]);
 return hits.length===1?{line:hits[0],note:'ok'}:hits.length>1?{line:null,note:'ambiguous'}:{line:null,note:'absent'};
}
function lineLabel(l:Located):string{return l.note==='ok'?`line ${l.line}`:l.note==='ambiguous'?'line ambiguous':'line not found';}
/* validate() yields two kinds of `expected`: a value quoted from the LC, or a computed rule.
   Only the first may be called an LC requirement and carry a line number. */
function expectedSource(c:Case,f:Finding):{quoted:boolean;quote:string;located:Located;version:number|null}{
 const lc=c.docs.find(d=>d.kind==='lc');
 const hit=lc&&Object.entries(c.fields.lc||{}).find(([,v])=>v.value===f.expected);
 if(!lc||!hit)return {quoted:false,quote:f.expected,located:{line:null,note:'absent'},version:null};
 return {quoted:true,quote:hit[1].quote,located:locateQuote(lc.text,hit[1].quote),version:lc.version};
}

/* ---------- dates ----------------------------------------------------------------------------- */
function dayDiff(from:string,to:string):number|null{
 const a=Date.parse(from+'T00:00:00Z'),b=Date.parse(to+'T00:00:00Z');
 return Number.isNaN(a)||Number.isNaN(b)?null:Math.round((b-a)/86400000);
}
function reported(c:Case):{target:'invoice'|'bl';date:string;quote:string;sender:Sender}[]{
 const vk=c.docs.map(d=>`${d.kind}:v${d.version}`).join('|');
 return (c.statements||[]).filter(s=>s.date&&s.target&&c.correspondence?.find(r=>r.id===s.correspondenceId)?.sourceVersions===vk)
  .map(s=>({target:s.target as 'invoice'|'bl',date:s.date as string,quote:s.quote,sender:s.sender}));
}

/* ---------- history grouping -------------------------------------------------------------------
   Group only when every material plan field matches, never on headline similarity. */
type AnyPlan=RecoveryPlan|NonNullable<Case['plan']>;
function isRecovery(p:AnyPlan):p is RecoveryPlan{return 'nextAction' in p;}
function planSignature(p:AnyPlan):string{
 if(!isRecovery(p))return ['base',p.summary,p.earliestDate,p.assumption,p.invoiceDraft,p.carrierDraft].join('\u0001');
 return ['rec',p.timing,p.nextAction,p.reason,String(p.approvalRequired),[...p.evidenceRefs].sort().join(','),
  [...p.unresolved].sort().join(','),p.actions.map(a=>`${a.kind}/${a.owner}/${a.dueDate??''}/${[...a.dependsOn].sort().join('+')}`).sort().join(',')].join('\u0001');
}
type Episode={sig:string;entries:NonNullable<Case['planHistory']>};
function groupHistory(c:Case):Episode[]{
 const out:Episode[]=[];
 for(const h of c.planHistory||[]){const sig=planSignature(h.plan),last=out[out.length-1];
  if(last&&last.sig===sig)last.entries.push(h); else out.push({sig,entries:[h]});}
 return out;
}
function planTitle(p:AnyPlan):string{return isRecovery(p)?p.nextAction:p.summary;}

/* ---------- landing demonstration ---------------------------------------------------------------
   Generated by the application's own model-free domain functions — the same call sequence
   lib/agents.ts uses in demo mode. One synthetic case runs through every landing section. */
function demoReply(c:Case,sender:Sender,text:string):Case{
 const receipt=newCorrespondence(c,sender,text);
 const extraction=validateExtraction(c,receipt,demoQuotes(receipt.text));
 const draft={...c,correspondence:[...(c.correspondence||[]),receipt]};
 const stmts=[...(c.statements||[]),...extraction.statements]
  .filter(s=>draft.correspondence.find(r=>r.id===s.correspondenceId)?.sourceVersions===receipt.sourceVersions);
 return applyCorrespondence(c,receipt,extraction,defaultCandidate(draft,stmts));
}
const EXPORTER_REPLY='We will send the corrected invoice on 2026-10-12.';
const CARRIER_REPLY='We can reissue the corrected B/L on 2026-10-16.';
function buildDemo(){
 const docs=fixtureDocs(),base=newCase('demo',docs,'2026-10-10');
 base.fields={lc:parseFixture(docs[0]),invoice:parseFixture(docs[1]),bl:parseFixture(docs[2])};
 finishInvestigation(base);
 const afterExporter=demoReply(base,'exporter',EXPORTER_REPLY);
 return {docs,base,afterExporter,afterCarrier:demoReply(afterExporter,'carrier',CARRIER_REPLY),summary:basePlan(base).summary};
}

/* ---------- shared components -------------------------------------------------------------------- */
function Brand(){return <img src="/LC Rescue Desk document logo.png" alt="LC Rescue Desk"/>;}
function Chip({tone,children}:{tone?:'conflict'|'attention'|'ok';children:React.ReactNode}){return <span className={tone?`chip ${tone}`:'chip'}>{children}</span>;}
function StageRail({status}:{status:Case['status']}){
 const i=['new','approval','waiting','received','reviewed'].indexOf(status),stopped=status==='stopped';
 return <div className="stage">{stages.map((s,n)=><span key={s} className={stopped?'':n===i?'on':n<i?'done':''}>{n>0&&<i aria-hidden="true">› </i>}{s}</span>)}
  {stopped&&<span className="off"><i aria-hidden="true">· </i>Specialist review required</span>}</div>;
}
/* Source comparison. "requires / states" never implies a corrected document exists. */
function SourceDiff({c,f}:{c:Case;f:Finding}){
 const src=expectedSource(c,f),{doc,stale}=findingSource(c,f);
 const actual=doc?locateQuote(doc.text,f.quote):{line:null,note:'absent'} as Located;
 const token=f.actual&&f.quote.includes(f.actual);
 return <article className="finding">
  <div className="finding-head"><span className={f.severity==='blocker'?'mk blocker':'mk'}><TriangleAlert size={14} aria-hidden="true"/></span>
   <div><h3>{f.title}</h3><p>{labels[f.doc]} · {f.owner} would reissue this document</p></div>
   {stale&&<Chip tone="attention">raised against {shortLabels[f.doc]} v{doc?.version} · not yet rechecked</Chip>}</div>
  <dl className="diff">
   <div className={src.quoted?'r req':'r rule'}>
    <dt className="k"><span className="g" aria-hidden="true">{src.quoted&&src.located.note==='ok'?src.located.line:'—'}</span>
     {src.quoted?`Letter of credit v${src.version} requires · ${lineLabel(src.located)}`:'Validation rule · not a quoted LC term'}</dt>
    <dd className="v">{src.quoted?src.quote:f.expected}</dd></div>
   <div className="r act">
    <dt className="k"><span className="g" aria-hidden="true">{actual.note==='ok'?actual.line:'—'}</span>
     {doc?`${labels[f.doc]} v${doc.version} states · ${lineLabel(actual)}`:`${labels[f.doc]} · source version not found`}</dt>
    <dd className="v">{token?<>{f.quote.split(f.actual)[0]}<mark>{f.actual}</mark>{f.quote.split(f.actual).slice(1).join(f.actual)}</>:f.quote}</dd></div>
  </dl>
  <div className="finding-foot"><span>{f.severity==='blocker'?'Blocks presentation until the issuer reissues it':'Needs trade specialist review'}</span></div>
 </article>;
}
/* October 12 against October 16, legible at a glance. */
function DeadlineCompare({c}:{c:Case}){
 const rep=reported(c),deadline=c.deadline||null;
 const latest=[...rep].sort((a,b)=>a.date<b.date?1:-1)[0];
 const slip=deadline&&latest?dayDiff(deadline,latest.date):null;
 const dates=[c.asOf,...(deadline?[deadline]:[]),...rep.map(r=>r.date)].sort();
 const min=dates[0],max=dates[dates.length-1],span=Math.max(dayDiff(min,max)||1,1);
 const pos=(d:string)=>Math.min(100,Math.max(0,((dayDiff(min,d)||0)/span)*100));
 return <>
  <div className="versus">
   <div className="vs-cell"><span className="label">Presentation deadline</span><time dateTime={deadline||undefined}>{deadline||'Not established'}</time>
    <span className="vs-note">calculated from the saved LC</span></div>
   <div className="vs-gap" aria-hidden="true">vs</div>
   <div className={latest&&slip!==null&&slip>0?'vs-cell late':'vs-cell'}>
    <span className="label">{latest?`${labels[latest.target]} reported available`:'Counterparty availability'}</span>
    <time dateTime={latest?.date}>{latest?latest.date:'Not established'}</time>
    <span className="vs-note">{latest?`reported by the ${latest.sender} · authenticity unverified`:'no dated statement yet'}</span></div>
  </div>
  {slip!==null&&slip>0&&<p className="slip"><TriangleAlert size={14} aria-hidden="true"/>{slip} days after the presentation deadline</p>}
  {deadline&&<div className="axis" role="img" aria-label={`Deadline ${deadline}. ${latest?`${labels[latest.target]} reported available ${latest.date}.`:''}`}>
   <div className="ln"/><div className="tk" style={{left:0}}><b>{min.slice(5)}</b></div><div className="tk" style={{left:'100%'}}><b>{max.slice(5)}</b></div>
   <div className="due" style={{left:`${pos(deadline)}%`}}/>
   <span className="duebadge" style={{left:`${pos(deadline)}%`}}>{deadline.slice(5)}</span>
   {rep.map(r=><div key={r.target+r.date} className={deadline&&r.date>deadline?'pt bad':'pt'} style={{left:`${pos(r.date)}%`}}/>)}
  </div>}
  <dl className="kv">
   <dt>Case date</dt><dd>{c.asOf}</dd>
   {(['invoice','bl'] as const).map(k=>{const r=rep.filter(x=>x.target===k).at(-1);
    return <div key={k} style={{display:'contents'}}><dt>{labels[k]} reported available</dt>
     <dd className={r?(deadline&&r.date>deadline?'bad':''):'none'}>{r?r.date:'Not established'}</dd></div>;})}
   {c.plan&&<><dt>Assumed earliest availability</dt><dd>{c.plan.earliestDate}</dd></>}
   {c.recoveryPlan&&<><dt>Timing</dt><dd className={c.recoveryPlan.timing==='conflict'?'bad':c.recoveryPlan.timing==='unknown'?'none':''}>{c.recoveryPlan.timing}</dd></>}
  </dl>
  <p className="basis">Countdowns are measured from the case date {c.asOf}, not today. Counterparty dates are reported availability from user-provided correspondence: unverified, and not a commitment.</p>
 </>;
}
function Evidence({c,plan}:{c:Case;plan:RecoveryPlan}){
 return <div className="ev">{plan.evidenceRefs.map(ref=>{
  if(ref==='deadline')return <div className="q" key={ref}><span className="src">case · deadline</span><span className="txt">Saved presentation deadline: {c.deadline}</span></div>;
  if(ref.startsWith('statement:')){const s=c.statements?.find(x=>`statement:${x.id}`===ref);
   return <div className="q" key={ref}><span className="src">{s?`${s.sender} · ${s.date||'no date'}`:'statement'}</span><span className="txt">{s?`“${s.quote}”`:'Unavailable'}</span></div>;}
  const f=c.findings.find(x=>`finding:${x.id}`===ref);
  return <div className="q" key={ref}><span className="src">{f?labels[f.doc]:'finding'}</span><span className="txt">{f?f.quote:ref}</span></div>;
 })}</div>;
}
function ReplyAssessmentView({a}:{a:ReplyAssessment}){return <div className="rev"><dl>
 <dt>Facts</dt><dd>{a.facts.join(' ')}</dd><dt>Assumed</dt><dd>{a.assumptions.join(' ')}</dd>
 <dt>Unconfirmed</dt><dd>{a.unconfirmed.join(' ')}</dd><dt>Next</dt><dd>{a.nextHumanAction}</dd></dl></div>;}

export default function Desk(){
 const [tab,setTab]=useState('desk'),[view,setView]=useState<'home'|'case'>('home'),[cases,setCases]=useState<Case[]>([]),[c,setCase]=useState<Case|null>(null),[config,setConfig]=useState<Config|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[modal,setModal]=useState(false),[mode,setMode]=useState<'demo'|'live'>('demo'),[docs,setDocs]=useState<Doc[]>(sample),[asOf,setAsOf]=useState(new Date().toISOString().slice(0,10)),[activeDoc,setActiveDoc]=useState<Kind>('lc'),[evidence,setEvidence]=useState({neatlogs:'',entire:'',checkpoint:'',business:''}),[revisions,setRevisions]=useState<Partial<Record<Kind,Doc>>>({}),[sender,setSender]=useState<Sender>('exporter'),[correspondenceText,setCorrespondenceText]=useState(''),[demo]=useState(buildDemo),[step,setStep]=useState(0),[navOpen,setNavOpen]=useState(false),[pickerOpen,setPickerOpen]=useState(false);
 const modalRef=useRef<HTMLDivElement>(null),opener=useRef<HTMLElement|null>(null);
 useEffect(()=>{refresh();},[]);
 useEffect(()=>{if(c)setEvidence(c.evidence);},[c?.id,c?.revision]);
 useEffect(()=>{if(!modal)return;const prev=opener.current,el=modalRef.current;
  const list=()=>Array.from(el?.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')||[]).filter(n=>!n.hasAttribute('disabled'));
  list()[0]?.focus();
  function key(e:KeyboardEvent){
   if(e.key==='Escape'){setModal(false);return;}
   if(e.key!=='Tab')return;const f=list();if(!f.length)return;
   const first=f[0],last=f[f.length-1];
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
  document.addEventListener('keydown',key);
  return ()=>{document.removeEventListener('keydown',key);prev?.focus();};
 },[modal]);
 async function request(path:string,data?:unknown){const r=await fetch(path,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:undefined);const p=await r.json() as {error?:string;cases:Case[];case:Case;config:Config};if(!r.ok)throw new Error(p.error||'Request failed.');return p;}
 async function refresh(){setBusy('Loading desk');setError('');try{const p=await request('/api/cases');setCases(p.cases);setCase(old=>old?p.cases.find((n:Case)=>n.id===old.id)||old:p.cases[0]||null);setConfig(p.config);}catch(e){setError((e as Error).message);}finally{setBusy('');}}
 function useCase(n:Case){setCase(n);setCases(old=>[n,...old.filter(o=>o.id!==n.id)].slice(0,20));}
 async function create(){setBusy('Opening case');setError('');try{const p=await request('/api/cases',{mode,docs,asOf});useCase(p.case);setModal(false);setTab('desk');setView('case');setRevisions({});}catch(e){setError((e as Error).message);}finally{setBusy('');}}
 async function act(type:string,extra:Record<string,unknown>={}){if(!c)return false;setBusy(type==='investigate'||type==='recheck'?'Investigating document evidence':'Saving case action');setError('');try{const p=await request(`/api/cases/${c.id}`,{type,revision:c.revision,...extra});useCase(p.case);if(p.case.events.some((e:Case['events'][0],i:number)=>i>=c.events.length&&e.title==='Live action failed')){setError('Live action failed. See the case history; your previous saved case is intact.');return false;}return true;}catch(e){setError((e as Error).message);return false;}finally{setBusy('');}}
 async function submitCorrespondence(){if(!correspondenceText.trim())return;if(await act('correspondence',{sender,text:correspondenceText}))setCorrespondenceText('');}
 async function upload(file:File|undefined,kind:Kind,revised=false){if(!file)return;if(file.size>16000||!file.name.toLowerCase().endsWith('.txt')){setError('Upload a UTF-8 .txt file under 16 KB. PDF and OCR are outside this build.');return;}const text=await file.text();const d={kind,text,name:file.name,version:1,synthetic:false};if(revised)setRevisions(old=>({...old,[kind]:d}));else setDocs(old=>old.map(o=>o.kind===kind?d:o));}
 function download(){if(!c)return;const pack={...c,scope:'Prototype covered checks only. No bank acceptance guarantee.',exportedAt:new Date().toISOString()};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(pack,null,2)],{type:'application/json'}));a.download=`lc-rescue-${c.id.slice(0,8)}-r${c.revision}.json`;a.click();URL.revokeObjectURL(a.href);}
 function openCase(e?:React.MouseEvent){opener.current=(e?.currentTarget as HTMLElement)||null;setModal(true);setDocs(sample);setMode('demo');}
 function goHome(){setTab('desk');setView('home');setNavOpen(false);}
 function openWorkspace(n:Case|undefined){if(!n)return;setCase(n);setTab('desk');setView('case');setNavOpen(false);setPickerOpen(false);}
 function goTab(id:string){setTab(id);setNavOpen(false);}
 const currentDocs=c?.docs||sample,selected=currentDocs.find(d=>d.kind===activeDoc)||currentDocs[0];
 const [crumb,title,blurb]=headings[tab as keyof typeof headings];
 const home=tab==='desk'&&(view==='home'||!c);
 const demoCase=[demo.base,demo.afterExporter,demo.afterCarrier][step];
 const daysLeft=c?.deadline?dayDiff(c.asOf,c.deadline):null;
 const reviewed=c?.status==='reviewed';
 const stale=c?anyStale(c):false;
 const step1=!c?null:c.status==='new'?{t:'Investigate the document pack',d:'Three saved documents. Extraction runs against each source, then code compares every supported value with the letter of credit.',l:'Investigate document pack',r:()=>act('investigate')}
  :c.status==='approval'?{t:c.recoveryPlan?.nextAction||'Approve the correction requests',d:c.recoveryPlan?.reason||'Drafts are ready for the exporter and the carrier. Nothing is sent outside this desk.',l:'Approve correction requests',r:()=>act('approve')}
  :c.status==='waiting'?{t:c.recoveryPlan?.nextAction||'Record what the counterparties send back',d:c.recoveryPlan?.reason||'Requests are approved. Receive a reply below, then recheck the revised pack as a separate step.',l:'',r:null}
  :c.status==='received'?{t:'Recheck the revised document pack',d:'Revised versions are saved alongside the originals. The findings below were raised against the earlier versions and stay open until an independent recheck clears them.',l:'Recheck revised document pack',r:()=>act('recheck')}
  :c.status==='reviewed'?{t:'Covered checks passed on the current versions',d:'Export the case evidence, then arrange full trade specialist and bank presentation review. Issuer authenticity and bank acceptance remain unconfirmed.',l:'',r:null}
  :{t:c.recoveryPlan?.nextAction||'Pause and escalate to a trade specialist',d:c.recoveryPlan?.reason||'Timing, missing evidence or bank acceptance falls outside the supported correction path. The pack is not marked resolved.',l:'',r:null};

 const navItems=(drawer:boolean)=><>{navigation.map(([id,label,Icon])=>
  <button key={id} className="rail-item" aria-current={tab===id&&!(id==='desk'&&home)?'page':undefined} onClick={()=>goTab(id)}>
   <Icon size={17} aria-hidden="true"/>{label}{id==='desk'&&cases.length>0&&<span className="n">{cases.length}</span>}</button>)}
  {drawer&&<button className="rail-item" onClick={goHome}><FileText size={17} aria-hidden="true"/>Home</button>}</>;

 const casePicker=(id:string)=><div className="picker" id={id}>
  <label className="label" htmlFor={id+'-sel'}>Saved cases</label>
  <select id={id+'-sel'} value={c?.id||''} onChange={e=>openWorkspace(cases.find(n=>n.id===e.target.value))}>
   {!c&&<option value="" disabled>Choose a saved case</option>}
   {cases.map(n=><option value={n.id} key={n.id}>{n.mode==='demo'?'Demo':'Live'} · {n.id.slice(0,8)} · {statusLabel[n.status]}</option>)}</select>
  {c&&<button className="btn ghost sm" onClick={()=>setView('case')}>Open workspace</button>}</div>;

 /* Requests + correspondence render inline while the case is live, and fold into history once
    reviewed. Nothing is dropped in either arrangement. */
 const requestsBlock=c&&c.plan?<>
  <h2>Correction requests</h2>
  <p className="sub">Who reissues what. Receiving a revised document and rechecking it are separate steps.</p>
  {(['invoice','bl'] as const).filter(k=>c.findings.some(f=>f.doc===k)||reviewed).map(k=>{const r=reported(c).filter(x=>x.target===k).at(-1);
   return <div className="rowitem" key={k}><Chip>{shortLabels[k]}</Chip>
    <span className="t"><b>{k==='invoice'?'Exporter':'Carrier'}</b><span>Review and reissue the {labels[k].toLowerCase()}</span></span>
    {r?<Chip tone={c.deadline&&r.date>c.deadline?'conflict':'attention'}>reported {r.date} · unverified</Chip>:<Chip tone="attention">no reported date</Chip>}
    <Chip tone={c.approval?'ok':'attention'}>{c.approval?'approved':'awaiting approval'}</Chip></div>;})}
  <details className="fold"><summary>Request drafts<ChevronDown size={14} aria-hidden="true"/></summary><div className="inner">
   <p className="reason">{c.plan.invoiceDraft}</p><p className="reason">{c.plan.carrierDraft}</p>
   <p className="basis">Assumed earliest availability {c.plan.earliestDate}. {c.plan.assumption}</p></div></details>
 </>:null;

 const correspondenceBlock=c&&c.plan?<>
  <h2>Correspondence</h2>
  <p className="sub">User-provided correspondence · authenticity unverified. No messages are sent.</p>
  {['approval','waiting','stopped'].includes(c.status)&&<div className="corr-entry">
   <label>Sender<select value={sender} onChange={e=>setSender(e.target.value as Sender)}>
    <option value="exporter">Exporter</option><option value="carrier">Carrier</option><option value="other">Other</option></select></label>
   <label>Reply text<textarea value={correspondenceText} onChange={e=>setCorrespondenceText(e.target.value)} maxLength={8000} placeholder="For example: We will send the corrected invoice on 2026-10-12."/></label>
   <button className="btn" disabled={!!busy||!correspondenceText.trim()} onClick={submitCorrespondence}>Assess reply and update plan</button></div>}
  {(c.correspondence||[]).map(r=>{const stmts=(c.statements||[]).filter(s=>s.correspondenceId===r.id);
   return <div className="quote" key={r.id}><div className="qh"><b>{r.sender}</b><Chip>{r.receivedOn}</Chip><span className="sp"/>
     <span className="label" style={{textTransform:'none',letterSpacing:0}}>authenticity unverified</span></div>
    <div className="qb"><blockquote>{r.text}</blockquote>
     <div className="cs"><span className="label">Extracted</span>
      {stmts.length?stmts.map(s=><Chip key={s.id} tone={s.date&&c.deadline&&s.date>c.deadline?'conflict':undefined}>{s.category} · {s.target||'no target'} · {s.date||'no date'}</Chip>)
       :<Chip tone="attention">no supported dated statement</Chip>}</div></div></div>;})}
  {!!c.correspondence?.length&&['approval','waiting','stopped'].includes(c.status)&&
   <button className="btn ghost sm" disabled={!!busy} onClick={()=>act('reassess')}><RefreshCw size={14} aria-hidden="true"/>Reassess saved correspondence</button>}
  {c.replyAssessment&&<details className="fold"><summary>Reply assessment<ChevronDown size={14} aria-hidden="true"/></summary><div className="inner"><ReplyAssessmentView a={c.replyAssessment}/></div></details>}
 </>:null;

 return <div className="shell">
  {!home&&<aside className="rail">
   <button className="brand" onClick={goHome} aria-label="LC Rescue Desk — home"><Brand/></button>
   <span className="label rail-label">Workspace</span>
   <nav aria-label="Sections">{navItems(false)}</nav>
   <div className="rail-note"><b>Human in the loop</b>Evidence before a correction. Corrections by the issuer. Approval at every boundary.</div>
  </aside>}
  <main className={home?'full':undefined}>
   {home
    ?<header className="lander">
      <button className="brand" onClick={goHome} aria-label="LC Rescue Desk — home"><Brand/></button>
      <span className="sp"/>
      {cases.length>0&&<button className="btn ghost sm" aria-expanded={pickerOpen} aria-controls="home-picker" onClick={()=>setPickerOpen(o=>!o)}><FolderOpen size={15} aria-hidden="true"/>Open existing case</button>}
      <button className="btn sm" onClick={openCase} disabled={!!busy}>Open a case</button>
     </header>
    :<header className="topbar">
      <button className="icon-btn navtoggle" aria-expanded={navOpen} aria-controls="mobile-nav" onClick={()=>setNavOpen(o=>!o)} aria-label={navOpen?'Close navigation':'Open navigation'}>{navOpen?<X size={18}/>:<Menu size={18}/>}</button>
      <div className="crumb"><button className="link" onClick={goHome}>Home</button><i aria-hidden="true">/</i><strong>{crumb}</strong></div>
      <span className="sp"/>
      <button className="icon-btn" title="Refresh saved cases" aria-label="Refresh saved cases" onClick={refresh} disabled={!!busy}><RefreshCw size={16} aria-hidden="true"/></button>
     </header>}
   {navOpen&&!home&&<div className="drawer" id="mobile-nav"><div className="brandrow"><Brand/></div><nav aria-label="Sections">{navItems(true)}</nav></div>}
   <div className="content">
    {home&&pickerOpen&&casePicker('home-picker')}
    {error&&<div className="notice err" role="alert"><TriangleAlert size={18} aria-hidden="true"/><span>{error}</span><button className="icon-btn" aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>}
    {busy&&<div className="notice busy" role="status"><LoaderCircle size={16} className="spin" aria-hidden="true"/>{busy}{c?.mode==='live'&&' · real model calls can take a few minutes'}</div>}
    {tab!=='desk'&&<div className="page-head"><div><h1>{title}</h1><p>{blurb}</p></div><button className="btn" onClick={openCase} disabled={!!busy}><Plus size={17} aria-hidden="true"/>New case</button></div>}

    {/* ===================== LANDING ===================== */}
    {home&&<>
     <section className="hero"><div className="hero-grid">
      <div>
       <h1>When trade documents disagree, know what to do next.</h1>
       <p className="hero-lede">LC Rescue Desk compares letters of credit, invoices, and bills of lading, links conflicts to source evidence, and updates correction plans as replies arrive—with human approval throughout.</p>
       <div className="hero-actions"><button className="btn" onClick={openCase} disabled={!!busy}>Open a case<ArrowRight size={17} aria-hidden="true"/></button></div>
       <p className="hero-note"><ShieldCheck size={15} aria-hidden="true"/>Correction drafts stay inside the desk. Nothing is sent to a counterparty, and no outcome is certified.</p>
      </div>
      <div className="hero-demo">
       <div className="hero-demo-head"><span className="label">Comparison of the saved documents</span>
        <span className="synthetic"><TriangleAlert size={12} aria-hidden="true"/>{`Synthetic case ${demo.base.fields.lc?.reference?.value}`}</span></div>
       {demo.base.findings.map(f=><SourceDiff key={f.id} c={demo.base} f={f}/>)}
       <p className="basis">Presentation deadline {demo.base.deadline}, calculated from the saved expiry, presentation period and shipment date. Rendered by the same comparison code a live case runs.</p>
      </div>
     </div></section>

     <section className="band">
      <span className="label">The same case, continued · synthetic</span>
      <h2>The recommendation changes when a reply arrives.</h2>
      <p>Select a counterparty reply to {demo.base.fields.lc?.reference?.value}. Each state is produced by running this application&rsquo;s own model-free domain functions — nothing here is written by hand.</p>
      <div className="demo">
       <div>
        {[{n:1,who:'Exporter',q:EXPORTER_REPLY},{n:2,who:'Carrier',q:CARRIER_REPLY}].map(r=>
         <button key={r.n} className="replybtn" aria-pressed={step>=r.n} onClick={()=>setStep(step>=r.n?r.n-1:r.n)}>
          <span className="who">{step>=r.n?<Check size={13} aria-hidden="true"/>:<Plus size={13} aria-hidden="true"/>}{r.who} · 2026-10-11 · authenticity unverified</span>
          <q>{r.q}</q></button>)}
        {step>0&&<button className="link onband" onClick={()=>setStep(0)}><Minus size={14} aria-hidden="true"/>Reset to the original pack</button>}
       </div>
       <div className="demo-out">
        <span className="label">{demoCase.recoveryPlan?'Latest validated plan':'Initial correction plan'} · timing {demoCase.recoveryPlan?.timing||'not assessed'}</span>
        <h3>{demoCase.recoveryPlan?.nextAction||'Approve the exporter and carrier correction requests.'}</h3>
        <p>{demoCase.recoveryPlan?.reason||demo.summary}</p>
        <DeadlineCompare c={demoCase}/>
        <p className="foot">Status: {statusLabel[demoCase.status]}. Issuer authenticity and bank acceptance remain unconfirmed.</p>
       </div>
      </div>
     </section>

     <section className="sec"><div className="sec-head"><div><h2>What this build implements</h2>
      <p>The scope is deliberately narrow, and the interface states it rather than implying more.</p></div></div>
      <div className="claims">
       <div>{['Source-grounded extraction, rejected without a supporting quote','Currency and explicit consignee conflicts','Reference, amount and date checks','Calculated presentation deadline','Approval bound to the document versions it was given','Version retention and independent recheck','Deterministic assessment of pasted correspondence'].map(t=>
        <div className="claim yes" key={t}><Check size={15} aria-hidden="true"/>{t}</div>)}</div>
       <div>{['PDF extraction and OCR','Document authenticity','Full UCP/ISBP interpretation','Bank holiday handling','Recipient verification','External messaging','Bank submission or acceptance'].map(t=>
        <div className="claim no" key={t}><Minus size={15} aria-hidden="true"/>{t}</div>)}</div>
      </div>
     </section>

     <section className="cta"><h2>Work the October 12 conflict end to end.</h2>
      <button className="btn" onClick={openCase} disabled={!!busy}>Open a case<ArrowRight size={17} aria-hidden="true"/></button></section>
    </>}

    {/* ===================== WORKSPACE ===================== */}
    {tab==='desk'&&view==='case'&&c&&<>
     <div className="casebar">
      <h1>{c.fields.lc?.reference?.value||`Case ${c.id.slice(0,8)}`}</h1>
      <Chip tone={c.status==='stopped'?'conflict':reviewed?'ok':'attention'}>{statusLabel[c.status]}</Chip>
      {c.docs.map(d=><Chip key={d.kind}>{shortLabels[d.kind]} v{d.version}</Chip>)}
      {daysLeft!==null&&<Chip tone={daysLeft<0?'conflict':'attention'}>{daysLeft<0?`${-daysLeft} days past deadline`:`${daysLeft} days to deadline`} · from case date {c.asOf}</Chip>}
      <span className="sp"/>
      <StageRail status={c.status}/>
      <button className="link" onClick={download}>Export<Download size={14} aria-hidden="true"/></button>
      <button className="btn ghost sm" onClick={()=>setPickerOpen(o=>!o)} aria-expanded={pickerOpen} aria-controls="ws-picker">Switch case</button>
     </div>
     {pickerOpen&&casePicker('ws-picker')}

     <div className="decision">
      <div className="pane rec">
       <span className="label">Latest validated action</span>
       <h2 className="act">{step1!.t}</h2>
       <p className="reason">{step1!.d}</p>
       {step1!.r&&<button className="btn" disabled={!!busy} onClick={step1!.r}>{step1!.l}<ArrowRight size={16} aria-hidden="true"/></button>}
       {c.status==='approval'&&<p className="binding">Approving binds {c.docs.map(d=>`${labels[d.kind].toLowerCase()} v${d.version}`).join(', ')}{c.recoveryPlan?` and recovery plan ${c.recoveryPlan.id.slice(0,8)}`:''}. Requests are recorded internally; no external messages are sent.</p>}
       {c.approval&&<p className="binding">Approved {c.approval.at.slice(0,10)}, bound to {approvalBinding(c.approval)}{c.approval.planId?` and recovery plan ${c.approval.planId.slice(0,8)}`:''}.{stale&&' Documents have changed since that approval.'}</p>}
       {c.recoveryPlan?.approvalRequired&&!c.approval&&<p className="binding">The plan changed materially, so the earlier approval no longer applies.</p>}
      </div>
      <div className="pane alt"><span className="label">Deadline comparison</span><DeadlineCompare c={c}/></div>
      {c.recoveryPlan&&<div className="pane quotes"><span className="label">Supporting quotations</span><Evidence c={c} plan={c.recoveryPlan}/></div>}
     </div>

     {c.recoveryPlan&&<div className="support one">
      <details className="fold" open><summary>Unresolved questions<ChevronDown size={14} aria-hidden="true"/></summary>
       <div className="inner"><ul className="plain cols">{c.recoveryPlan.unresolved.map(u=><li key={u}>{u}</li>)}</ul></div></details>
     </div>}

     <div className="block work">
      <h2>Document comparison</h2>
      <p className="sub">Each conflict against the letter of credit term it breaks, resolved to the saved version that contains the quotation.</p>
      {stale&&<div className="notice warnbar"><TriangleAlert size={16} aria-hidden="true"/><span>Revised documents have arrived. These findings were raised against the earlier versions shown on each row and have <strong>not</strong> been rechecked against the current pack.</span></div>}
      {c.status==='new'?<div className="empty"><FileText size={30} aria-hidden="true"/><h3>Nothing compared yet</h3><p>Run the investigation to extract supported values and compare them with the letter of credit.</p>
        <button className="btn" disabled={!!busy} onClick={()=>act('investigate')}>Investigate document pack<ArrowRight size={16} aria-hidden="true"/></button></div>
       :c.findings.length===0?<div className="empty"><CheckCheck size={30} aria-hidden="true"/><h3>Covered checks passed</h3><p>These versions passed the checks this build implements. A trade specialist and the issuing bank still need to examine the full presentation.</p></div>
       :c.findings.map(f=><SourceDiff key={f.id} c={c} f={f}/>)}
     </div>

     {!reviewed&&requestsBlock&&<div className="block">{requestsBlock}
      {c.status==='waiting'&&<div className="receive">
       <span className="label">Receive a counterparty reply</span>
       <p className="sub">Simulated reply scenarios. Rechecking is a separate action once versions are received.</p>
       {c.mode==='live'&&(['invoice','bl'] as Kind[]).map(k=><label key={k} className="drop"><Upload size={15} aria-hidden="true"/>{revisions[k]?.name||`Upload revised ${labels[k]}`}
        <input type="file" accept=".txt,text/plain" onChange={e=>upload(e.target.files?.[0],k,true)}/></label>)}
       <button className="btn" disabled={!!busy||(c.mode==='live'&&(!revisions.invoice||!revisions.bl))} onClick={()=>act('reply',{reply:'available',docs:c.mode==='live'?Object.values(revisions):undefined})}>{c.mode==='demo'?'Receive synthetic corrected versions':'Receive uploaded revised versions'}</button>
       <div className="rowbtns">
        <button className="btn ghost sm" disabled={!!busy} onClick={()=>act('reply',{reply:'delayed'})}>Carrier delay</button>
        <button className="btn ghost sm" disabled={!!busy} onClick={()=>act('reply',{reply:'waiver'})}>Buyer waiver only</button></div></div>}
      {c.status==='stopped'&&<div className="outcome bad"><TriangleAlert size={18} aria-hidden="true"/><div><strong>Pause and escalate</strong>
       <p>Resolve timing or bank acceptance with a trade specialist. The pack is not marked resolved.</p></div></div>}
     </div>}

     {!reviewed&&correspondenceBlock&&<div className="block">{correspondenceBlock}</div>}

     <details className="hist">
      <summary><Clock size={17} aria-hidden="true"/><h2>History</h2>
       {reviewed&&<Chip tone="ok">completed requests &amp; correspondence</Chip>}
       <Chip>{groupHistory(c).length} plan {groupHistory(c).length===1?'episode':'episodes'}</Chip>
       <Chip>{c.events.length} events</Chip><ChevronDown size={17} className="chev" aria-hidden="true"/></summary>
      <div className="hbody">
       {reviewed&&requestsBlock&&<section className="histsec">{requestsBlock}</section>}
       {reviewed&&correspondenceBlock&&<section className="histsec">{correspondenceBlock}</section>}
       {groupHistory(c).length>0&&<section className="histsec"><span className="label">Previous strategies</span>
        {groupHistory(c).map((ep,i)=>{const first=ep.entries[0],last=ep.entries[ep.entries.length-1],p=first.plan;
         const tone=isRecovery(p)?(p.timing==='conflict'?'conflict':p.timing==='feasible'?'ok':''):'';
         return <div className="ep" key={i}><time dateTime={first.at}>{first.at.slice(5,10)} {first.at.slice(11,16)}</time>
          <span className={tone?`tile ${tone}`:'tile'} aria-hidden="true"><Workflow size={13}/></span>
          <div><b>{planTitle(p)}{ep.entries.length>1&&` · ${ep.entries.length} identical revisions`}</b>
           <div className="cs">{isRecovery(p)&&<Chip tone={p.timing==='conflict'?'conflict':p.timing==='unknown'?'attention':'ok'}>timing {p.timing}</Chip>}
            <Chip tone={first.approval?'ok':undefined}>{first.approval?`approved ${first.approval.at.slice(0,10)} · bound ${approvalBinding(first.approval)}`:'no approval recorded'}</Chip>
            {isRecovery(p)&&<Chip>{p.evidenceRefs.length} evidence refs</Chip>}</div>
           {ep.entries.length>1&&<p className="sub">Grouped because every material plan field matched across {ep.entries.length} writes, from {first.at.slice(11,19)} to {last.at.slice(11,19)}.</p>}
           <details className="fold"><summary>View full revision{ep.entries.length>1?'s':''}<ChevronDown size={13} aria-hidden="true"/></summary><div className="inner">
            {ep.entries.map((h,j)=><div className="rev" key={j}><dl>
             <dt>Recorded</dt><dd>{h.at}</dd>
             <dt>Next</dt><dd>{planTitle(h.plan)}</dd>
             {isRecovery(h.plan)?<><dt>Reason</dt><dd>{h.plan.reason}</dd><dt>Timing</dt><dd>{h.plan.timing}</dd>
              <dt>Versions</dt><dd>{[...h.plan.documentVersions.matchAll(/(lc|invoice|bl):v?(\d+)/g)].map(m=>`${m[1]} v${m[2]}`).join(', ')||h.plan.documentVersions}</dd>
              <dt>Evidence</dt><dd>{h.plan.evidenceRefs.join(', ')||'none'}</dd>
              <dt>Unresolved</dt><dd>{h.plan.unresolved.join(' ')||'none'}</dd>
              <dt>Actions</dt><dd>{h.plan.actions.map(a=>`${a.kind.replaceAll('_',' ')} · ${a.owner}${a.dueDate?` · ${a.dueDate}`:''}`).join('; ')}</dd></>
              :<><dt>Assumed</dt><dd>{h.plan.earliestDate} — {h.plan.assumption}</dd></>}
             <dt>Approval</dt><dd>{h.approval?`${h.approval.at} · bound to ${approvalBinding(h.approval)}`:'none recorded'}</dd>
            </dl></div>)}</div></details>
          </div></div>;})}</section>}
       <section className="histsec"><span className="label">All activity</span>
        {[...c.events].reverse().map((e,i)=><div className="ep" key={i}><time dateTime={e.at}>{new Date(e.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time>
         <span className="tile" aria-hidden="true"><Clock size={13}/></span>
         <div><b>{e.title}</b><div className="cs"><Chip>{e.actor}</Chip>{e.run&&<Chip>run {e.run.slice(0,10)}</Chip>}</div><p className="sub">{e.detail}</p></div></div>)}</section>
      </div>
     </details>
    </>}

    {/* ===================== DOCUMENTS ===================== */}
    {tab==='documents'&&<>
     <div className="doctabs">{currentDocs.map(d=><button key={d.kind} aria-pressed={activeDoc===d.kind} onClick={()=>setActiveDoc(d.kind)}>
      <FileText size={16} aria-hidden="true"/>{labels[d.kind]}<em>v{d.version}</em></button>)}</div>
     {!c&&<div className="notice busy" role="status"><TriangleAlert size={16} aria-hidden="true"/>Showing the synthetic demonstration pack. Open a case to see its own documents.</div>}
     <div className="two">
      <div className="block" style={{padding:0}}>
       <div className="blockhead"><h2>{selected.name}</h2><Chip>{selected.synthetic?'synthetic':'uploaded'} · v{selected.version}</Chip></div>
       <div className="srcview">{selected.text.split(/\r?\n/).map((ln,i)=>{
        const used=Object.values(c?.fields[selected.kind]||{}).some(f=>locateQuote(selected.text,f.quote).line===i+1);
        return <div className={used?'srcline used':'srcline'} key={i}><span className="n" aria-hidden="true">{i+1}</span><span className="t">{ln||' '}</span></div>;})}</div>
      </div>
      <div className="block">
       <h2>Supported fields</h2>
       <p className="sub">Each value with the line of this saved version it was read from.</p>
       {Object.entries(c?.fields[selected.kind]||{}).length?Object.entries(c!.fields[selected.kind]!).map(([k,f])=>{const l=locateQuote(selected.text,f.quote);
        return <div className="field" key={k}><span>{k.replaceAll('_',' ')} · {lineLabel(l)}</span><strong>{f.value}</strong><q>{f.quote}</q></div>;})
        :<p className="reason">{c?`No extraction saved for this version yet. Required fields: ${required[selected.kind].join(', ')}.`:'Open a case and run the investigation to extract fields. Each output must carry a quote found in the source text.'}</p>}
      </div>
     </div>
     {c&&c.history.length>c.docs.length&&<div className="block"><h2>Retained versions</h2>
      <p className="sub">Originals are kept when a revised version arrives.</p>
      {c.history.map((d,i)=><details className="fold" key={i}><summary>{d.name} · v{d.version} · {d.synthetic?'synthetic':'uploaded'}<ChevronDown size={14} aria-hidden="true"/></summary>
       <div className="inner"><pre className="src">{d.text}</pre></div></details>)}</div>}
    </>}

    {/* ===================== READINESS ===================== */}
    {tab==='readiness'&&<>
     <div className="block">
      <h2>What each state means</h2>
      <p className="sub">These are four different things, and only the first two are established by this application.</p>
      <div className="rowitem"><Chip tone="ok">configured</Chip><span className="t"><span>A server setting is present in this deployment.</span></span></div>
      <div className="rowitem"><Chip tone="ok">saved</Chip><span className="t"><span>A link or ID is stored on this case. A saved URL does not mean it was opened or checked.</span></span></div>
      <div className="rowitem"><Chip tone="attention">receipt accepted</Chip><span className="t"><span>An ingest endpoint acknowledged a trace. The payload contents are not read back.</span></span></div>
      <div className="rowitem"><Chip tone="attention">verified</Chip><span className="t"><span>A person opened the external artefact and confirmed it. <strong>Not implemented — never claimed by this app.</strong></span></span></div>
     </div>
     <div className="two">
      <div className="block"><h2>Configuration</h2><p className="sub">Read from server settings; secrets are never sent to the browser.</p>
       {[['Gemini model',config?.liveReady?`configured${config.modelName?` · ${config.modelName}`:''}`:'not configured',!!config?.liveReady],
         ['neatlogs HTTP tracing',config?.neatlogs?'configured':'not configured',!!config?.neatlogs]].map(([n,s,ok])=>
        <div className="rowitem" key={n as string}><span className="t"><b>{n as string}</b></span><Chip tone={ok?'ok':'attention'}>{s as string}</Chip></div>)}
       <p className="basis">Configured means the setting is present. It does not mean a live run has succeeded or that a trace was persisted correctly.</p>
      </div>
      <div className="block"><h2>Saved evidence links</h2><p className="sub">Entered by the team and stored on the case. Not fetched, opened or certified.</p>
       {[['neatlogs','neatlogs trace URL'],['entire','Entire checkpoint URL'],['checkpoint','Entire checkpoint ID'],['business','cfo.ai business plan URL']].map(([k,l])=>
        <label key={k} className="fieldlabel">{l}
         <input className="field-in" value={evidence[k as keyof typeof evidence]}
          placeholder={k==='checkpoint'?'checkpoint ID':'https://…'} onChange={e=>setEvidence(o=>({...o,[k]:e.target.value}))}/></label>)}
       <button className="btn" disabled={!c||!!busy} onClick={()=>act('evidence',{evidence})}>Save evidence links<Check size={16} aria-hidden="true"/></button>
       {!c&&<p className="basis">Open a case before saving evidence.</p>}
       {c&&<p className="basis">Saved on case {c.id.slice(0,8)}. Saved is not verified.</p>}
      </div>
     </div>
     <div className="block"><h2>Export the complete case</h2>
      <p className="sub">The JSON pack contains every retained document version, supported field, finding, approval, plan revision, correspondence quotation, state transition and recorded model usage.</p>
      <button className="btn ghost" disabled={!c} onClick={download}><Download size={16} aria-hidden="true"/>Download case evidence</button></div>
    </>}

    <footer><span>LC Rescue Desk</span><p>Prototype decision support · covered checks only · full presentation review required</p><span>neatHack 2026</span></footer>
   </div>
  </main>

  {modal&&<div className="backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(false);}}>
   <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={modalRef}>
    <div className="modal-head"><div><h2 id="modal-title">Start at the source.</h2><p>Open a document case with the synthetic pack or your own text documents.</p></div>
     <button className="icon-btn" aria-label="Close" onClick={()=>setModal(false)}><X size={20} aria-hidden="true"/></button></div>
    <div className="modes">
     <button aria-pressed={mode==='demo'} onClick={()=>setMode('demo')}>Synthetic demonstration<span>Fixed fixtures · no model calls</span></button>
     <button aria-pressed={mode==='live'} onClick={()=>setMode('live')}>Live investigation<span>Real models · neatlogs traces</span></button></div>
    {mode==='demo'?<div className="modal-body"><span className="synthetic"><TriangleAlert size={13} aria-hidden="true"/>Two deliberate conflicts</span>
     <h3>A $48,000 invoice and a presentation deadline two days after the case date.</h3>
     <p>The invoice states EUR; the LC requires USD. The bill of lading names the buyer; the LC explicitly requires an order-of-bank consignee. Case date 2026-10-10 · synthetic bank and company names.</p></div>
     :<div className="modal-body">
      <label className="fieldlabel">Case assessment date
       <input className="field-in" type="date" value={asOf} onChange={e=>setAsOf(e.target.value)}/></label>
      <p>Use anonymised or synthetic documents first. Text is sent to the configured model and to neatlogs. UTF-8 .txt only, up to 16,000 characters each.</p>
      {docs.map(d=><div className="docinput" key={d.kind}><div>{labels[d.kind]}
        <label className="upload"><Upload size={14} aria-hidden="true"/>Upload .txt<input type="file" accept=".txt,text/plain" onChange={e=>upload(e.target.files?.[0],d.kind)}/></label></div>
       <input aria-label={`${labels[d.kind]} filename`} value={d.name} onChange={e=>setDocs(o=>o.map(x=>x.kind===d.kind?{...x,name:e.target.value}:x))}/>
       <textarea aria-label={`${labels[d.kind]} text`} value={d.text} maxLength={16000} onChange={e=>setDocs(o=>o.map(x=>x.kind===d.kind?{...x,text:e.target.value}:x))}/></div>)}
      {!config?.liveReady&&<div className="warn">Server settings are missing. Complete Readiness before opening a live case.</div>}</div>}
    <div className="modal-foot"><button className="btn ghost" onClick={()=>setModal(false)}>Cancel</button>
     <button className="btn" disabled={!!busy||(mode==='live'&&!config?.liveReady)} onClick={create}>{busy&&<LoaderCircle size={16} className="spin" aria-hidden="true"/>}Open {mode==='demo'?'synthetic':'live'} case<ArrowRight size={16} aria-hidden="true"/></button></div>
   </section></div>}
 </div>;
}
