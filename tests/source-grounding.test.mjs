import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newCase, finishInvestigation, parseFixture } from '../lib/domain.ts';
import { checkedFields, groundingIssues, normalizeSourceLines, sourceBinding } from '../lib/source-grounding.ts';
import { currentGroundedFields, stageLcAssessment, selectLcBasis, assessmentBinding, FreshInvestigationRequired } from '../lib/lc-updates.ts';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/phase4-grounding.json', import.meta.url), 'utf8'));
function saved() { const c = newCase('live', structuredClone(fixture.docs), fixture.asOf); c.fields = structuredClone(fixture.fields); finishInvestigation(c); return c; }

test('observed Phase 4 bare quotations fail all eight strict invoice/B/L line checks for the exact reason', () => {
  for (const doc of fixture.docs.filter(d => d.kind !== 'lc')) {
    const issues = groundingIssues(doc, fixture.fields[doc.kind]);
    assert.deepEqual(issues.map(i => i.field), Object.keys(fixture.fields[doc.kind]));
    assert.ok(issues.every(i => i.reason === `Ambiguous or incomplete source quotation for ${i.field}.`));
    for (const item of Object.values(fixture.fields[doc.kind])) assert.equal(doc.text.split('\n').filter(line => line === item.quote).length, 0);
    assert.equal(doc.text.split('\n').filter(line => line.includes(fixture.fields[doc.kind].lc_reference.quote)).length, 2);
    assert.throws(() => checkedFields(doc, fixture.fields[doc.kind]), /Ambiguous or incomplete/);
  }
});

test('observed quotations normalize to one strictly supporting line with original quotes and exact versions retained', () => {
  for (const doc of fixture.docs) {
    const n = normalizeSourceLines(doc, fixture.fields[doc.kind], sourceBinding(doc));
    assert.deepEqual(n.originalFields, fixture.fields[doc.kind]);
    assert.deepEqual(checkedFields(doc, n.fields), n.fields);
    assert.equal(n.version, 1);
    for (const [key, e] of Object.entries(n.evidence)) {
      assert.equal(e.providerQuote, fixture.fields[doc.kind][key].quote);
      assert.equal(e.sourceLine, doc.text.split('\n')[e.lineNumber - 1]);
      assert.equal(e.version, doc.version);
    }
    if (doc.kind !== 'lc') assert.equal(n.evidence.lc_reference.sourceLine, 'lc_reference: PHASE4-VERIFY-20261011-174225');
  }
});

test('normalization rejects ambiguous supporting lines, unsupported values, wrong labels and stale source versions', () => {
  const doc = structuredClone(fixture.docs[1]), fields = structuredClone(fixture.fields.invoice);
  const duplicate = { ...doc, text: doc.text + '\ncurrency: EUR' };
  assert.throws(() => normalizeSourceLines(duplicate, fields, sourceBinding(duplicate)), /unique strictly supporting/);
  const unsupported = structuredClone(fields); unsupported.amount.value = '49000';
  assert.throws(() => normalizeSourceLines(doc, unsupported, sourceBinding(doc)), /does not support/);
  const wrong = structuredClone(fields); wrong.reference = { value: 'PHASE4-VERIFY-20261011-174225', quote: 'lc_reference: PHASE4-VERIFY-20261011-174225' };
  assert.throws(() => normalizeSourceLines(doc, wrong, sourceBinding(doc)), /unique strictly supporting/);
  assert.throws(() => normalizeSourceLines({ ...doc, version: 2 }, fields, sourceBinding(doc)), e => e.status === 409);
  assert.throws(() => normalizeSourceLines({ ...doc, version: 0 }, fields, sourceBinding(doc)), /Invalid extraction source version/);
  const alternative = { ...doc, text: doc.text.replace('currency: EUR', 'currency: EUR or USD') };
  assert.throws(() => normalizeSourceLines(alternative, fields, sourceBinding(alternative)), /unique strictly supporting/);
});

test('legacy saved case stages and selects while preserving provider extracts, previous analysis and original decisions', () => {
  const c = saved(), before = structuredClone(c), candidate = { ...c.docs[0], version: 2, name: 'synthetic-revised.txt', text: c.docs[0].text.replace('expiry: 2026-10-15', 'expiry: 2026-10-21') };
  const assertion = { reviewer: 'Synthetic', completeText: true, at: '2026-10-11T18:00:00Z', note: 'Complete synthetic version for covered checks only.' };
  const n = stageLcAssessment(c, { revision: c.revision, assessmentId: 'normalization-test', candidate, extraction: { documentBinding: sourceBinding(candidate), fields: parseFixture(candidate) }, assertion, asOf: c.asOf });
  assert.deepEqual(c, before); assert.deepEqual(n.fields, c.fields); assert.deepEqual(n.plan, c.plan);
  assert.equal(n.pendingLcAssessment.deadlines.after.date, '2026-10-21');
  const a = n.pendingLcAssessment;
  const selected = selectLcBasis(n, { revision: n.revision, assessmentId: a.id, assessmentBinding: assessmentBinding(a), baseBinding: a.baseBinding, candidateBinding: a.candidateBinding, assertion: { ...assertion, selectForCoveredChecks: true, outsideCoverageReviewed: true }, asOf: c.asOf }).case;
  assert.equal(selected.deadline, '2026-10-21'); assert.equal(selected.status, 'stopped');
  assert.equal(selected.lcUpdateRequirements.timingConfirmationRequired, true);
  assert.deepEqual(selected.lcAssessmentHistory[0].previous.fields, fixture.fields);
  assert.deepEqual(selected.extractionHistory.find(r => r.kind === 'invoice').originalFields, fixture.fields.invoice);
  assert.deepEqual(currentGroundedFields(JSON.parse(JSON.stringify(selected))).invoice, selected.fields.invoice);
  const next = { ...candidate, version: 3, text: candidate.text.replace('expiry: 2026-10-21', 'expiry: 2026-10-22') };
  const stagedAgain = stageLcAssessment(selected, { revision: selected.revision, assessmentId: 'normalization-again', candidate: next, extraction: { documentBinding: sourceBinding(next), fields: parseFixture(next) }, assertion, asOf: c.asOf });
  assert.equal(stagedAgain.pendingLcAssessment.sourceGrounding.previous.invoice.evidence.currency.providerQuote, 'EUR');
  assert.equal(stagedAgain.pendingLcAssessment.sourceGrounding.previous.invoice.evidence.currency.sourceLine, 'currency: EUR');
});

test('an explicit saved extraction binding from an earlier document version cannot authorize cached reuse', () => {
  const c = saved(), doc = c.docs[1];
  c.extractionHistory = [{ documentBinding: sourceBinding(doc), kind: 'invoice', version: 1, originalFields: c.fields.invoice, at: '2026-10-11T17:00:00Z', origin: 'investigator' }];
  c.docs[1] = { ...doc, version: 2 };
  assert.throws(() => currentGroundedFields(c), e => e instanceof FreshInvestigationRequired && e.documents.join(',') === 'invoice');
  c.docs[1] = doc; c.extractionHistory[0].version = 2;
  assert.throws(() => currentGroundedFields(c), e => e instanceof FreshInvestigationRequired && e.documents.join(',') === 'invoice');
});
