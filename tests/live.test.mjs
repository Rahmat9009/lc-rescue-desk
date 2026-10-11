import {test,after,before} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,realpathSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {parseFixture,fixtureDocs} from '../lib/domain.ts';
const require=createRequire(import.meta.url);
const {Miniflare}=require(require.resolve('miniflare',{paths:[dirname(realpathSync('node_modules/wrangler'))]}));
let mf;let rejectModels=false;let unsafeCoordinator=null;let correspondenceMockMode=null;let rejectTrace=false;let traceReceiptOffset=0;let traceReceiptInvalid=false;const capturedTrees=[];
before(async()=>{mf=new Miniflare({modules:[{type:'ESModule',path:resolve('dist/server/index.js')},...readdirSync('dist/server',{recursive:true}).filter(p=>/\.(js|mjs)$/.test(p)&&p!=='index.js').map(p=>({type:'ESModule',path:resolve('dist/server',p)}))],modulesRoot:resolve('dist/server'),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'lc-live-test'},bindings:{GEMINI_API_KEY:'synthetic-test-key',NEATLOGS_WRITE_KEY:'nlw_synthetic-test-key',NEATLOGS_PROJECT:'synthetic-test-project',LC_MODEL:'gemini-3.1-flash-lite'},outboundService:async req=>{if(new URL(req.url).hostname==='generativelanguage.googleapis.com'){const p=await req.json();assert.equal(new URL(req.url).pathname,'/v1beta/openai/chat/completions');assert.equal(req.headers.get('Authorization'),'Bearer synthetic-test-key');assert.equal(p.model,'gemini-3.1-flash-lite');assert.deepEqual(p.response_format,{type:'json_object'});assert.equal(p.reasoning_effort,'minimal');assert.equal(p.max_tokens,8192);if(rejectModels)return new Response('{}',{status:422});const input=JSON.parse(p.messages[1].content);let result;if(input.document)result=parseFixture({kind:input.kind,text:input.document});else if(input.correspondence)result={quotes:correspondenceMockMode==='invent'?['Invented carrier commitment tomorrow.']:correspondenceMockMode==='omit'?[]:correspondenceMockMode==='truncate'?[input.correspondence.split(' on ')[0]]:[input.correspondence]};else if(input.statements){const refs=['deadline',...input.statements.map(s=>`statement:${s.id}`)];result={actions:[{id:'a1',kind:'human_escalation',owner:'Trade specialist',dueDate:null,dependsOn:[],evidenceRefs:refs},{id:'a2',kind:'clarify_timing',owner:'Human coordinator',dueDate:null,dependsOn:['a1'],evidenceRefs:refs}]};}else if(input.replyScenario)result={...input,timelineBasis:unsafeCoordinator==='scheduled'?'scheduled':'assumption',carrierCommitment:unsafeCoordinator==='commitment'?'confirmed':'unconfirmed',invoiceVersion:unsafeCoordinator==='versions'?input.invoiceVersion+1:input.invoiceVersion,issuerAuthenticity:'unconfirmed',bankAcceptance:'unconfirmed',nextHumanAction:input.resultingStatus==='received'?'recheck':'specialist_review'};else if(p.messages[0].content.includes('invoiceDraft'))result={invoiceDraft:'Mock exporter request.',carrierDraft:'Mock carrier request.'};else result={summary:'Mock strategy based on verified findings.'};return Response.json({model:p.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:100,completion_tokens:25}});}if(new URL(req.url).hostname==='ingest.neatlogs.com'){assert.equal(req.headers.get('user-agent'),'LCRescueDesk/0.1');const tree=await req.json();capturedTrees.push(tree);if(rejectTrace)return new Response('<html><title>403 Forbidden</title><body>nlw_synthetic-test-key SECRET_DOC</body></html>',{status:403,headers:{'Content-Type':'text/html','Server':'awselb/2.0'}});function count(n){return 1+n.children.reduce((t,c)=>t+count(c),0);}if(traceReceiptInvalid)return Response.json({success:true,trace_id:'a'.repeat(32),spans:0,error:'nlw_synthetic-test-key SECRET_DOC'});return Response.json({success:true,trace_id:'a'.repeat(32),spans:count(tree)+traceReceiptOffset});}throw new Error('Unexpected outbound host');}});const db=await mf.getD1Database('DB');await db.prepare(readFileSync('drizzle/0000_steady_namorita.sql','utf8')).run();});
after(async()=>{await mf?.dispose();});
async function request(path,data,owner='test-owner'){const headers={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'synthetic@example.invalid'};if(data){headers['Content-Type']='application/json';headers.origin='https://desk.test';}const r=await mf.dispatchFetch('https://desk.test'+path,{method:data?'POST':'GET',headers,body:data?JSON.stringify(data):undefined});const text=await r.text();let p;try{p=JSON.parse(text);}catch{throw new Error(`HTTP ${r.status}: ${text.slice(0,500)}`);}return {status:r.status,...p};}

test('live Worker executes five scoped model roles with mocked provider, without fixture fallback',async()=>{traceReceiptOffset=1;const opened=await request('/api/cases',{mode:'live',asOf:'2026-10-10',docs:fixtureDocs()});assert.equal(opened.status,201);const p=await request('/api/cases/'+opened.case.id,{type:'investigate',revision:0});assert.equal(p.status,200,JSON.stringify(p));assert.equal(p.case.status,'approval',JSON.stringify(p.case.events));assert.equal(p.case.modelRuns,5);assert.equal(p.case.usage.input,500);assert.equal(p.case.findings.length,2);assert.ok(p.case.events.some(e=>e.title==='Trace accepted'));const tree=capturedTrees.at(-1);const traceBytes=Buffer.byteLength(JSON.stringify(tree));assert.ok(traceBytes<6144,`Mock complete trace was ${traceBytes} bytes`);assert.equal((function count(n){return 1+n.children.reduce((sum,c)=>sum+count(c),0)})(tree),12);const agents=tree.children.filter(n=>n.kind==='AGENT');assert.ok(agents.every(n=>n.input===undefined&&n.output===undefined));assert.ok(agents.every(n=>n.children[0].model==='gemini-3.1-flash-lite'));assert.ok(agents.every(n=>n.children[0].tokens?.prompt===100&&n.children[0].tokens?.completion===25));const guard=tree.children.find(n=>n.kind==='GUARDRAIL');assert.equal(guard.status,'ERROR');assert.equal(guard.output.findings.length,2);const coordinator=agents.find(n=>n.name==='counterparty_coordinator');assert.equal(coordinator.children[0].output.draftTextOmitted,true);assert.ok(agents.filter(n=>n.name.endsWith('_investigator')).every(n=>n.children[0].input.sourceDocumentBytes>0&&JSON.stringify(n.children[0].output).includes('quote')));assert.ok(tree.metadata.telemetryOmissions.includes('Raw documents'));assert.ok(!JSON.stringify(tree).includes(fixtureDocs()[0].text));assert.equal(tree.children.filter(n=>n.kind==='AGENT').length,5);assert.ok(tree.children.every(n=>n.end));assert.equal(tree.project,'synthetic-test-project');assert.ok(tree.children.filter(n=>n.kind==='AGENT').every(n=>n.children[0].name==='gemini.chat'&&n.children[0].attributes['neatlogs.llm.provider']==='gemini'));assert.ok(!JSON.stringify(tree).includes('synthetic-test-key'));traceReceiptOffset=0;});
test('provider failure retains prior state and records an actual failed action',async()=>{rejectModels=true;const opened=await request('/api/cases',{mode:'live',asOf:'2026-10-10',docs:fixtureDocs()});const p=await request('/api/cases/'+opened.case.id,{type:'investigate',revision:0});assert.equal(p.status,200,JSON.stringify(p));assert.equal(p.case.status,'new');assert.equal(p.case.modelRuns,0);assert.equal(p.case.modelAttempts,3);assert.ok(p.case.events.some(e=>e.title==='Live action failed'));assert.deepEqual(p.case.docs,opened.case.docs);const tree=capturedTrees.at(-1);assert.equal(tree.status,'ERROR');assert.equal(tree.children.length,3);assert.ok(tree.children.every(n=>n.end&&n.children[0].end&&n.status==='ERROR'));});

test('live approval, uploaded versions and recheck preserve versioned state',async()=>{rejectModels=false;const opened=await request('/api/cases',{mode:'live',asOf:'2026-10-10',docs:fixtureDocs()});let c=opened.case;for(const a of [{type:'investigate'},{type:'approve'}]){const p=await request('/api/cases/'+c.id,{...a,revision:c.revision});assert.equal(p.status,200);c=p.case;}const docs=fixtureDocs().filter(d=>d.kind!=='lc').map(d=>({...d,text:d.text.replace('currency: EUR','currency: USD').replace('consignee: NORTHSTAR TRADING LTD','consignee: TO ORDER OF MERIDIAN BANK')}));const approvedPlan=structuredClone(c.plan);let p=await request('/api/cases/'+c.id,{type:'reply',reply:'available',docs,revision:c.revision});assert.equal(p.status,200,JSON.stringify(p));c=p.case;assert.equal(c.status,'received');assert.ok(c.replyAssessment.facts.some(f=>f.includes('invoice v2 and B/L v2')));assert.ok(c.replyAssessment.assumptions.every(f=>f.includes('assumption')));assert.ok(c.replyAssessment.unconfirmed.some(f=>f.includes('carrier commitment')));assert.match(c.events.find(e=>e.title==='Reply assessed').detail,/Turnaround assumptions:.*Unconfirmed:/);p=await request('/api/cases/'+c.id,{type:'recheck',revision:c.revision});assert.equal(p.case.status,'reviewed',JSON.stringify(p.case.events));assert.equal(p.case.findings.length,0);assert.equal(p.case.modelRuns,9);assert.equal(p.case.history.length,5);assert.deepEqual(p.case.plan,approvedPlan);assert.deepEqual(p.case.replyAssessment,c.replyAssessment);assert.equal(capturedTrees.at(-1).children.find(n=>n.kind==='GUARDRAIL').passed,true);});
test('HTTP trace failure preserves model result and is never marked verified',async()=>{rejectTrace=true;const opened=await request('/api/cases',{mode:'live',asOf:'2026-10-10',docs:fixtureDocs()});const p=await request('/api/cases/'+opened.case.id,{type:'investigate',revision:0});assert.equal(p.status,200);assert.equal(p.case.status,'approval');assert.ok(p.case.events.some(e=>e.title==='Trace export failed'));assert.ok(!p.case.events.some(e=>e.title==='Trace accepted'));const detail=p.case.events.find(e=>e.title==='Trace export failed').detail;assert.match(detail,/HTTP 403/);assert.match(detail,/content type text\/html/);assert.match(detail,/server awselb\/2\.0/);assert.ok(!detail.includes('authentication')); assert.ok(!detail.includes('synthetic-test-key'));assert.ok(!detail.includes('SECRET_DOC'));rejectTrace=false;});

test('unexpected HTTP 200 receipt is reported without leaking response content',async()=>{
 traceReceiptInvalid=true;
 const opened=await request('/api/cases',{mode:'live',asOf:'2026-10-10',docs:fixtureDocs()});
 const p=await request('/api/cases/'+opened.case.id,{type:'investigate',revision:0});
 assert.equal(p.case.status,'approval');
 const detail=p.case.events.find(e=>e.title==='Trace export failed')?.detail;
 assert.match(detail,/HTTP 200 with unexpected receipt/);
 assert.match(detail,/span count 0/);
 assert.ok(!detail.includes('synthetic-test-key'));
 assert.ok(!detail.includes('SECRET_DOC'));
 traceReceiptInvalid=false;
});

test('reply assessment rejects unsupported timelines, commitments, and document versions',async()=>{
 for(const unsupported of ['scheduled','commitment','versions']){
  unsafeCoordinator=unsupported;
  const opened=await request('/api/cases',{mode:'live',asOf:'2026-10-10',docs:fixtureDocs()});
  let c=opened.case;
  for(const type of ['investigate','approve']){
   const p=await request('/api/cases/'+c.id,{type,revision:c.revision});
   assert.equal(p.status,200);c=p.case;
  }
  const before=structuredClone(c);
  const docs=fixtureDocs().filter(d=>d.kind!=='lc').map(d=>({...d,text:d.text.replace('currency: EUR','currency: USD').replace('consignee: NORTHSTAR TRADING LTD','consignee: TO ORDER OF MERIDIAN BANK')}));
  const p=await request('/api/cases/'+c.id,{type:'reply',reply:'available',docs,revision:c.revision});
  assert.equal(p.status,200);
  assert.equal(p.case.status,'waiting');
  assert.deepEqual(p.case.docs,before.docs);
  assert.deepEqual(p.case.history,before.history);
  assert.deepEqual(p.case.plan,before.plan);
  assert.deepEqual(p.case.approval,before.approval);
  assert.equal(p.case.replyAssessment,undefined);
  assert.ok(p.case.events.some(e=>e.title==='Live action failed'&&e.detail.includes('do not match case evidence')));
  assert.equal(capturedTrees.at(-1).status,'ERROR');
 }
 unsafeCoordinator=null;
});

test('simulated carrier delay remains an assumption without a verified commitment',async()=>{
 const opened=await request('/api/cases',{mode:'live',asOf:'2026-10-10',docs:fixtureDocs()});
 let c=opened.case;
 for(const type of ['investigate','approve']){
  const p=await request('/api/cases/'+c.id,{type,revision:c.revision});
  assert.equal(p.status,200);c=p.case;
 }
 const before=structuredClone(c);
 const p=await request('/api/cases/'+c.id,{type:'reply',reply:'delayed',revision:c.revision});
 assert.equal(p.status,200);
 assert.equal(p.case.status,'stopped');
 assert.deepEqual(p.case.docs,before.docs);
 assert.deepEqual(p.case.history,before.history);
 assert.ok(p.case.replyAssessment.assumptions.some(a=>a.includes(p.case.plan.earliestDate)&&a.includes('assumption')));
 assert.ok(p.case.replyAssessment.unconfirmed.some(a=>a.includes('carrier commitment')));
 assert.match(p.case.replyAssessment.nextHumanAction,/trade specialist/);
});

test('mocked live correspondence retains quote chain and compact recovery trace',async()=>{
 const opened=await request('/api/cases',{mode:'live',asOf:'2026-10-10',docs:fixtureDocs()});let c=opened.case;
 let p=await request('/api/cases/'+c.id,{type:'investigate',revision:c.revision});assert.equal(p.case.status,'approval');c=p.case;
 p=await request('/api/cases/'+c.id,{type:'correspondence',sender:'carrier',text:'We can reissue the B/L in four days.',revision:c.revision});assert.equal(p.status,200);c=p.case;
 assert.equal(c.status,'stopped');assert.equal(c.recoveryPlan.timing,'conflict');assert.equal(c.recoveryPlan.actions[0].kind,'human_escalation');assert.equal(c.statements[0].quote,'We can reissue the B/L in four days.');
 const tree=capturedTrees.at(-1),serialized=JSON.stringify(tree);assert.ok(serialized.includes('We can reissue the B/L in four days.'));
 assert.ok(serialized.includes('evidenceRefs'));assert.ok(!serialized.includes('correspondence":"We can'));
 assert.equal(tree.children.find(n=>n.kind==='GUARDRAIL').output.timing,'conflict');
 correspondenceMockMode='invent';p=await request('/api/cases/'+c.id,{type:'correspondence',sender:'carrier',text:'We can reissue the B/L tomorrow.',revision:c.revision});
 assert.equal(p.case.recoveryPlan.id,c.recoveryPlan.id);assert.ok(p.case.events.some(e=>e.title==='Live action failed'&&e.detail.includes('exact supporting quote')));correspondenceMockMode=null;
});

test('mocked live coordinator truncation and omission retain explicit source dates',async()=>{
 const opened=await request('/api/cases',{mode:'live',asOf:'2026-10-10',docs:fixtureDocs()});let c=opened.case;
 let p=await request('/api/cases/'+c.id,{type:'investigate',revision:c.revision});assert.equal(p.case.status,'approval');c=p.case;
 correspondenceMockMode='truncate';p=await request('/api/cases/'+c.id,{type:'correspondence',sender:'exporter',text:'We will send the corrected invoice on 2026-10-12.',revision:c.revision});
 assert.equal(p.status,200);c=p.case;assert.equal(c.statements[0].quote,'We will send the corrected invoice on 2026-10-12.');assert.equal(c.statements[0].date,'2026-10-12');assert.equal(c.recoveryPlan.timing,'unknown');
 correspondenceMockMode='omit';p=await request('/api/cases/'+c.id,{type:'correspondence',sender:'carrier',text:'We can reissue the corrected B/L on 2026-10-16.',revision:c.revision});
 assert.equal(p.status,200);c=p.case;assert.equal(c.statements[1].quote,'We can reissue the corrected B/L on 2026-10-16.');assert.equal(c.statements[1].date,'2026-10-16');
 assert.equal(c.recoveryPlan.timing,'conflict');assert.match(c.recoveryPlan.reason,/2026-10-16.*2026-10-12/);assert.equal(c.recoveryPlan.actions[0].kind,'human_escalation');assert.equal(c.approval,undefined);
 assert.ok(c.recoveryPlan.unresolved.some(q=>q.includes('does not establish time')));
 const trace=JSON.stringify(capturedTrees.at(-1));assert.ok(trace.includes('We can reissue the corrected B/L on 2026-10-16.'));assert.ok(trace.includes('recovery_plan_checks'));
 correspondenceMockMode=null;
});

