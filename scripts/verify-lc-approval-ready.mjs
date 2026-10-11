// One carrier submission only. Never approve, receive, recheck, stage or select live.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { documentVersions, lcFollowUpBlocked } from '../lib/domain.ts';
import { validateRecoveryPlan, versionKey } from '../lib/recovery.ts';
const output = 'output/playwright', file = `${output}/recovery-ready-ledger.json`;
if (existsSync(file)) throw new Error('This bounded carrier submission is already recorded. Do not repeat it.');
const id = 'c931202a-076f-4ea1-b661-41685c9a33c9', origin = 'http://127.0.0.1:5173';
const text = 'Synthetic carrier: We will reissue the B/L on 2026-10-17.';
const ledger = { caseId: id, startedAtUTC: new Date().toISOString(), displayTimezone: 'Asia/Qatar', budget: { maximumModelAttempts: 5, extraction: 1, planning: 1, optionalRepair: 1, strategy: 1, drafts: 1 }, fixture: { sender: 'carrier', text, availability: '2026-10-17', authenticity: 'User-provided and unverified' }, runtime: JSON.parse(readFileSync(`${output}/recovery-runtime.json`, 'utf8').replace(/^\uFEFF/, '')), persistedTraceReadback: false };
let before, current;
function save() { writeFileSync(file, JSON.stringify(ledger, null, 2)); if (current) writeFileSync(`${output}/recovery-ready-case.json`, JSON.stringify(current, null, 2)); }
async function request(body) {
  const r = await fetch(`${origin}/api/cases/${id}`, { method: body ? 'POST' : 'GET', headers: { Cookie: '__sites_local_auth=1', Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(300000) });
  return { httpStatus: r.status, ...await r.json() };
}
try {
  const read = await request(); assert.equal(read.httpStatus, 200); current = read.case; before = structuredClone(current);
  assert.equal(before.revision, 5); assert.equal(before.status, 'stopped'); assert.equal(before.deadline, '2026-10-21');
  assert.deepEqual(before.docs.map(d => d.version), [2, 1, 1]); assert.equal(before.approval, undefined); assert.equal(before.pendingLcAssessment, undefined);
  assert.equal(before.statements.length, 1); assert.equal(before.statements[0].date, '2026-10-16');
  assert.equal(before.correspondence[0].sourceVersions, versionKey(before));
  assert.equal(before.correspondence.some(r => r.sender === 'carrier' && r.sourceVersions === versionKey(before)), false);
  assert.equal(ledger.runtime.ColdRestart, true); assert.ok(ledger.runtime.BuiltRepairModules.length);
  ledger.baseRevision = before.revision; ledger.baseAttempts = before.modelAttempts; ledger.baseResponses = before.modelRuns; ledger.baseUsage = before.usage; save();
  console.log('Submitting one synthetic carrier correspondence; maximum five model attempts, no approval.');
  const result = await request({ type: 'correspondence', revision: before.revision, sender: 'carrier', text });
  current = result.case ?? (await request()).case;
  const events = current.events.slice(before.events.length);
  ledger.httpStatus = result.httpStatus; ledger.savedRevision = current.revision; ledger.status = current.status; ledger.followUp = result.followUp;
  ledger.actualAttempts = current.modelAttempts - before.modelAttempts; ledger.parsedResponses = current.modelRuns - before.modelRuns;
  ledger.usage = { input: current.usage.input - before.usage.input, output: current.usage.output - before.usage.output, missing: current.usage.missing - before.usage.missing };
  ledger.repairAttempts = events.filter(e => e.title === 'Proposal rejected; one repair permitted').length;
  ledger.runIds = [...new Set(events.map(e => e.run).filter(Boolean))];
  ledger.traceReceipts = events.filter(e => e.actor === 'Telemetry').map(e => ({ title: e.title, detail: e.detail, run: e.run, traceId: e.detail.match(/Neatlogs trace ID ([a-f0-9]{32})/)?.[1] }));
  ledger.failures = events.filter(e => ['Live action failed', 'Recovery planning rejected', 'Drafting failed after LC selection'].includes(e.title)); save();
  assert.equal(result.httpStatus, 200, result.error); assert.equal(ledger.failures.length, 0, 'Saved failure: diagnose before any further call.');
  assert.ok(ledger.actualAttempts >= 4 && ledger.actualAttempts <= 5); assert.equal(ledger.actualAttempts, ledger.parsedResponses); assert.ok(ledger.repairAttempts <= 1);
  assert.equal(current.status, 'approval'); assert.equal(current.approval, undefined); assert.equal(current.revision, before.revision + 1);
  assert.equal(current.deadline, '2026-10-21'); assert.deepEqual(current.docs, before.docs); assert.deepEqual(current.history, before.history); assert.deepEqual(current.lcAssessmentHistory, before.lcAssessmentHistory);
  assert.deepEqual(current.correspondence[0], before.correspondence[0]); assert.deepEqual(current.statements[0], before.statements[0]);
  const receipt = current.correspondence.at(-1); assert.equal(receipt.text, text); assert.equal(receipt.sender, 'carrier'); assert.equal(receipt.sourceVersions, versionKey(current));
  const statement = current.statements.find(s => s.correspondenceId === receipt.id); assert.equal(statement.date, '2026-10-17'); assert.equal(statement.category, 'commitment'); assert.equal(statement.quote, text);
  ledger.fixture.receivedOn = receipt.receivedOn; ledger.fixture.correspondenceId = receipt.id;
  assert.equal(lcFollowUpBlocked(current), false); assert.equal(current.plan.documentVersions, documentVersions(current)); assert.equal(current.recoveryPlan.documentVersions, documentVersions(current));
  const validated = validateRecoveryPlan(current, { actions: current.recoveryPlan.actions }, current.statements);
  assert.equal(validated.timing, 'feasible'); assert.equal(validated.deadline, '2026-10-21'); assert.equal(validated.approvalRequired, true);
  ledger.independentValidation = { passed: true, timing: validated.timing, deadline: validated.deadline, actions: validated.actions, sourceVersions: current.docs.map(d => ({ kind: d.kind, version: d.version })) };
  ledger.supportingEvidence = { lcTerms: { currency: current.fields.lc.currency, consignee: current.fields.lc.consignee }, findings: current.findings, statements: current.statements };
  ledger.drafts = { summary: current.plan.summary, invoice: current.plan.invoiceDraft, carrier: current.plan.carrierDraft, assumption: current.plan.assumption };
  const saved = await request(); assert.equal(saved.httpStatus, 200); assert.deepEqual(saved.case, current);
  ledger.localReadback = { verified: true, revision: saved.case.revision, status: saved.case.status, approvalPresent: !!saved.case.approval };
  ledger.approvalReady = true;
} catch (error) { ledger.approvalReady = false; ledger.blockedReason = error.message; console.log(`Stopped: ${error.message}`); }
finally { ledger.endedAtUTC = new Date().toISOString(); ledger.billedCost = null; save(); console.log(JSON.stringify({ approvalReady: ledger.approvalReady, revision: ledger.savedRevision, attempts: ledger.actualAttempts, repairs: ledger.repairAttempts, usage: ledger.usage, runIds: ledger.runIds, traceReceipts: ledger.traceReceipts, blockedReason: ledger.blockedReason })); }
