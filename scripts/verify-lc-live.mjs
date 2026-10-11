// One bounded synthetic run against the existing local application. No retries.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const output = 'output/playwright';
mkdirSync(output, { recursive: true });
const ledgerFile = `${output}/phase4-live-ledger.json`;
if (existsSync(ledgerFile)) throw new Error('A live verification ledger already exists. Do not repeat this run.');
const origin = 'http://127.0.0.1:5173';
const today = new Date().toISOString().slice(0, 10);
const after = days => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const reference = `PHASE4-VERIFY-${today.replaceAll('-', '')}-${new Date().toISOString().slice(11, 19).replaceAll(':', '')}`;
const originalExpiry = after(4), revisedExpiry = after(10), presentationDeadline = after(21);
const ledger = { reference, startedAt: new Date().toISOString(), clockBasis: 'UTC date used by live orchestration', expected: { shipment: today, latestShipment: after(1), presentationDays: 21, shipmentPlusPresentation: presentationDeadline, originalDeadline: originalExpiry, selectedDeadline: revisedExpiry, modelAttemptsHappyPath: 20 }, steps: [], persistedTraceReadback: false };
let current, payload;
const versions = c => c.docs.map(d => ({ kind: d.kind, version: d.version }));
const bindings = c => c.docs.map(d => `${d.kind}:${d.version}:${d.text}`).join('\n');
const save = () => { writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2)); if (current) writeFileSync(`${output}/phase4-live-case.json`, JSON.stringify(current, null, 2)); };
async function request(path, body) {
  const response = await fetch(`${origin}${path}`, { method: body ? 'POST' : 'GET', headers: { Cookie: '__sites_local_auth=1', Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(300000) });
  return { status: response.status, body: await response.json() };
}
async function step(label, action, expectedCalls, verify) {
  const previous = structuredClone(current), startedAt = new Date().toISOString();
  console.log(`Starting ${label}; expected model attempts ${expectedCalls}.`);
  const response = await request(`/api/cases/${current.id}`, { revision: current.revision, ...action });
  payload = response.body;
  if (payload.case) current = payload.case;
  else if (response.status >= 400) current = (await request(`/api/cases/${current.id}`)).body.case;
  const events = current.events.slice(previous.events.length);
  const item = { label, action: action.type, startedAt, endedAt: new Date().toISOString(), httpStatus: response.status, revision: current.revision, status: current.status, sourceVersions: versions(current), deadline: current.deadline, findingIds: current.findings.map(f => f.id), approvalPresent: !!current.approval, followUp: payload.followUp, expectedModelAttempts: expectedCalls, successfulProviderResponses: current.modelRuns - previous.modelRuns, usage: { input: current.usage.input - previous.usage.input, output: current.usage.output - previous.usage.output, missing: current.usage.missing - previous.usage.missing }, runs: [...new Set(events.map(e => e.run).filter(Boolean))], telemetry: events.filter(e => e.actor === 'Telemetry').map(e => ({ title: e.title, detail: e.detail, run: e.run, traceId: e.detail.match(/Neatlogs trace ID ([a-f0-9]{32})/)?.[1] })), ...(response.status >= 400 ? { error: payload.error, code: payload.code, freshInvestigationRequired: payload.freshInvestigationRequired } : {}) };
  item.businessFailures = events.filter(e => ['Live action failed', 'Drafting failed after LC selection', 'LC assessment failed'].includes(e.title)).map(e => ({ title: e.title, detail: e.detail }));
  ledger.steps.push(item); save();
  assert.equal(response.status, 200, `${label}: ${payload.error || 'HTTP failure'}`);
  assert.ok(!events.some(e => ['Live action failed', 'Drafting failed after LC selection', 'LC assessment failed'].includes(e.title)), `${label}: saved orchestration failure; stop without retry`);
  assert.equal(item.successfulProviderResponses, expectedCalls, `${label}: unexpected call sequence; stop without retry`);
  verify?.(current, previous, payload);
  item.assertionsPassed = true; save();
  console.log(`Completed ${label}: ${current.status}, revision ${current.revision}, ${item.successfulProviderResponses} provider responses.`);
}
const lcText = expiry => `SYNTHETIC PHASE 4 VERIFICATION ONLY - not a bank instrument\nreference: ${reference}\ncurrency: USD\nmax_amount: 50000\nconsignee: TO ORDER OF SYNTHETIC TEST BANK\nlatest_shipment: ${after(1)}\nexpiry: ${expiry}\npresentation_days: 21`;
const invoiceText = currency => `SYNTHETIC PHASE 4 VERIFICATION ONLY - synthetic exporter invoice\nreference: ${reference}-INV\nlc_reference: ${reference}\ncurrency: ${currency}\namount: 48000`;
const blText = consignee => `SYNTHETIC PHASE 4 VERIFICATION ONLY - synthetic carrier document\nreference: ${reference}-BL\nlc_reference: ${reference}\nconsignee: ${consignee}\nshipment_date: ${today}`;
try {
  // Only readiness is retained; other saved cases are neither inspected nor printed.
  const ready = await request('/api/cases'); ledger.readiness = ready.body.config;
  assert.equal(ready.status, 200); assert.equal(ledger.readiness.liveReady, true);
  save();
  const created = await request('/api/cases', { mode: 'live', asOf: today, docs: [{ kind: 'lc', name: `${reference}-LC-v1.txt`, text: lcText(originalExpiry) }, { kind: 'invoice', name: `${reference}-INV-v1.txt`, text: invoiceText('EUR') }, { kind: 'bl', name: `${reference}-BL-v1.txt`, text: blText('SYNTHETIC BUYER LTD') }] });
  assert.equal(created.status, 201); current = created.body.case; ledger.caseId = current.id; save();
  await step('Initial investigation', { type: 'investigate' }, 5, c => { assert.equal(c.deadline, originalExpiry); assert.deepEqual(c.findings.map(f => f.id).sort(), ['bl.consignee', 'invoice.currency']); assert.equal(c.status, 'approval'); });
  await step('Original exporter correspondence', { type: 'correspondence', sender: 'exporter', text: `Synthetic exporter: We will send the corrected invoice on ${after(1)}.` }, 2);
  await step('Original carrier correspondence', { type: 'correspondence', sender: 'carrier', text: `Synthetic carrier: We will reissue the B/L on ${after(2)}.` }, 2, c => { assert.equal(c.recoveryPlan.timing, 'feasible'); assert.equal(c.status, 'approval'); });
  await step('Original internal approval', { type: 'approve' }, 0, c => { assert.equal(c.approval.documentVersions, bindings(c)); assert.equal(c.status, 'waiting'); });
  await step('Stage complete revised LC', { type: 'stage_lc', candidate: { name: `${reference}-LC-v2.txt`, text: lcText(revisedExpiry) }, assertion: { completeText: true, note: 'Synthetic verifier supplies this complete revised LC text for covered checks only.' } }, 1, (c, old) => { assert.deepEqual(c.docs, old.docs); assert.deepEqual(c.fields, old.fields); assert.deepEqual(c.findings, old.findings); assert.deepEqual(c.approval, old.approval); assert.equal(c.deadline, originalExpiry); assert.equal(c.pendingLcAssessment.deadlines.after.date, revisedExpiry); assert.equal(c.pendingLcAssessment.outsideCoverage.unresolved, false); });
  await step('Explicit selection for covered checks', { type: 'select_lc', ...payload.lcAssessmentRequest, assertion: { completeText: true, selectForCoveredChecks: true, outsideCoverageReviewed: true, note: 'Synthetic reviewer selects the supplied complete version for covered checks. No legal acceptance or authenticity assertion.' } }, 0, (c, old) => { assert.equal(c.deadline, revisedExpiry); assert.equal(c.docs[0].version, 2); assert.equal(c.docs[1].version, 1); assert.equal(c.docs[2].version, 1); assert.equal(c.approval, undefined); assert.equal(c.status, 'stopped'); assert.ok(c.lcUpdateRequirements.timingConfirmationRequired); const archived = c.lcAssessmentHistory.at(-1).previous; assert.deepEqual(archived.approval, old.approval); assert.equal(archived.docs[0].version, 1); assert.deepEqual(c.correspondence, old.correspondence); assert.ok(c.correspondence.every(r => r.sourceVersions === bindings(old))); });
  await step('Fresh exporter correspondence', { type: 'correspondence', sender: 'exporter', text: `Synthetic exporter: We will send the corrected invoice on ${after(5)}.` }, 2, c => assert.equal(c.status, 'stopped'));
  await step('Fresh carrier correspondence and drafting', { type: 'correspondence', sender: 'carrier', text: `Synthetic carrier: We will reissue the B/L on ${after(6)}.` }, 4, c => { assert.equal(c.status, 'approval'); assert.equal(c.lcUpdateRequirements.timingConfirmationRequired, false); assert.equal(c.lcUpdateRequirements.draftingRequired, false); assert.equal(c.plan.documentVersions, bindings(c)); });
  await step('Fresh internal correction approval', { type: 'approve' }, 0, c => { assert.equal(c.status, 'waiting'); assert.equal(c.approval.documentVersions, bindings(c)); });
  await step('Revised document receipt', { type: 'reply', reply: 'available', docs: [{ kind: 'invoice', name: `${reference}-INV-v2.txt`, text: invoiceText('USD') }, { kind: 'bl', name: `${reference}-BL-v2.txt`, text: blText('TO ORDER OF SYNTHETIC TEST BANK') }] }, 1, c => { assert.equal(c.status, 'received'); assert.equal(c.approval, undefined); assert.deepEqual(c.docs.map(d => d.version), [2, 2, 2]); });
  await step('Independent recheck', { type: 'recheck' }, 3, c => { assert.equal(c.status, 'reviewed'); assert.equal(c.deadline, revisedExpiry); assert.equal(c.findings.length, 0); assert.equal(c.lcUpdateRequirements.timingConfirmationRequired, false); });
  ledger.completed = true;
} catch (error) {
  ledger.completed = false; ledger.blockedReason = error.message; console.log(`Bounded run stopped: ${error.message}`);
} finally {
  ledger.endedAt = new Date().toISOString();
  ledger.totalSuccessfulProviderResponses = current?.modelRuns || 0;
  ledger.totalReportedUsage = current?.usage;
  ledger.billedCost = null;
  save();
  console.log(JSON.stringify({ caseId: ledger.caseId, reference, completed: ledger.completed, steps: ledger.steps.length, successfulProviderResponses: ledger.totalSuccessfulProviderResponses, usage: ledger.totalReportedUsage, blockedReason: ledger.blockedReason }));
}
