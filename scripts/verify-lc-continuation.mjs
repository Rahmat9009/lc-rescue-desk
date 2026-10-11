// Continue only the retained Phase 4 synthetic case. No investigation restart or retries.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const output = 'output/playwright', path = `${output}/phase4-continuation-ledger.json`;
if (existsSync(path)) throw new Error('Continuation already recorded; do not repeat successful calls.');
const earlier = JSON.parse(readFileSync(`${output}/phase4-live-ledger.json`, 'utf8'));
const origin = 'http://127.0.0.1:5173', expectedDeadline = '2026-10-21';
const expected = { shipment: '2026-10-11', presentationDays: 21, shipmentPlusPresentation: '2026-11-01', originalExpiry: '2026-10-15', selectedExpiry: '2026-10-21', selectedDeadline: expectedDeadline, freshExporterDate: '2026-10-16', freshCarrierDate: '2026-10-17', basePlannedNewCalls: 11, maximumPlannedNewCalls: 13 };
const ledger = { caseId: earlier.caseId, reference: earlier.reference, expected, startedAt: new Date().toISOString(), steps: [], persistedTraceReadback: false };
let c, payload, original;
const binding = c => c.docs.map(d => `${d.kind}:${d.version}:${d.text}`).join('\n');
const versions = c => c.docs.map(d => ({ kind: d.kind, version: d.version }));
const save = () => { writeFileSync(path, JSON.stringify(ledger, null, 2)); if (c) writeFileSync(`${output}/phase4-continuation-case.json`, JSON.stringify(c, null, 2)); };
async function request(body) {
  const response = await fetch(`${origin}/api/cases/${ledger.caseId}`, { method: body ? 'POST' : 'GET', headers: { Cookie: '__sites_local_auth=1', Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(300000) });
  return { status: response.status, ...await response.json() };
}
async function step(label, action, plannedCalls, check) {
  const before = structuredClone(c), startedAt = new Date().toISOString();
  console.log(`Starting ${label}; planned calls ${plannedCalls}.`);
  payload = await request({ revision: c.revision, ...action });
  c = payload.case ?? (await request()).case;
  const events = c.events.slice(before.events.length), attempts = c.modelAttempts ?? c.modelRuns;
  const item = { label, action: action.type, startedAt, endedAt: new Date().toISOString(), httpStatus: payload.status, revision: c.revision, status: c.status, sourceVersions: versions(c), deadline: c.deadline, approvalPresent: !!c.approval, findingIds: c.findings.map(f => f.id), assessmentId: payload.operation?.assessmentId ?? c.lcAssessmentHistory?.at(-1)?.assessment.id, followUp: payload.followUp, plannedCalls, actualAttempts: attempts - (before.modelAttempts ?? before.modelRuns), parsedProviderResponses: c.modelRuns - before.modelRuns, usage: { input: c.usage.input - before.usage.input, output: c.usage.output - before.usage.output, missing: c.usage.missing - before.usage.missing }, runs: [...new Set(events.map(e => e.run).filter(Boolean))], receipts: events.filter(e => e.actor === 'Telemetry').map(e => ({ title: e.title, detail: e.detail, run: e.run, traceId: e.detail.match(/Neatlogs trace ID ([a-f0-9]{32})/)?.[1] })), failures: events.filter(e => ['Live action failed', 'LC assessment failed', 'Drafting failed after LC selection', 'Recovery planning rejected'].includes(e.title)).map(e => ({ title: e.title, detail: e.detail })), ...(payload.error ? { error: payload.error, code: payload.code } : {}) };
  ledger.steps.push(item); save();
  assert.equal(payload.status, 200, `${label}: ${payload.error}`);
  assert.equal(item.failures.length, 0, `${label}: saved failure; no retry`);
  const allowedRepair = action.type === 'correspondence' ? 1 : 0;
  assert.ok(item.actualAttempts >= plannedCalls && item.actualAttempts <= plannedCalls + allowedRepair, `${label}: unexpected attempt count`);
  assert.equal(item.parsedProviderResponses, item.actualAttempts, `${label}: provider failure`);
  check(c, before); item.assertionsPassed = true; save();
  console.log(`Completed ${label}: revision ${c.revision}, ${c.status}, ${item.actualAttempts} attempts.`);
}
try {
  const read = await request(); assert.equal(read.status, 200); c = read.case;
  assert.equal(c.id, 'c931202a-076f-4ea1-b661-41685c9a33c9'); assert.equal(c.fields.lc.reference.value, earlier.reference);
  assert.equal(c.mode, 'live'); assert.equal(c.revision, 2); assert.deepEqual(c.docs.map(d => d.version), [1, 1, 1]);
  assert.equal(c.pendingLcAssessment, undefined); assert.equal(c.deadline, '2026-10-15');
  original = structuredClone(c); ledger.baseRevision = c.revision; ledger.baseModelRuns = c.modelRuns; ledger.baseAttempts = c.modelAttempts ?? c.modelRuns; ledger.baseUsage = c.usage; save();
  const oldLc = c.docs.find(d => d.kind === 'lc');
  assert.equal(oldLc.text.split('expiry: 2026-10-15').length, 2);
  const candidate = { name: `${earlier.reference}-LC-v2.txt`, text: oldLc.text.replace('expiry: 2026-10-15', 'expiry: 2026-10-21') };
  await step('Stage complete same-reference candidate', { type: 'stage_lc', candidate, assertion: { completeText: true, note: 'Authorized synthetic verification supplies the complete revised LC for covered checks. Only expiry changes.' } }, 1, (n, old) => {
    for (const key of ['docs', 'fields', 'findings', 'plan', 'approval', 'correspondence', 'status', 'deadline']) assert.deepEqual(n[key], old[key], `Staging changed active ${key}`);
    assert.equal(n.pendingLcAssessment.deadlines.before.date, '2026-10-15'); assert.equal(n.pendingLcAssessment.deadlines.after.date, expectedDeadline); assert.equal(n.pendingLcAssessment.outsideCoverage.unresolved, false);
    assert.equal(n.pendingLcAssessment.sourceGrounding.previous.invoice.evidence.currency.providerQuote, 'EUR');
    assert.equal(n.pendingLcAssessment.sourceGrounding.previous.invoice.evidence.currency.sourceLine, 'currency: EUR');
  });
  await step('Explicitly select covered analysis basis', { type: 'select_lc', ...payload.lcAssessmentRequest, assertion: { completeText: true, selectForCoveredChecks: true, outsideCoverageReviewed: true, note: 'Authorized synthetic reviewer selects this complete version for covered checks only. Unchanged uncovered text reviewed; no legal acceptance or authenticity established.' } }, 0, n => {
    assert.deepEqual(n.docs.map(d => d.version), [2, 1, 1]); assert.equal(n.deadline, expectedDeadline); assert.equal(n.approval, undefined); assert.equal(n.status, 'stopped'); assert.equal(n.lcUpdateRequirements.timingConfirmationRequired, true); assert.equal(n.lcUpdateRequirements.draftingRequired, true);
    assert.deepEqual(n.lcAssessmentHistory.at(-1).previous.fields, original.fields); assert.deepEqual(n.lcAssessmentHistory.at(-1).previous.plan, original.plan); assert.deepEqual(n.lcAssessmentHistory.at(-1).previous.approval, original.approval);
    assert.ok(n.history.some(d => d.kind === 'lc' && d.version === 1 && d.text === original.docs[0].text));
    assert.equal(n.statements.length, 0); assert.deepEqual(n.correspondence, original.correspondence);
    assert.equal(n.extractionHistory.find(r => r.kind === 'invoice').originalFields.currency.quote, 'EUR');
  });
  await step('Fresh exporter correspondence', { type: 'correspondence', sender: 'exporter', text: 'Synthetic exporter: We will send the corrected invoice on 2026-10-16.' }, 2, n => { assert.equal(n.status, 'stopped'); assert.equal(n.lcUpdateRequirements.timingConfirmationRequired, true); });
  await step('Fresh carrier correspondence and current drafts', { type: 'correspondence', sender: 'carrier', text: 'Synthetic carrier: We will reissue the B/L on 2026-10-17.' }, 4, n => {
    assert.equal(n.status, 'approval'); assert.equal(n.recoveryPlan.timing, 'feasible'); assert.equal(n.lcUpdateRequirements.timingConfirmationRequired, false); assert.equal(n.lcUpdateRequirements.draftingRequired, false); assert.equal(n.plan.documentVersions, binding(n));
  });
  await step('Fresh internal approval', { type: 'approve' }, 0, n => { assert.equal(n.status, 'waiting'); assert.equal(n.approval.documentVersions, binding(n)); });
  const documents = c.docs.filter(d => d.kind !== 'lc').map(d => ({ kind: d.kind, name: d.name.replace('v1', 'v2'), text: d.kind === 'invoice' ? d.text.replace('currency: EUR', 'currency: USD') : d.text.replace('consignee: SYNTHETIC BUYER LTD', 'consignee: TO ORDER OF SYNTHETIC TEST BANK') }));
  await step('Revised synthetic documents received', { type: 'reply', reply: 'available', docs: documents }, 1, n => { assert.equal(n.status, 'received'); assert.deepEqual(n.docs.map(d => d.version), [2, 2, 2]); assert.equal(n.approval, undefined); });
  await step('Independent recheck', { type: 'recheck' }, 3, n => { assert.equal(n.status, 'reviewed'); assert.equal(n.deadline, expectedDeadline); assert.equal(n.findings.length, 0); assert.equal(n.lcUpdateRequirements.timingConfirmationRequired, false); });
  ledger.completed = true;
} catch (error) { ledger.completed = false; ledger.blockedReason = error.message; console.log(`Continuation stopped: ${error.message}`); }
finally {
  if (c && ledger.baseUsage) {
    const saved = await request();
    ledger.localCaseReadback = { httpStatus: saved.status, revision: saved.case?.revision, status: saved.case?.status, sourceVersions: saved.case ? versions(saved.case) : [], deadline: saved.case?.deadline, matchesResponse: JSON.stringify(saved.case) === JSON.stringify(c) };
    ledger.newAttempts = (c.modelAttempts ?? c.modelRuns) - ledger.baseAttempts; ledger.newParsedResponses = c.modelRuns - ledger.baseModelRuns;
    ledger.newUsage = { input: c.usage.input - ledger.baseUsage.input, output: c.usage.output - ledger.baseUsage.output, missing: c.usage.missing - ledger.baseUsage.missing };
  }
  ledger.endedAt = new Date().toISOString(); ledger.billedCost = null; save();
  console.log(JSON.stringify({ caseId: ledger.caseId, completed: ledger.completed, newAttempts: ledger.newAttempts, usage: ledger.newUsage, blockedReason: ledger.blockedReason }));
}
