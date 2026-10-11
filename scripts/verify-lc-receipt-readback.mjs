// Read-only audit of the authorized synthetic case. No model calls or mutations.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { documentVersions, validate } from '../lib/domain.ts';
import { sourceBinding, normalizeSourceLines } from '../lib/source-grounding.ts';
const dir = 'output/playwright';
const first = JSON.parse(readFileSync(`${dir}/receipt-recheck-ledger.json`, 'utf8'));
const retry = JSON.parse(readFileSync(`${dir}/receipt-retry-ledger.json`, 'utf8'));
const before = JSON.parse(readFileSync(`${dir}/receipt-before.json`, 'utf8'));
const received = JSON.parse(readFileSync(`${dir}/receipt-retry-saved-case.json`, 'utf8'));
const expected = JSON.parse(readFileSync(`${dir}/receipt-retry-final-case.json`, 'utf8'));
const response = await fetch(`http://127.0.0.1:5173/api/cases/${before.id}`, { headers: { Cookie: '__sites_local_auth=1' } });
assert.equal(response.status, 200);
const { case: current, followUp } = await response.json();
assert.deepEqual(current, expected);
assert.equal(current.revision, 10); assert.equal(current.status, 'reviewed');
assert.equal(current.deadline, '2026-10-21'); assert.deepEqual(current.docs.map(d => d.version), [2, 2, 2]);
assert.deepEqual(current.docs[0], before.docs[0]);
assert.equal(before.approval.documentVersions, documentVersions(before));
assert.equal(before.approval.planId, before.recoveryPlan.id);
assert.deepEqual(received.findings, before.findings);
assert.equal(received.status, 'received'); assert.equal(received.revision, 9);
assert.equal(current.approval, undefined);
assert.deepEqual(current.planHistory.at(-1).approval, before.approval);
assert.deepEqual(current.planHistory.at(-1).plan, before.recoveryPlan);
assert.deepEqual(current.planHistory.slice(0, before.planHistory.length), before.planHistory);
assert.deepEqual(current.planningFailures, before.planningFailures);
assert.deepEqual(current.lcAssessmentHistory, before.lcAssessmentHistory);
assert.deepEqual(current.correspondence, before.correspondence);
assert.deepEqual(current.priorAssessments.at(-1).statements, before.statements);
assert.deepEqual(current.extractionHistory.slice(0, before.extractionHistory.length), before.extractionHistory);
for (const doc of before.history) assert.ok(current.history.some(d => sourceBinding(d) === sourceBinding(doc)));
assert.ok(current.events.some(e => e.run === first.steps[0].runIds[0] && e.title === 'Live action failed'));
// The original LC v1 run never received approval; preserve that absence too.
assert.equal(current.lcAssessmentHistory.at(-1).previous.approval, undefined);
for (const doc of current.docs) {
  const extraction = current.extractionHistory.filter(e => e.kind === doc.kind).at(-1);
  assert.equal(extraction.version, 2); assert.equal(extraction.documentBinding, sourceBinding(doc));
  // Independently establish unique full source-line grounding for every current field.
  normalizeSourceLines(doc, current.fields[doc.kind], sourceBinding(doc));
}
const independentlyChecked = structuredClone(current); assert.deepEqual(validate(independentlyChecked), []);
assert.equal(independentlyChecked.deadline, '2026-10-21');
const additionalAttempts = first.actualAttempts + retry.actualAttempts;
assert.equal(additionalAttempts, 5);
const summary = { verifiedAtUTC: new Date().toISOString(), timezone: 'Asia/Qatar', caseReference: before.fields.lc.reference.value, revision: current.revision, status: current.status, deadline: current.deadline, findings: current.findings, versions: current.docs.map(d => ({ kind: d.kind, version: d.version })), archivedHumanApproval: { revision: before.approval.revision, at: before.approval.at, planId: before.approval.planId, originalVersions: before.docs.map(d => ({ kind: d.kind, version: d.version })) }, history: { sources: current.history.map(d => ({ kind: d.kind, version: d.version })), plans: current.planHistory.length, rejectedProposals: current.planningFailures.length, extractionRecords: current.extractionHistory.length, assessments: current.lcAssessmentHistory.length, currentCorrespondence: current.correspondence.length, priorAssessments: current.priorAssessments.length, priorApprovalRetained: true, earlierFailureRetained: true }, additionalAttempts, usage: { input: first.usage.input + retry.usage.input, output: first.usage.output + retry.usage.output, missing: first.usage.missing + retry.usage.missing }, cumulativeAttempts: current.modelAttempts, cumulativeUsage: current.usage, localCaseReadbackVerified: true, currentUniqueSourceLineGroundingVerified: true, persistedNeatlogsReadbackVerified: false, followUp };
writeFileSync(`${dir}/receipt-readback-audit.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
