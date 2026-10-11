import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newCase, parseFixture, finishInvestigation, transition, documentVersions, replyCoordinatorFields, validateReplyAssessment } from '../lib/domain.ts';

function receipt() {
  const saved = JSON.parse(readFileSync(new URL('./fixtures/phase4-selected-recovery.json', import.meta.url), 'utf8'));
  const c = newCase('live', saved.docs, '2026-10-11');
  c.fields = Object.fromEntries(c.docs.map(d => [d.kind, parseFixture(d)]));
  finishInvestigation(c);
  c.plan.documentVersions = documentVersions(c);
  c.lcUpdateRequirements = { documentVersions: documentVersions(c), timingConfirmationRequired: false, specialistReviewRequired: false, outsideCoverageUnresolved: false, draftingRequired: false };
  const approved = transition(c, { type: 'approve', revision: c.revision });
  const docs = c.docs.filter(d => d.kind !== 'lc').map(d => ({ ...d, name: d.name.replace('v1', 'SYNTHETIC-REVISED-v2'), text: d.text.replace('currency: EUR', 'currency: USD').replace('consignee: SYNTHETIC BUYER LTD', 'consignee: TO ORDER OF SYNTHETIC TEST BANK') }));
  const action = { type: 'reply', reply: 'available', revision: approved.revision, docs };
  return { approved, action, received: transition(approved, action) };
}

test('selected synthetic LC receipt supplies the complete exact coordinator object and leaves conflicts for separate recheck', () => {
  const { approved, action, received } = receipt();
  const fields = replyCoordinatorFields(received, action);
  assert.deepEqual(fields, { replyScenario: 'available', resultingStatus: 'received', calculatedDeadline: '2026-10-21', earliestAvailability: '2026-10-12', invoiceVersion: 2, blVersion: 2, documentsReceived: true, timelineBasis: 'assumption', carrierCommitment: 'unconfirmed', issuerAuthenticity: 'unconfirmed', bankAcceptance: 'unconfirmed', nextHumanAction: 'recheck' });
  const assessment = validateReplyAssessment(received, action, structuredClone(fields));
  assert.match(assessment.nextHumanAction, /Recheck/);
  assert.ok(assessment.unconfirmed.some(s => s.includes('authenticity')));
  assert.deepEqual(received.docs.map(d => d.version), [2, 2, 2]);
  assert.deepEqual(received.findings, approved.findings);
  assert.equal(received.findings.length, 2);
  assert.deepEqual(approved.docs.map(d => d.version), [2, 1, 1]);
  assert.equal(approved.approval.documentVersions, documentVersions(approved));
});

test('receipt contract rejects missing flags, altered facts/types, extra claims without mutating received evidence', () => {
  const { action, received } = receipt(), before = structuredClone(received);
  const exact = replyCoordinatorFields(received, action);
  for (const [key, value] of [['timelineBasis', undefined], ['calculatedDeadline', '2026-10-22'], ['invoiceVersion', '2'], ['issuerAuthenticity', 'confirmed'], ['bankAcceptance', 'confirmed'], ['nextHumanAction', 'reviewed']]) {
    const invalid = { ...exact, [key]: value }; if (value === undefined) delete invalid[key];
    assert.throws(() => validateReplyAssessment(received, action, invalid), e => e.status === 502 && e.message.includes(`Mismatched or missing fields: ${key}`));
  }
  const invalid = { ...exact, SECRET_PROVIDER_KEY: 'SECRET_PROVIDER_VALUE' };
  assert.throws(() => validateReplyAssessment(received, action, invalid), e => e.status === 502 && e.message.includes('Unsupported extra fields: 1') && !e.message.includes('SECRET_PROVIDER'));
  assert.deepEqual(received, before);
});
