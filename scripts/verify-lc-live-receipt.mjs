// Receipt and separate recheck only, following the user's already persisted UI approval.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { documentVersions, groundedFields, parseFixture, validate } from '../lib/domain.ts';
import { sourceBinding } from '../lib/source-grounding.ts';
const retry = process.argv.includes('--retry-after-contract-fix');
const output = 'output/playwright', prefix = retry ? 'receipt-retry' : 'receipt';
const ledgerFile = `${output}/${retry ? 'receipt-retry-ledger' : 'receipt-recheck-ledger'}.json`;
if (existsSync(ledgerFile)) throw new Error('Receipt verification already recorded. Do not repeat successful calls.');
const previous = retry ? JSON.parse(readFileSync(`${output}/receipt-recheck-ledger.json`, 'utf8')) : null;
if (retry) {
  assert.equal(previous.completed, false); assert.equal(previous.actualAttempts, 1);
  assert.equal(previous.final.revision, 8); assert.equal(previous.final.status, 'waiting');
  assert.equal(previous.steps.length, 1);
  assert.match(previous.steps[0].failures[0].detail, /Coordinator claims do not match/);
}
const origin = 'http://127.0.0.1:5173', id = 'c931202a-076f-4ea1-b661-41685c9a33c9';
const ledger = { caseId: id, startedAtUTC: new Date().toISOString(), displayTimezone: 'Asia/Qatar', budget: { expectedAttempts: 4, maximumAttempts: 5, alreadyUsed: previous?.actualAttempts ?? 0, receipt: 1, independentRecheck: 3, retries: retry ? 1 : 0 }, steps: [], persistedTraceReadback: false };
let initial, current;
const versions = c => c.docs.map(d => ({ kind: d.kind, version: d.version, name: d.name }));
function save() { writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2)); if (current) writeFileSync(`${output}/${prefix}-final-case.json`, JSON.stringify(current, null, 2)); }
async function request(body) {
  const r = await fetch(`${origin}/api/cases/${id}`, { method: body ? 'POST' : 'GET', headers: { Cookie: '__sites_local_auth=1', Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(300000) });
  return { httpStatus: r.status, ...await r.json() };
}
async function step(label, action, expectedAttempts, check) {
  const before = structuredClone(current), startedAtUTC = new Date().toISOString();
  assert.ok(ledger.budget.alreadyUsed + current.modelAttempts - initial.modelAttempts + expectedAttempts <= 5, 'Model attempt ceiling exceeded.');
  console.log(`Starting ${label}; expected attempts ${expectedAttempts}.`);
  const result = await request({ revision: current.revision, ...action });
  current = result.case ?? (await request()).case;
  const events = current.events.slice(before.events.length);
  const item = { label, action: action.type, startedAtUTC, endedAtUTC: new Date().toISOString(), httpStatus: result.httpStatus, revision: current.revision, status: current.status, versions: versions(current), deadline: current.deadline, findingIds: current.findings.map(f => f.id), expectedAttempts, actualAttempts: current.modelAttempts - before.modelAttempts, parsedResponses: current.modelRuns - before.modelRuns, usage: { input: current.usage.input - before.usage.input, output: current.usage.output - before.usage.output, missing: current.usage.missing - before.usage.missing }, runIds: [...new Set(events.map(e => e.run).filter(Boolean))], receipts: events.filter(e => e.actor === 'Telemetry').map(e => ({ title: e.title, detail: e.detail, run: e.run, traceId: e.detail.match(/Neatlogs trace ID ([a-f0-9]{32})/)?.[1] })), failures: events.filter(e => ['Live action failed', 'Drafting failed after LC selection', 'Recovery planning rejected'].includes(e.title)), followUp: result.followUp, ...(result.error ? { error: result.error } : {}) };
  ledger.steps.push(item); save();
  assert.equal(result.httpStatus, 200, result.error); assert.equal(item.failures.length, 0, 'Saved failure; no speculative retry.');
  assert.equal(item.actualAttempts, expectedAttempts); assert.equal(item.parsedResponses, expectedAttempts);
  check(current, before, events); item.assertionsPassed = true;
  const saved = await request(); assert.equal(saved.httpStatus, 200); assert.deepEqual(saved.case, current);
  item.localReadbackVerified = true; save();
  console.log(`Completed ${label}: revision ${current.revision}, ${current.status}, ${item.actualAttempts} attempts.`);
}
try {
  const read = await request(); assert.equal(read.httpStatus, 200); current = read.case; initial = structuredClone(current);
  assert.equal(initial.revision, retry ? 8 : 7); assert.equal(initial.status, 'waiting'); assert.equal(initial.fields.lc.reference.value, 'PHASE4-VERIFY-20261011-174225');
  if (retry) {
    assert.equal(initial.modelAttempts, previous.final.cumulativeAttempts);
    assert.equal(initial.approval.at, previous.humanApproval.at);
    assert.equal(initial.approval.planId, previous.humanApproval.planId);
    ledger.previousFailureLedger = `${output}/receipt-recheck-ledger.json`;
  }
  assert.deepEqual(initial.docs.map(d => d.version), [2, 1, 1]); assert.equal(initial.deadline, '2026-10-21');
  assert.ok(initial.approval); assert.equal(initial.approval.documentVersions, documentVersions(initial)); assert.equal(initial.approval.planId, initial.recoveryPlan.id);
  ledger.baseRevision = initial.revision; ledger.baseAttempts = initial.modelAttempts; ledger.baseResponses = initial.modelRuns; ledger.baseUsage = initial.usage;
  ledger.humanApproval = { revision: initial.approval.revision, at: initial.approval.at, planId: initial.approval.planId, originalVersions: versions(initial), matchesDocumentsAndPlan: true };
  const replacements = { invoice: ['currency: EUR', 'currency: USD'], bl: ['consignee: SYNTHETIC BUYER LTD', 'consignee: TO ORDER OF SYNTHETIC TEST BANK'] };
  mkdirSync(`${output}/revised-fixtures`, { recursive: true });
  const docs = initial.docs.filter(d => d.kind !== 'lc').map(d => {
    const [oldLine, newLine] = replacements[d.kind];
    assert.equal(d.text.split(/\r?\n/).filter(line => line === oldLine).length, 1);
    assert.equal(d.text.split(oldLine).length, 2); assert.ok(d.text.startsWith('SYNTHETIC'));
    const text = d.text.replace(oldLine, newLine), name = `PHASE4-VERIFY-20261011-174225-SYNTHETIC-REVISED-${d.kind === 'invoice' ? 'INV' : 'BL'}-v2.txt`;
    assert.equal(text.replace(newLine, oldLine), d.text); // Every other source character preserved.
    const parsed = parseFixture({ ...d, text }), original = parseFixture(d);
    for (const key of Object.keys(original)) if (key !== (d.kind === 'invoice' ? 'currency' : 'consignee')) assert.deepEqual(parsed[key], original[key]);
    const path = `${output}/revised-fixtures/${name}`;
    if (retry) assert.equal(readFileSync(path, 'utf8'), text, 'Reuse the exact previously attempted synthetic fixture.');
    else { assert.equal(existsSync(path), false, 'Preserve any existing fixture.'); writeFileSync(path, text); }
    return { kind: d.kind, name, text };
  });
  ledger.fixtures = docs.map(d => ({ kind: d.kind, name: d.name, path: `${output}/revised-fixtures/${d.name}`, onlyChangedLine: replacements[d.kind], originalSourceVersion: 1, proposedVersion: 2, authenticity: 'Explicitly synthetic user-supplied text; no issuer origin established' })); save();
  await step('Receive synthetic revised invoice and B/L', { type: 'reply', reply: 'available', docs }, 1, (n, old) => {
    assert.equal(n.status, 'received'); assert.equal(n.revision, old.revision + 1); assert.deepEqual(n.docs.map(d => d.version), [2, 2, 2]); assert.deepEqual(n.docs[0], initial.docs[0]);
    assert.equal(n.deadline, '2026-10-21'); assert.deepEqual(n.findings, initial.findings); assert.equal(n.findings.length, 2);
    assert.equal(n.approval, undefined); assert.deepEqual(n.planHistory.at(-1).approval, initial.approval); assert.equal(n.planHistory.at(-1).plan.id, initial.recoveryPlan.id);
    assert.equal(n.planHistory.at(-1).approval.documentVersions, documentVersions(initial));
    assert.deepEqual(n.planningFailures, initial.planningFailures); assert.deepEqual(n.lcAssessmentHistory, initial.lcAssessmentHistory);
    assert.deepEqual(n.priorAssessments.at(-1).statements, initial.statements);
    for (const d of docs) assert.equal(n.docs.find(v => v.kind === d.kind).text, d.text);
    writeFileSync(`${output}/${prefix}-saved-case.json`, JSON.stringify(n, null, 2));
  });
  await step('Separate independent live recheck', { type: 'recheck' }, 3, (n, old, events) => {
    assert.equal(n.revision, old.revision + 1); assert.deepEqual(n.docs, old.docs); assert.equal(n.deadline, '2026-10-21');
    const extracts = events.filter(e => e.title === 'Source evidence extracted'); assert.equal(extracts.length, 3); assert.ok(extracts.every(e => e.detail.includes('document v2')));
    for (const doc of n.docs) {
      assert.deepEqual(groundedFields(doc, n.fields[doc.kind]), n.fields[doc.kind]);
      const extraction = n.extractionHistory.filter(r => r.kind === doc.kind).at(-1);
      assert.equal(extraction.version, 2); assert.equal(extraction.documentBinding, sourceBinding(doc));
    }
    const independentlyValidated = structuredClone(n); assert.deepEqual(validate(independentlyValidated), []); assert.equal(independentlyValidated.deadline, '2026-10-21');
    assert.equal(n.status, 'reviewed'); assert.deepEqual(n.findings, []); assert.equal(n.approval, undefined);
    assert.deepEqual(n.planHistory.at(-1).approval, initial.approval); assert.deepEqual(n.planningFailures, initial.planningFailures); assert.deepEqual(n.lcAssessmentHistory, initial.lcAssessmentHistory);
    for (const source of initial.history) assert.ok(n.history.some(doc => sourceBinding(doc) === sourceBinding(source)));
    for (const doc of initial.docs) assert.ok(n.history.some(v => sourceBinding(v) === sourceBinding(doc)));
    ledger.validatedCurrentFields = { lc: n.fields.lc, invoice: n.fields.invoice, bl: n.fields.bl };
  });
  ledger.completed = true;
} catch (error) { ledger.completed = false; ledger.blockedReason = error.message; console.log(`Verification stopped: ${error.message}`); }
finally {
  ledger.endedAtUTC = new Date().toISOString(); ledger.billedCost = null;
  if (initial && current) { ledger.actualAttempts = current.modelAttempts - initial.modelAttempts; ledger.parsedResponses = current.modelRuns - initial.modelRuns; ledger.usage = { input: current.usage.input - initial.usage.input, output: current.usage.output - initial.usage.output, missing: current.usage.missing - initial.usage.missing }; ledger.final = { revision: current.revision, status: current.status, findings: current.findings, versions: versions(current), deadline: current.deadline, activeApprovalPresent: !!current.approval, cumulativeAttempts: current.modelAttempts, cumulativeResponses: current.modelRuns, cumulativeUsage: current.usage }; }
  ledger.totalAdditionalAttempts = ledger.budget.alreadyUsed + (ledger.actualAttempts ?? 0);
  save(); console.log(JSON.stringify({ completed: ledger.completed, final: ledger.final, actualAttempts: ledger.actualAttempts, totalAdditionalAttempts: ledger.totalAdditionalAttempts, usage: ledger.usage, blockedReason: ledger.blockedReason }));
}
