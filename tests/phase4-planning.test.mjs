import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newCase, finishInvestigation } from '../lib/domain.ts';
import { newCorrespondence, validateExtraction, validateRecoveryPlan, recoveryPlannerInput, defaultCandidate } from '../lib/recovery.ts';
const load = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

test('actual original trace bad missing: reference is rejected; fixing it alone still cannot authorize partial corrections', () => {
  const evidence = load('phase4-grounding'), reported = load('phase4-original-planner');
  const c = newCase('demo', evidence.docs, '2026-10-11'); c.fields = evidence.fields; finishInvestigation(c);
  const receipt = newCorrespondence(c, 'exporter', reported.text); receipt.id = reported.correspondenceId;
  const extraction = validateExtraction(c, receipt, { quotes: [receipt.text] });
  const contract = recoveryPlannerInput(c, receipt, extraction); c.correspondence = [receipt];
  assert.ok(!contract.allowedEvidenceRefs.includes('missing:No supported carrier B/L availability date.'));
  assert.ok(contract.allowedEvidenceRefs.includes('finding:bl.consignee')); assert.ok(contract.allowedEvidenceRefs.includes('deadline'));
  assert.deepEqual(contract.supportedCommitmentDatesByKind.request_invoice, ['2026-10-12']);
  assert.throws(() => validateRecoveryPlan(c, reported.proposal, extraction.statements), /a3.*unsupported evidence reference/);
  const fixedRef = structuredClone(reported.proposal); fixedRef.actions[2].evidenceRefs = ['finding:bl.consignee'];
  assert.throws(() => validateRecoveryPlan(c, fixedRef, extraction.statements), /unresolved timing/);
  const correct = defaultCandidate(c, extraction.statements);
  assert.equal(validateRecoveryPlan(c, correct, extraction.statements).timing, 'unknown');
  assert.deepEqual(correct.actions.map(a => a.kind), ['human_escalation', 'clarify_timing']);
});

test('exact fresh live proposal keeps its supported date and references but is rejected for partial correction while carrier timing is absent', () => {
  const evidence = load('phase4-fresh-planning'), c = newCase('demo', evidence.docs, evidence.asOf);
  c.fields = evidence.fields; finishInvestigation(c); c.correspondence = evidence.correspondence;
  assert.equal(evidence.proposal.actions[0].dueDate, '2026-10-16');
  assert.throws(() => validateRecoveryPlan(c, evidence.proposal, evidence.statements), /unresolved timing/);
  const receipt = evidence.correspondence[0], bare = { ...c, correspondence: [], statements: [] };
  const input = recoveryPlannerInput(bare, receipt, { statements: evidence.statements, missing: ['No supported carrier B/L availability date.'] });
  assert.equal(input.correctionsPermitted, false); assert.deepEqual(input.allowedActionKinds, ['human_escalation', 'clarify_timing']);
  assert.deepEqual(input.outputContract.actionSchema.properties.kind.enum, input.allowedActionKinds);
  assert.deepEqual(input.outputContract.actionSchema.properties.dueDate.enum, [null]);
  assert.equal(validateRecoveryPlan(c, defaultCandidate(c, evidence.statements), evidence.statements).timing, 'unknown');
  c.statements = evidence.statements;
  const carrier = newCorrespondence(c, 'carrier', 'We will reissue the B/L on 2026-10-17.');
  const extraction = validateExtraction(c, carrier, { quotes: [carrier.text] });
  const complete = recoveryPlannerInput(c, carrier, extraction);
  assert.equal(complete.correctionsPermitted, true);
  assert.deepEqual(complete.allowedDueDatesByKind, { request_invoice: ['2026-10-16'], request_bl: ['2026-10-17'] });
  const statements = [...c.statements, ...extraction.statements]; c.correspondence.push(carrier);
  const correct = defaultCandidate(c, statements);
  assert.equal(validateRecoveryPlan(c, correct, statements).timing, 'feasible');
  assert.deepEqual(correct.actions.map(a => a.kind), ['request_invoice', 'request_bl', 'recheck']);
});
