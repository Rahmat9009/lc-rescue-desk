import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { newCase, parseFixture, finishInvestigation, transition, documentVersions } from '../lib/domain.ts';
import { newCorrespondence, validateExtraction, demoQuotes, defaultCandidate, applyCorrespondence, reassessSavedCorrespondence, versionKey } from '../lib/recovery.ts';
import { stageLcAssessment, selectLcBasis, dismissLcAssessment, sourceBinding, assessmentBinding, findingDelta, FreshInvestigationRequired } from '../lib/lc-updates.ts';

// Synthetic inputs independent of the application's demo. Calendar expectations below
// are handwritten: Oct 8 + 21 = Oct 29; Oct 8 + 30 = Nov 7.
function investigated({ expiry = '2026-10-12', days = '21', currency = 'USD', invoiceCurrency = 'EUR', consignee = 'ORDER OF TEST BANK', blConsignee = 'TEST BUYER' } = {}) {
  const docs = [
    { kind: 'lc', name: 'credit.txt', version: 1, synthetic: true, text: `SYNTHETIC\nreference: TEST-LC-7\ncurrency: ${currency}\nmax_amount: 60000\nconsignee: ${consignee}\nlatest_shipment: 2026-10-09\nexpiry: ${expiry}\npresentation_days: ${days}` },
    { kind: 'invoice', name: 'invoice-v1.txt', version: 1, synthetic: true, text: `SYNTHETIC\nreference: INV-7\nlc_reference: TEST-LC-7\ncurrency: ${invoiceCurrency}\namount: 48000` },
    { kind: 'bl', name: 'bl-v1.txt', version: 1, synthetic: true, text: `SYNTHETIC\nreference: BL-7\nlc_reference: TEST-LC-7\nconsignee: ${blConsignee}\nshipment_date: 2026-10-08` },
  ];
  const c = newCase('demo', docs, '2026-10-10');
  for (const doc of docs) c.fields[doc.kind] = parseFixture(doc);
  finishInvestigation(c);
  return c;
}
const asserted = { reviewer: 'Synthetic reviewer', at: '2026-10-10T09:00:00Z', completeText: true, note: 'I supply this complete text as the intended analysis basis.' };
function stageInput(c, changes = {}, id = 'assessment-1') {
  const lc = c.docs.find(d => d.kind === 'lc');
  let text = lc.text;
  for (const [field, value] of Object.entries(changes)) text = text.replace(new RegExp(`^${field}:.*$`, 'm'), `${field}: ${value}`);
  const candidate = { ...lc, text, name: 'credit-v2.txt', version: lc.version + 1 };
  return { revision: c.revision, assessmentId: id, candidate, extraction: { documentBinding: sourceBinding(candidate), fields: parseFixture(candidate) }, assertion: asserted, asOf: c.asOf };
}
function request(c) {
  const a = c.pendingLcAssessment;
  return { revision: c.revision, assessmentId: a.id, assessmentBinding: assessmentBinding(a), baseBinding: a.baseBinding, candidateBinding: a.candidateBinding };
}
function selectInput(c) { return { ...request(c), assertion: { ...asserted, selectForCoveredChecks: true, outsideCoverageReviewed: true }, asOf: c.asOf }; }
function business(c) {
  const { revision, events, pendingLcAssessment, lcAssessmentHistory, ...rest } = c;
  return rest;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
function receive(c, sender, text) {
  const receipt = newCorrespondence(c, sender, text), extraction = validateExtraction(c, receipt, demoQuotes(text));
  return applyCorrespondence(c, receipt, extraction, defaultCandidate(c, [...(c.statements || []), ...extraction.statements]));
}
function rejectWithoutMutation(c, operation, pattern) {
  const before = structuredClone(c);
  assert.throws(operation, pattern);
  assert.deepEqual(c, before);
}

test('genuine period change changes the independently calculated deadline and retains all quoted inputs', () => {
  const c = investigated({ expiry: '2026-11-20' });
  const n = stageLcAssessment(c, stageInput(c, { presentation_days: '30' }));
  const a = n.pendingLcAssessment;
  assert.equal(a.deadlines.before.date, '2026-10-29');
  assert.equal(a.deadlines.after.date, '2026-11-07');
  assert.equal(a.deadlines.after.shipmentPlusDays, '2026-11-07');
  assert.equal(a.deadlines.after.shipment.value, '2026-10-08');
  assert.equal(a.deadlines.after.shipment.quote, 'shipment_date: 2026-10-08');
  assert.equal(a.deadlines.after.expiry.quote, 'expiry: 2026-11-20');
  assert.equal(a.deadlines.after.presentationDays.quote, 'presentation_days: 30');
  assert.equal(a.deadlines.after.presentationDays.version, 2);
  assert.equal(a.deadlines.after.presentationDays.source, sourceBinding(a.candidate));
  assert.equal(a.outsideCoverage.unresolved, false);
});

test('extending expiry alone leaves an earlier shipment plus presentation deadline unchanged', () => {
  const c = investigated({ expiry: '2026-10-31' });
  const n = stageLcAssessment(c, stageInput(c, { expiry: '2026-11-20' }));
  assert.equal(n.pendingLcAssessment.deadlines.before.date, '2026-10-29');
  assert.equal(n.pendingLcAssessment.deadlines.after.date, '2026-10-29');
  const result = selectLcBasis(n, selectInput(n));
  assert.equal(result.case.deadline, '2026-10-29');
});

test('expiry extension changes an expiry-controlled deadline; staging leaves the active business state unchanged', () => {
  const c = transition(investigated(), { type: 'approve', revision: 0 });
  const before = structuredClone(c), input = stageInput(c, { expiry: '2026-10-20' });
  freeze(c); freeze(input);
  const staged = stageLcAssessment(c, input);
  assert.deepEqual(c, before);
  assert.deepEqual(business(staged), business(before));
  assert.equal(staged.pendingLcAssessment.deadlines.before.date, '2026-10-12');
  assert.equal(staged.pendingLcAssessment.deadlines.after.date, '2026-10-20');
  assert.equal(staged.deadline, '2026-10-12');
  assert.deepEqual(staged.pendingLcAssessment.affected.approval, c.approval);
  assert.deepEqual(staged.pendingLcAssessment.affected.plan, c.plan);
  assert.equal(staged.pendingLcAssessment.sources.previous.text, c.docs[0].text);
  assert.equal(staged.pendingLcAssessment.sources.proposed.text, input.candidate.text);
  rejectWithoutMutation(staged, () => transition(staged, { type: 'reply', reply: 'available', revision: staged.revision }), /pending LC assessment/);
  rejectWithoutMutation(staged, () => newCorrespondence(staged, 'carrier', 'We will reissue tomorrow.'), /pending LC assessment/);
});

test('selection requires a separate reviewer assertion and invalidates approval, reply assessment and timing evidence', () => {
  let c = investigated();
  c = receive(c, 'exporter', 'We will send the invoice on 2026-10-11.');
  c = receive(c, 'carrier', 'We will reissue the B/L on 2026-10-11.');
  c = transition(c, { type: 'approve', revision: c.revision });
  c.replyAssessment = { facts: ['Old facts'], assumptions: [], unconfirmed: [], nextHumanAction: 'Old next step' };
  const old = structuredClone(c), staged = stageLcAssessment(c, stageInput(c, { expiry: '2026-10-20' }));
  const invalid = selectInput(staged); invalid.assertion.selectForCoveredChecks = false;
  rejectWithoutMutation(staged, () => selectLcBasis(staged, invalid), /Explicit reviewer/);
  freeze(staged);
  const { case: n, followUp } = selectLcBasis(staged, selectInput(staged));
  assert.equal(n.approval, undefined);
  assert.equal(n.recoveryPlan, undefined);
  assert.equal(n.replyAssessment, undefined);
  assert.notDeepEqual(n.plan, old.plan);
  assert.equal(n.plan.earliestDate, '2026-10-11');
  assert.equal(n.status, 'stopped');
  assert.deepEqual(n.statements, []);
  assert.equal(n.lcUpdateRequirements.timingConfirmationRequired, true);
  assert.ok(followUp.includes('confirm_current_timing'));
  assert.deepEqual(n.correspondence, old.correspondence);
  assert.ok(n.correspondence.every(r => r.sourceVersions !== versionKey(n)));
  assert.deepEqual(n.lcAssessmentHistory.at(-1).previous.approval, old.approval);
  assert.deepEqual(n.lcAssessmentHistory.at(-1).previous.recoveryPlan, old.recoveryPlan);
  assert.deepEqual(n.lcAssessmentHistory.at(-1).previous.replyAssessment, old.replyAssessment);
  assert.deepEqual(n.priorAssessments.at(-1).statements, old.statements);
  rejectWithoutMutation(n, () => transition(n, { type: 'approve', revision: n.revision }), /LC basis follow-up/);
  rejectWithoutMutation(n, () => transition(n, { type: 'reply', reply: 'available', revision: n.revision }), /LC basis follow-up/);
});

test('a stopped case does not resume because old correspondence is now feasible; fresh evidence permits fresh approval and recheck', () => {
  let c = investigated();
  c = receive(c, 'exporter', 'We will send the invoice on 2026-10-12.');
  c = receive(c, 'carrier', 'We will reissue the B/L on 2026-10-16.');
  assert.equal(c.status, 'stopped'); assert.equal(c.recoveryPlan.timing, 'conflict');
  const staged = stageLcAssessment(c, stageInput(c, { expiry: '2026-10-20' }));
  let n = selectLcBasis(staged, selectInput(staged)).case;
  assert.equal(n.deadline, '2026-10-20'); assert.equal(n.status, 'stopped');
  assert.deepEqual(staged.pendingLcAssessment.affected.correspondence, c.correspondence);
  rejectWithoutMutation(n, () => reassessSavedCorrespondence(n), /earlier document versions/);
  const oldReceipt = c.correspondence[1];
  rejectWithoutMutation(n, () => applyCorrespondence(n, oldReceipt, { statements: c.statements, missing: [] }, defaultCandidate(c, c.statements)), /timing evidence bindings/);
  finishInvestigation(n); assert.equal(n.status, 'stopped');
  n = receive(n, 'exporter', 'We will send the invoice on 2026-10-12.');
  assert.equal(n.status, 'stopped');
  n = receive(n, 'carrier', 'We will reissue the B/L on 2026-10-16.');
  assert.equal(n.recoveryPlan.timing, 'feasible'); assert.equal(n.status, 'approval');
  assert.equal(n.lcUpdateRequirements.timingConfirmationRequired, false);
  assert.ok(n.recoveryPlan.actions.filter(a => a.kind.startsWith('request_')).every(a => a.evidenceRefs.some(ref => n.statements.some(s => ref === `statement:${s.id}`))));
  n = transition(n, { type: 'approve', revision: n.revision });
  assert.equal(n.approval.documentVersions, documentVersions(n));
  assert.equal(n.approval.planId, n.recoveryPlan.id);
  n = transition(n, { type: 'reply', reply: 'available', revision: n.revision });
  assert.equal(n.status, 'received');
  assert.equal(n.recoveryPlan, undefined); assert.equal(n.approval, undefined);
  assert.equal(n.lcUpdateRequirements.timingConfirmationRequired, true);
  const badReceived = structuredClone(n); // An issuer's next version can still contain an error.
  badReceived.docs[1].text = badReceived.docs[1].text.replace('currency: USD', 'currency: EUR');
  badReceived.lcUpdateRequirements.documentVersions = documentVersions(badReceived);
  for (const doc of badReceived.docs) badReceived.fields[doc.kind] = parseFixture(doc);
  finishInvestigation(badReceived);
  assert.equal(badReceived.status, 'stopped');
  assert.equal(badReceived.findings[0].id, 'invoice.currency');
  assert.equal(badReceived.plan.documentVersions, documentVersions(badReceived));
  rejectWithoutMutation(badReceived, () => transition(badReceived, { type: 'approve', revision: badReceived.revision }), /LC basis follow-up/);
  for (const doc of n.docs) n.fields[doc.kind] = parseFixture(doc);
  finishInvestigation(n);
  assert.equal(n.status, 'reviewed'); assert.deepEqual(n.findings, []);
  assert.equal(n.lcUpdateRequirements.timingConfirmationRequired, false);
  assert.deepEqual(n.correspondence.slice(0, 2), c.correspondence);
});

test('wrong reference, partial advice, ungrounded evidence, invalid dates, numeric ambiguity and unsupported flags are rejected atomically', () => {
  const c = investigated();
  for (const [changes, pattern] of [
    [{ reference: 'OTHER-LC' }, /reference must match/],
    [{ expiry: '2026-02-30' }, /Invalid or ambiguous date/],
    [{ expiry: '2026-10-20 or 2026-11-20' }, /Ambiguous/],
    [{ presentation_days: '21 or 30' }, /Ambiguous/],
    [{ presentation_days: '0' }, /numeric/],
    [{ presentation_days: '366' }, /Unsupported presentation/],
    [{ max_amount: '9'.repeat(200) }, /numeric/],
    [{ currency: 'USD or EUR' }, /Ambiguous/],
  ]) {
    const input = stageInput(c, changes);
    rejectWithoutMutation(c, () => stageLcAssessment(c, input), pattern);
  }
  let input = stageInput(c); delete input.extraction.fields.expiry;
  rejectWithoutMutation(c, () => stageLcAssessment(c, input), /Missing grounded/);
  input = stageInput(c); input.extraction.fields.currency.quote = 'INVENTED currency: USD';
  rejectWithoutMutation(c, () => stageLcAssessment(c, input), /does not support/);
  input = stageInput(c); input.extraction.fields.success = true;
  rejectWithoutMutation(c, () => stageLcAssessment(c, input), /unsupported extraction/);
  input = stageInput(c); input.candidate.text = 'expiry: 2026-10-20'; input.extraction = { documentBinding: sourceBinding(input.candidate), fields: parseFixture(input.candidate) };
  rejectWithoutMutation(c, () => stageLcAssessment(c, input), /Missing grounded/);
  input = stageInput(c); input.assertion = { ...asserted, completeText: false };
  rejectWithoutMutation(c, () => stageLcAssessment(c, input), /reviewer assertion/);
});

test('complete quotes cannot conceal alternate dates, duplicate terms or substring values', () => {
  const c = investigated();
  for (const [line, fields] of [
    ['expiry: 2026-10-20, revised 2026-11-20', { expiry: { value: '2026-10-20', quote: 'expiry: 2026-10-20, revised 2026-11-20' } }],
    ['presentation_days: 210', { presentation_days: { value: '21', quote: 'presentation_days: 210' } }],
    ['expiry: 2026-10-20\nexpiry: 2026-11-20', {}],
  ]) {
    const input = stageInput(c);
    const key = line.split(':')[0]; input.candidate.text = input.candidate.text.replace(new RegExp(`^${key}:.*$`, 'm'), line);
    input.extraction = { documentBinding: sourceBinding(input.candidate), fields: { ...parseFixture(input.candidate), ...fields } };
    rejectWithoutMutation(c, () => stageLcAssessment(c, input), /ambiguous|Ambiguous/);
  }
  const input = stageInput(c); input.extraction.fields.expiry.quote = '2026-10-12';
  rejectWithoutMutation(c, () => stageLcAssessment(c, input), /incomplete source quotation/);
  const mislabeled = stageInput(c);
  mislabeled.extraction.fields.expiry = { value: '2026-10-09', quote: 'latest_shipment: 2026-10-09' };
  rejectWithoutMutation(c, () => stageLcAssessment(c, mislabeled), /does not match the expiry field label/);
});

test('saved invoice and B/L fields are reused only with provable current grounding, or explicitly bound fresh fields', () => {
  const c = investigated(); c.docs[1].text = c.docs[1].text.replace('currency: EUR', 'currency: USD');
  const input = stageInput(c);
  rejectWithoutMutation(c, () => stageLcAssessment(c, input), FreshInvestigationRequired);
  try { stageLcAssessment(c, input); } catch (e) { assert.deepEqual(e.documents, ['invoice']); }
  input.documentEvidence = { invoice: { documentBinding: sourceBinding(c.docs[1]), fields: parseFixture(c.docs[1]) } };
  const n = stageLcAssessment(c, input);
  assert.equal(n.pendingLcAssessment.fields.invoice.currency.value, 'USD');
  assert.equal(n.fields.invoice.currency.value, 'EUR'); // staging never repairs active analysis implicitly
  input.documentEvidence.invoice.documentBinding = 'stale';
  rejectWithoutMutation(c, () => stageLcAssessment(c, input), /Stale extraction/);
  const missing = investigated(); delete missing.fields.bl.shipment_date;
  rejectWithoutMutation(missing, () => stageLcAssessment(missing, stageInput(missing)), FreshInvestigationRequired);
});

test('stale revisions, candidates, assessments, active documents and active decisions are rejected without mutations', () => {
  const c = investigated(), input = stageInput(c);
  const staleExtraction = structuredClone(input); staleExtraction.candidate.text += '\nExtra clause';
  rejectWithoutMutation(c, () => stageLcAssessment(c, staleExtraction), /Stale extraction/);
  const staged = stageLcAssessment(c, input), valid = selectInput(staged);
  for (const changes of [{ revision: -1 }, { assessmentId: 'wrong' }, { candidateBinding: 'wrong' }, { baseBinding: 'wrong' }, { assessmentBinding: 'wrong' }])
    rejectWithoutMutation(staged, () => selectLcBasis(staged, { ...valid, ...changes }), /changed|Stale/);
  for (const mutate of [n => n.docs[1].text += '\nchanged', n => n.docs[2].version++, n => n.plan.earliestDate = '2026-10-15', n => n.findings[0].actual = 'changed', n => n.pendingLcAssessment.candidate.text += '\nchanged']) {
    const n = structuredClone(staged); mutate(n);
    rejectWithoutMutation(n, () => selectLcBasis(n, valid), /Stale/);
  }
  const newer = stageLcAssessment(staged, stageInput(staged, { expiry: '2026-10-20' }, 'assessment-2'));
  assert.equal(newer.lcAssessmentHistory.at(-1).outcome, 'superseded');
  rejectWithoutMutation(newer, () => selectLcBasis(newer, valid), /changed/);
  assert.equal(selectLcBasis(newer, selectInput(newer)).case.deadline, '2026-10-20');
});

test('same finding identifier with changed expected or actual values is materially changed, not persistent', () => {
  const c = investigated();
  const n = stageLcAssessment(c, stageInput(c, { currency: 'EUR', consignee: 'ORDER OF SECOND BANK' }));
  const delta = n.pendingLcAssessment.findings;
  assert.deepEqual(delta.resolved.map(f => f.id), ['invoice.currency']);
  assert.deepEqual(delta.persistent, []);
  assert.equal(delta.materiallyChanged[0].before.id, 'bl.consignee');
  assert.equal(delta.materiallyChanged[0].before.expected, 'ORDER OF TEST BANK');
  assert.equal(delta.materiallyChanged[0].after.expected, 'ORDER OF SECOND BANK');
  const actual = findingDelta(c.findings, c.findings.map(f => ({ ...f, actual: 'CHANGED' })));
  assert.equal(actual.materiallyChanged.length, 2);
  const persistent = stageLcAssessment(c, stageInput(c, { expiry: '2026-10-20' })).pendingLcAssessment.findings;
  assert.equal(persistent.persistent.length, 2);
  const clean = investigated({ currency: 'EUR', blConsignee: 'ORDER OF TEST BANK' });
  const newFinding = stageLcAssessment(clean, stageInput(clean, { currency: 'USD' })).pendingLcAssessment.findings.new;
  assert.deepEqual(newFinding.map(f => f.id), ['invoice.currency']);
});

test('unsupported changed clauses remain explicitly unresolved even when covered checks pass and external review is asserted', () => {
  const c = investigated({ currency: 'EUR', blConsignee: 'ORDER OF TEST BANK' });
  const input = stageInput(c, { expiry: '2026-10-20' });
  input.candidate.text += '\nRequire an insurance certificate and two signed originals.';
  input.extraction.documentBinding = sourceBinding(input.candidate);
  const staged = stageLcAssessment(c, input), a = staged.pendingLcAssessment;
  assert.equal(a.outsideCoverage.unresolved, true);
  assert.match(a.outsideCoverage.proposedRemainder, /insurance certificate/);
  assert.equal(a.findings.new.length, 0);
  const { case: n, followUp } = selectLcBasis(staged, selectInput(staged));
  assert.equal(n.findings.length, 0); assert.equal(n.status, 'stopped');
  assert.equal(n.lcUpdateRequirements.outsideCoverageUnresolved, true);
  assert.ok(followUp.includes('review_outside_coverage'));
  finishInvestigation(n); assert.equal(n.status, 'stopped');
  const again = stageLcAssessment(n, stageInput(n, { expiry: '2026-10-25' }, 'assessment-2'));
  assert.equal(again.pendingLcAssessment.outsideCoverage.unresolved, true);
});

test('a broad covered-field quote cannot hide an unsupported requirement added on the same line', () => {
  const c = investigated(), input = stageInput(c);
  const quote = 'consignee: ORDER OF TEST BANK; insurance certificate required';
  input.candidate.text = input.candidate.text.replace('consignee: ORDER OF TEST BANK', quote);
  input.extraction = { documentBinding: sourceBinding(input.candidate), fields: { ...parseFixture(input.candidate), consignee: { value: 'ORDER OF TEST BANK', quote } } };
  const n = stageLcAssessment(c, input);
  assert.equal(n.pendingLcAssessment.outsideCoverage.unresolved, true);
  assert.match(n.pendingLcAssessment.outsideCoverage.proposedRemainder, /insurance certificate required/);
});

test('uncovered changes cannot be bypassed through newly feasible recovery timing', () => {
  const c = investigated(), input = stageInput(c, { expiry: '2026-10-20' });
  input.candidate.text += '\nInsurance required.'; input.extraction.documentBinding = sourceBinding(input.candidate);
  const staged = stageLcAssessment(c, input); let n = selectLcBasis(staged, selectInput(staged)).case;
  n = receive(n, 'exporter', 'We will send the invoice on 2026-10-12.');
  n = receive(n, 'carrier', 'We will reissue the B/L on 2026-10-16.');
  assert.equal(n.recoveryPlan.timing, 'feasible'); assert.equal(n.status, 'stopped');
  rejectWithoutMutation(n, () => transition(n, { type: 'approve', revision: n.revision }), /LC basis follow-up/);
});

test('selection recalculates findings on the supplied current date, rather than trusting the staged decision', () => {
  const c = investigated({ currency: 'EUR', blConsignee: 'ORDER OF TEST BANK' });
  const staged = stageLcAssessment(c, stageInput(c, { expiry: '2026-10-20' }));
  const result = selectLcBasis(staged, { ...selectInput(staged), asOf: '2026-10-21' });
  assert.equal(result.case.status, 'stopped');
  assert.equal(result.case.deadline, '2026-10-20');
  assert.equal(result.case.findings[0].title, 'Calculated presentation deadline passed');
  assert.equal(result.case.findings[0].actual, '2026-10-21');
  assert.ok(result.followUp.includes('specialist_review'));
});

test('a new timing conflict after fresh confirmation cannot be erased by reinvestigating the selected basis', () => {
  const c = investigated(), staged = stageLcAssessment(c, stageInput(c, { expiry: '2026-10-20' }));
  let n = selectLcBasis(staged, selectInput(staged)).case;
  n = receive(n, 'exporter', 'We will send the invoice on 2026-10-12.');
  n = receive(n, 'carrier', 'We will reissue the B/L on 2026-10-16.');
  assert.equal(n.status, 'approval');
  n = receive(n, 'carrier', 'We will reissue the B/L on 2026-10-22.');
  assert.equal(n.status, 'stopped'); assert.equal(n.lcUpdateRequirements.timingConfirmationRequired, true);
  finishInvestigation(n); assert.equal(n.status, 'stopped');
  rejectWithoutMutation(n, () => transition(n, { type: 'approve', revision: n.revision }), /LC basis follow-up/);
});

test('a pending assessment survives a JSON snapshot round trip with its exact selection bindings', () => {
  const c = investigated({ currency: 'EUR', blConsignee: 'ORDER OF TEST BANK' });
  const staged = stageLcAssessment(c, stageInput(c, { expiry: '2026-10-20' }));
  const saved = JSON.parse(JSON.stringify(staged));
  const { case: n, followUp } = selectLcBasis(saved, selectInput(staged));
  assert.equal(n.status, 'reviewed'); assert.equal(n.deadline, '2026-10-20');
  assert.equal(n.approval, undefined); assert.equal(n.plan, undefined);
  assert.deepEqual(followUp, ['full_presentation_review']);
});

test('dismissal preserves the original business case and retains both sources, assessment and audit event', () => {
  const c = transition(investigated(), { type: 'approve', revision: 0 });
  const staged = stageLcAssessment(c, stageInput(c, { expiry: '2026-10-20' }));
  const before = structuredClone(staged); freeze(staged);
  const n = dismissLcAssessment(staged, { ...request(staged), reviewer: asserted.reviewer, at: asserted.at });
  assert.deepEqual(staged, before); assert.deepEqual(business(n), business(c));
  assert.equal(n.pendingLcAssessment, undefined); assert.equal(n.lcAssessmentHistory.at(-1).outcome, 'dismissed');
  assert.deepEqual(n.lcAssessmentHistory.at(-1).assessment, staged.pendingLcAssessment);
  assert.equal(n.events.at(-1).title, 'Revised LC assessment dismissed');
  rejectWithoutMutation(n, () => selectLcBasis(n, selectInput(staged)), /changed/);
  assert.equal(transition(n, { type: 'reply', reply: 'available', revision: n.revision }).status, 'received');
});

test('legacy snapshots without optional LC update fields still complete their existing workflow and can stage an update', () => {
  let c = JSON.parse(JSON.stringify(investigated()));
  for (const key of ['pendingLcAssessment', 'lcAssessmentHistory', 'lcUpdateRequirements']) assert.equal(Object.hasOwn(c, key), false);
  assert.equal(stageLcAssessment(c, stageInput(c, { expiry: '2026-10-20' })).pendingLcAssessment.candidate.version, 2);
  c = transition(c, { type: 'approve', revision: c.revision });
  c = transition(c, { type: 'reply', reply: 'available', revision: c.revision });
  for (const doc of c.docs) c.fields[doc.kind] = parseFixture(doc);
  finishInvestigation(c); assert.equal(c.status, 'reviewed');
});

test('previous source versions remain available for historical findings after selection and serialization', () => {
  const c = investigated({ expiry: '2026-10-09' });
  assert.equal(c.findings.find(f => f.id === 'lc.expiry').quote, 'expiry: 2026-10-09');
  const staged = stageLcAssessment(c, stageInput(c, { expiry: '2026-10-20' }));
  const n = JSON.parse(JSON.stringify(selectLcBasis(staged, selectInput(staged)).case));
  const previous = n.lcAssessmentHistory.at(-1).previous;
  assert.equal(n.docs[0].version, 2);
  for (const finding of previous.findings) {
    const source = previous.docs.find(doc => doc.kind === finding.doc);
    assert.ok(source.text.includes(finding.quote));
    assert.ok(n.history.some(doc => sourceBinding(doc) === sourceBinding(source)));
  }
  assert.ok(n.history.find(doc => doc.kind === 'lc' && doc.version === 1).text.includes('expiry: 2026-10-09'));
  assert.equal(previous.deadline, '2026-10-09');
});

test('LC update helpers have no model, network or telemetry dependencies or calls on success, rejection or dismissal', () => {
  let calls = 0;
  const fetchMock = mock.method(globalThis, 'fetch', () => { calls++; throw new Error('Unexpected outbound call'); });
  try {
    const c = investigated(); c.modelRuns = 17; c.usage = { input: 900, output: 120, missing: 3 };
    const input = stageInput(c, { expiry: '2026-10-20' });
    const n = stageLcAssessment(c, input);
    const selected = selectLcBasis(n, selectInput(n)).case;
    dismissLcAssessment(n, { ...request(n), reviewer: asserted.reviewer, at: asserted.at });
    assert.throws(() => stageLcAssessment(c, stageInput(c, { reference: 'OTHER' })));
    assert.throws(() => selectLcBasis(n, { ...selectInput(n), candidateBinding: 'stale' }));
    assert.equal(calls, 0); assert.equal(selected.modelRuns, c.modelRuns); assert.deepEqual(selected.usage, c.usage);
    // Check the entire emitted runtime import closure, excluding erased type-only imports.
    // Fetch interception plus this boundary check prevents a hidden model/export dependency.
    const ts = createRequire(import.meta.url)('typescript');
    for (const file of ['lc-updates', 'domain', 'recovery', 'source-grounding']) {
      const emitted = ts.transpileModule(readFileSync(new URL(`../lib/${file}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
      const imports = ts.preProcessFile(emitted).importedFiles.map(f => f.fileName);
      assert.deepEqual([...new Set(imports)].sort(), file === 'lc-updates' ? ['./domain.ts', './source-grounding.ts'] : file === 'domain' ? [] : ['./domain.ts']);
      assert.doesNotMatch(emitted, /\bfetch\s*\(|\bimport\s*\(|\brequire\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/);
    }
  } finally { fetchMock.mock.restore(); }
});
