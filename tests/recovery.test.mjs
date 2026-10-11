import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureDocs,newCase,parseFixture,finishInvestigation,transition,plusDays} from '../lib/domain.ts';
import {newCorrespondence,validateExtraction,demoQuotes,defaultCandidate,validateRecoveryPlan,applyCorrespondence,reassessSavedCorrespondence} from '../lib/recovery.ts';

function caseAtDeadline(){
 const docs=fixtureDocs();
 const c=newCase('demo',docs,'2026-10-10');for(const d of docs)c.fields[d.kind]=parseFixture(d);finishInvestigation(c);
 assert.equal(c.deadline,'2026-10-12');assert.equal(c.status,'approval');return c;
}
function receive(c,sender,text){const receipt=newCorrespondence(c,sender,text);const extraction=validateExtraction(c,receipt,demoQuotes(text));const statements=[...(c.statements||[]),...extraction.statements];return applyCorrespondence(c,receipt,extraction,defaultCandidate(c,statements));}
function receiveRaw(c,sender,text,quotes){const receipt=newCorrespondence(c,sender,text);const extraction=validateExtraction(c,receipt,{quotes});return applyCorrespondence(c,receipt,extraction,defaultCandidate(c,[...(c.statements||[]),...extraction.statements]));}

test('exact supported quotes produce dated commitments and conflict escalation across two replies',()=>{
 let c=caseAtDeadline();c=receive(c,'exporter','We will send the corrected invoice tomorrow.');
 assert.equal(c.recoveryPlan.timing,'unknown');assert.equal(c.statements[0].date,'2026-10-11');assert.equal(c.statements[0].quote,'We will send the corrected invoice tomorrow.');
 c=receive(c,'carrier','We can reissue the B/L in four days.');
 assert.equal(c.recoveryPlan.timing,'conflict');assert.equal(c.statements[1].date,'2026-10-14');assert.match(c.recoveryPlan.reason,/2026-10-14.*2026-10-12/);
 assert.match(c.recoveryPlan.nextAction,/Escalate.*clarify/i);assert.equal(c.status,'stopped');assert.equal(c.recoveryPlan.actions[0].kind,'human_escalation');
 assert.deepEqual(c.recoveryPlan.evidenceRefs,['deadline',`statement:${c.statements[1].id}`]);assert.equal(c.planHistory.length,2);
 assert.ok(c.recoveryPlan.unresolved.some(q=>q.includes('Bank extension, waiver, issuer confirmation, and successful presentation are unconfirmed')));
 assert.equal(c.modelRuns,0);
});
test('unsupported quote and unsupported bank commitment fail extraction',()=>{
 const c=caseAtDeadline(),r=newCorrespondence(c,'exporter','We will send the corrected invoice tomorrow.');
 assert.throws(()=>validateExtraction(c,r,{quotes:['We will send the corrected invoice today.']}),/exact supporting quote/);
 assert.equal(validateExtraction(c,r,{quotes:['tomorrow']}).statements[0].quote,r.text);
 assert.throws(()=>validateExtraction(c,r,{quotes:[r.text],bankExtension:true}),/unsupported claims/);
 const bank=newCorrespondence(c,'exporter','We will ask the bank for an extension for the invoice.');
 assert.throws(()=>validateExtraction(c,bank,{quotes:[bank.text]}),/does not support/);
 const negated=newCorrespondence(c,'carrier','We will not reissue the B/L tomorrow.');assert.throws(()=>validateExtraction(c,negated,{quotes:[negated.text]}),/does not support/);
});
test('ambiguous quoted dates do not become a timing commitment',()=>{const c=caseAtDeadline(),r=newCorrespondence(c,'carrier','We can reissue the B/L on 2026-10-11 or 2026-10-14.');const e=validateExtraction(c,r,{quotes:[r.text]});assert.equal(e.statements[0].date,null);});
test('exact dated replies survive truncated and omitted provider quotes',()=>{
 let c=caseAtDeadline();c=receiveRaw(c,'exporter','We will send the corrected invoice on 2026-10-12.',['We will send the corrected invoice']);
 assert.equal(c.statements[0].quote,'We will send the corrected invoice on 2026-10-12.');assert.equal(c.statements[0].date,'2026-10-12');assert.equal(c.recoveryPlan.timing,'unknown');
 assert.ok(c.recoveryPlan.unresolved.some(q=>q.includes('does not establish time')));
 c=receiveRaw(c,'carrier','We can reissue the corrected B/L on 2026-10-16.',[]);
 assert.equal(c.statements[1].quote,'We can reissue the corrected B/L on 2026-10-16.');assert.equal(c.statements[1].date,'2026-10-16');
 assert.equal(c.recoveryPlan.timing,'conflict');assert.match(c.recoveryPlan.reason,/carrier B\/L.*2026-10-16.*2026-10-12/);
 assert.deepEqual(c.recoveryPlan.evidenceRefs,['deadline',`statement:${c.statements[1].id}`]);assert.equal(c.status,'stopped');
 assert.equal(c.correspondence[1].label,'User-provided correspondence · authenticity unverified');
});
test('saved truncated assessments can be reassessed without model calls',()=>{
 let c=caseAtDeadline();c=receive(c,'exporter','We will send the corrected invoice on 2026-10-12.');c=receive(c,'carrier','We can reissue the corrected B/L on 2026-10-16.');
 const oldPlan=structuredClone(c.recoveryPlan),oldCalls=c.modelRuns;
 c.statements[0].quote='We will send the corrected invoice';c.statements[0].date=null;c.statements[1].quote='We can reissue the corrected B/L';c.statements[1].date=null;
 const repaired=reassessSavedCorrespondence(c);
 assert.equal(repaired.statements[0].date,'2026-10-12');assert.equal(repaired.statements[1].date,'2026-10-16');assert.equal(repaired.recoveryPlan.timing,'conflict');
 assert.deepEqual(repaired.priorAssessments[0].statements,c.statements);assert.deepEqual(repaired.planHistory.at(-1).plan,oldPlan);assert.equal(repaired.modelRuns,oldCalls);
});
test('missing dates and estimates remain unresolved',()=>{
 let c=caseAtDeadline();c=receive(c,'carrier','We expect to reissue the B/L soon.');
 assert.equal(c.statements[0].category,'assumption');assert.equal(c.statements[0].date,null);assert.equal(c.recoveryPlan.timing,'unknown');
 assert.ok(c.recoveryPlan.unresolved.some(q=>q.includes('carrier B/L commitment with a date')));
});
test('plan validator rejects unsupported references, dates, dependencies and mismatched owners',()=>{
 const c=caseAtDeadline(),r=newCorrespondence(c,'exporter','We will send the corrected invoice tomorrow.'),e=validateExtraction(c,r,{quotes:[r.text]});
 c.correspondence=[r];const proposed=defaultCandidate(c,e.statements);const bad=structuredClone(proposed);
 bad.actions[0].evidenceRefs=['statement:invented'];assert.throws(()=>validateRecoveryPlan(c,bad,e.statements),/evidence reference/);
 const date=structuredClone(proposed);date.actions[0].dueDate=plusDays(c.asOf,8);assert.throws(()=>validateRecoveryPlan(c,date,e.statements),/unsupported by the cited/);
 const dependency=structuredClone(proposed);dependency.actions[0].dependsOn=['a2'];assert.throws(()=>validateRecoveryPlan(c,dependency,e.statements),/dependency/);
 const owner=structuredClone(proposed);owner.actions[0].kind='request_bl';owner.actions[0].owner='Exporter';assert.throws(()=>validateRecoveryPlan(c,owner,e.statements),/owner conflicts/);
});
test('new correspondence invalidates prior approval while preserving document versions and plan history',()=>{
 let c=caseAtDeadline();c=transition(c,{type:'approve',revision:c.revision});const originalApproval=structuredClone(c.approval),versions=c.docs.map(d=>d.version);
 c=receive(c,'exporter','We will send the corrected invoice tomorrow.');assert.equal(c.approval,undefined);assert.deepEqual(c.planHistory[0].approval,originalApproval);assert.deepEqual(c.docs.map(d=>d.version),versions);
 c=receive(c,'carrier','We will reissue the B/L tomorrow.');assert.equal(c.status,'approval');assert.equal(c.recoveryPlan.timing,'feasible');
 const approved=transition(c,{type:'approve',revision:c.revision});assert.equal(approved.approval.planId,c.recoveryPlan.id);
 const tampered=structuredClone(approved);tampered.recoveryPlan.id='changed';assert.throws(()=>transition(tampered,{type:'reply',reply:'available',revision:tampered.revision}),/matching current documents and plan/);
});
test('a quoted date from an earlier document version cannot bind a new plan',()=>{
 const c=caseAtDeadline(),r=newCorrespondence(c,'carrier','We will reissue the B/L tomorrow.'),e=validateExtraction(c,r,{quotes:[r.text]});
 c.correspondence=[r];c.docs[2].version++;
 const candidate={actions:[{id:'a1',kind:'request_bl',owner:'Carrier',dueDate:e.statements[0].date,dependsOn:[],evidenceRefs:[`statement:${e.statements[0].id}`]}]};
 assert.throws(()=>validateRecoveryPlan(c,candidate,e.statements),/evidence reference/);
});
