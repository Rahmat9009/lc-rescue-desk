import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fixtureDocs, parseFixture, newCase, finishInvestigation, documentVersions } from '../lib/domain.ts';
import { MAX_SNAPSHOT_BYTES, serializeSnapshot } from '../lib/snapshot-size.ts';

const require = createRequire(import.meta.url);
const { Miniflare } = require(require.resolve('miniflare', { paths: [dirname(realpathSync('node_modules/wrangler'))] }));
let mf, db, models = 0, exports = 0, extractionMode = 'normal', failDrafts = false, rejectTrace = false, invalidPlanner = false, failRepair = false;
let holdModel, holdTrace;
const trees = [];
const modelInputs = [];
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function barrier() { return { entered: deferred(), release: deferred() }; }
function actions(input) {
  const relevant = input.statements.filter(s => s.category === 'commitment' && s.date && input.findings.some(f => f.doc === s.target));
  const targets = [...new Set(input.findings.filter(f => ['invoice', 'bl'].includes(f.doc)).map(f => f.doc))];
  const unresolved = !input.deadline || targets.some(t => !relevant.some(s => s.target === t)) || relevant.some(s => s.date >= input.deadline);
  if (unresolved) {
    const refs = [...(input.deadline ? ['deadline'] : []), ...input.statements.map(s => `statement:${s.id}`), ...input.findings.map(f => `finding:${f.id}`)];
    return { actions: [{ id: 'a1', kind: 'human_escalation', owner: 'Trade specialist', dueDate: null, dependsOn: [], evidenceRefs: refs }, { id: 'a2', kind: 'clarify_timing', owner: 'Human coordinator', dueDate: null, dependsOn: ['a1'], evidenceRefs: refs }] };
  }
  const requests = targets.map((target, i) => {
    const statement = relevant.filter(s => s.target === target).at(-1);
    return { id: `a${i + 1}`, kind: target === 'invoice' ? 'request_invoice' : 'request_bl', owner: target === 'invoice' ? 'Exporter' : 'Carrier', dueDate: statement.date, dependsOn: [], evidenceRefs: [`statement:${statement.id}`, ...input.findings.filter(f => f.doc === target).map(f => `finding:${f.id}`)] };
  });
  return { actions: [...requests, { id: `a${requests.length + 1}`, kind: 'recheck', owner: 'Desk', dueDate: null, dependsOn: requests.map(a => a.id), evidenceRefs: input.findings.map(f => `finding:${f.id}`) }] };
}
before(async () => {
  mf = new Miniflare({ modules: [{ type: 'ESModule', path: resolve('dist/server/index.js') }, ...readdirSync('dist/server', { recursive: true }).filter(p => /\.(js|mjs)$/.test(p) && p !== 'index.js').map(p => ({ type: 'ESModule', path: resolve('dist/server', p) }))], modulesRoot: resolve('dist/server'), compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], d1Databases: { DB: 'lc-update-tests' }, bindings: { GEMINI_API_KEY: 'synthetic-model-secret', NEATLOGS_WRITE_KEY: 'nlw_synthetic-trace-secret', NEATLOGS_PROJECT: 'synthetic-update-project', LC_MODEL: 'gemini-3.1-flash-lite' }, outboundService: async req => {
    if (new URL(req.url).hostname === 'generativelanguage.googleapis.com') {
      models++;
      const payload = await req.json(), input = JSON.parse(payload.messages[1].content), system = payload.messages[0].content;
      modelInputs.push({ input, system });
      if (input.document && input.kind === 'lc' && input.version > 1 && holdModel) { const gate = holdModel; holdModel = undefined; gate.entered.resolve(); await gate.release.promise; }
      if (failDrafts && system.includes('invoiceDraft')) return new Response('{}', { status: 502 });
      if (failRepair && system.includes('single repair attempt')) return new Response('{}', { status: 502 });
      let result;
      if (input.document) {
        result = parseFixture({ kind: input.kind, text: input.document });
        if (input.kind === 'lc' && input.version > 1) {
          if (extractionMode === 'invent') result.expiry.quote = 'INVENTED SECRET_PROVIDER_OUTPUT';
          if (extractionMode === 'truncate') for (const field of Object.values(result)) field.quote = field.value;
          if (extractionMode === 'missing') delete result.expiry;
          if (extractionMode === 'mislabel') result.expiry = { value: result.latest_shipment.value, quote: result.latest_shipment.quote };
        }
      } else if (input.correspondence) result = { quotes: [input.correspondence] };
      else if (input.statements) {
        assert.ok(input.allowedEvidenceRefs.includes('deadline'));
        assert.ok(input.statements.every(s => input.allowedEvidenceRefs.includes(s.evidenceRef)));
        result = actions(input);
        if (system.includes('single repair attempt')) {
          assert.equal(input.rejectedProposal.actions[0].evidenceRefs[0], 'missing:No supported carrier B/L availability date.');
          assert.match(input.validationFeedback.message, /unsupported evidence reference/);
          assert.deepEqual(input.validationFeedback.allowedEvidenceRefs, input.allowedEvidenceRefs);
          assert.equal(input.allowedActionKinds.includes('request_invoice'), false);
        }
        if (invalidPlanner) { result.actions[0].evidenceRefs = ['missing:No supported carrier B/L availability date.']; if (invalidPlanner === 'once') invalidPlanner = false; }
      }
      else if (input.replyScenario) {
        assert.equal(Object.keys(input).length, 12);
        assert.equal(input.timelineBasis, 'assumption');
        for (const key of ['carrierCommitment', 'issuerAuthenticity', 'bankAcceptance']) assert.equal(input[key], 'unconfirmed');
        assert.equal(input.nextHumanAction, input.resultingStatus === 'received' ? 'recheck' : 'specialist_review');
        assert.equal(typeof input.invoiceVersion, 'number');
        assert.equal(typeof input.documentsReceived, 'boolean');
        assert.match(system, /preserving every key, literal value and JSON type/);
        result = structuredClone(input);
      }
      else if (system.includes('invoiceDraft')) result = { invoiceDraft: 'Synthetic current exporter draft.', carrierDraft: 'Synthetic current carrier draft.' };
      else result = { summary: 'Synthetic verified correction strategy.' };
      return Response.json({ choices: [{ message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 100, completion_tokens: 25 } });
    }
    if (new URL(req.url).hostname === 'ingest.neatlogs.com') {
      exports++; const tree = await req.json(); trees.push(tree);
      if (holdTrace && tree.name === 'lc-rescue.select_lc') { const gate = holdTrace; holdTrace = undefined; gate.entered.resolve(); await gate.release.promise; }
      if (rejectTrace) return new Response('<title>synthetic-model-secret nlw_synthetic-trace-secret</title>', { status: 403, headers: { 'content-type': 'text/html' } });
      const count = n => 1 + n.children.reduce((sum, child) => sum + count(child), 0);
      return Response.json({ success: true, trace_id: 'b'.repeat(32), spans: count(tree) });
    }
    throw new Error('Unexpected external host: ' + new URL(req.url).hostname);
  } });
  db = await mf.getD1Database('DB'); await db.prepare(readFileSync('drizzle/0000_steady_namorita.sql', 'utf8')).run();
});
after(async () => { await mf?.dispose(); });
async function request(path, data, owner = 'update-owner', origin = 'https://desk.test') {
  const headers = { 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': 'synthetic@example.invalid' };
  if (data) { headers['content-type'] = 'application/json'; headers.origin = origin; }
  const res = await mf.dispatchFetch('https://desk.test' + path, { method: data ? 'POST' : 'GET', headers, body: data ? JSON.stringify(data) : undefined });
  return { status: res.status, ...await res.json() };
}
async function run(c, action, expected = 200) { const p = await request('/api/cases/' + c.id, { ...action, revision: action.revision ?? c.revision }); assert.equal(p.status, expected, JSON.stringify(p)); return p; }
async function investigated(mode = 'demo') {
  const p = await request('/api/cases', { mode, asOf: '2026-10-10', ...(mode === 'live' ? { docs: fixtureDocs() } : {}) }); assert.equal(p.status, 201);
  return (await run(p.case, { type: 'investigate' })).case;
}
function stageRequest(c, replace = {}, extra = '') {
  let text = c.docs.find(d => d.kind === 'lc').text;
  for (const [key, value] of Object.entries(replace)) text = text.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`);
  return { type: 'stage_lc', candidate: { name: 'revised-credit.txt', text: text + extra }, assertion: { completeText: true, note: 'Synthetic complete-text assertion, not authenticity proof.' } };
}
function selection(p) { return { type: 'select_lc', ...p.lcAssessmentRequest, assertion: { completeText: true, selectForCoveredChecks: true, outsideCoverageReviewed: true, note: 'Use the supplied complete version for covered checks only.' } }; }
function business(c) { const { revision, events, modelRuns, usage, pendingLcAssessment, lcAssessmentHistory, ...rest } = c; delete rest.modelAttempts; return rest; }
async function saved(id) { const p = await request('/api/cases/' + id); assert.equal(p.status, 200); return p; }
async function seed(c) { await db.prepare('INSERT INTO cases (id, owner, revision, snapshot, updated_at) VALUES (?, ?, ?, ?, ?)').bind(c.id, 'update-owner', c.revision, JSON.stringify(c), new Date().toISOString()).run(); return c; }

test('unauthorized, wrong-owner, invalid assertion and cross-origin requests execute no model or export', async () => {
  const c = await investigated('live'), before = [models, exports], action = { ...stageRequest(c, { expiry: '2026-10-20' }), revision: c.revision };
  assert.equal((await request('/api/cases/' + c.id, action, '')).status, 401);
  assert.equal((await request('/api/cases/' + c.id, action, 'other-owner')).status, 404);
  assert.equal((await request('/api/cases/' + c.id, action, 'update-owner', 'https://unrelated.test')).status, 403);
  assert.equal((await request('/api/cases/' + c.id, { ...action, assertion: { completeText: false, note: 'Incomplete.' } })).status, 400);
  assert.equal((await request('/api/cases/' + c.id, { ...action, assertion: { ...action.assertion, reviewer: 'Forged actor' } })).status, 400);
  assert.deepEqual([models, exports], before);
});

test('demo stage/select/fresh confirmation/approval/receipt/recheck persists evidence with zero outbound calls', async () => {
  let c = await investigated(), original = structuredClone(c), before = [models, exports];
  c = (await run(c, { type: 'approve' })).case;
  original = structuredClone(c);
  const staged = await run(c, stageRequest(c, { expiry: '2026-10-20' }));
  assert.deepEqual(business(staged.case), business(original)); assert.equal(staged.case.deadline, '2026-10-12');
  assert.equal(staged.case.pendingLcAssessment.deadlines.after.date, '2026-10-20');
  assert.equal(staged.case.pendingLcAssessment.assertion.reviewer, 'update-owner');
  assert.ok(Object.values(staged.lcAssessmentRequest).filter(v => typeof v === 'string' && v !== staged.lcAssessmentRequest.assessmentId).every(v => /^[a-f0-9]{64}$/.test(v)));
  const read = await saved(c.id); assert.deepEqual(read.case.pendingLcAssessment, staged.case.pendingLcAssessment); assert.deepEqual(read.lcAssessmentRequest, staged.lcAssessmentRequest);
  for (const type of ['approve', 'reply', 'correspondence', 'reassess', 'recheck', 'investigate']) await run(staged.case, { type, reply: 'available', sender: 'carrier', text: 'We will reissue the B/L tomorrow.' }, 400);
  const selected = await run(staged.case, selection(staged)); c = selected.case;
  assert.equal(c.docs[0].version, 2); assert.equal(c.deadline, '2026-10-20'); assert.equal(c.status, 'stopped'); assert.equal(c.approval, undefined);
  assert.deepEqual(c.lcAssessmentHistory.at(-1).previous.approval, original.approval);
  await run(c, { type: 'approve' }, 400);
  c = (await run(c, { type: 'correspondence', sender: 'exporter', text: 'We will send the corrected invoice on 2026-10-12.' })).case;
  assert.equal(c.status, 'stopped');
  c = (await run(c, { type: 'correspondence', sender: 'carrier', text: 'We will reissue the B/L on 2026-10-16.' })).case;
  assert.equal(c.status, 'approval'); c = (await run(c, { type: 'approve' })).case;
  c = (await run(c, { type: 'reply', reply: 'available' })).case; assert.equal(c.status, 'received');
  c = (await run(c, { type: 'recheck' })).case; assert.equal(c.status, 'reviewed'); assert.deepEqual(c.findings, []);
  assert.deepEqual((await saved(c.id)).case, c); assert.deepEqual([models, exports], before); assert.equal(c.modelRuns, 0);
});

test('live LC investigator completes uniquely grounded excerpts and selected basis waits for fresh timing and new drafts', async () => {
  let c = await investigated('live'); const before = models; extractionMode = 'truncate';
  let p = await run(c, stageRequest(c, { expiry: '2026-10-20' })); extractionMode = 'normal';
  assert.equal(models - before, 1); assert.equal(p.case.pendingLcAssessment.fields.lc.expiry.quote, 'expiry: 2026-10-20');
  const beforeSelect = models; p = await run(p.case, selection(p)); c = p.case;
  assert.equal(models, beforeSelect); assert.equal(c.status, 'stopped'); assert.ok(p.followUp.includes('confirm_current_timing'));
  const beforeBlocked = [models, exports]; await run(c, { type: 'reply', reply: 'available' }, 400); await run(c, { type: 'approve' }, 400);
  assert.deepEqual([models, exports], beforeBlocked);
  c = (await run(c, { type: 'correspondence', sender: 'exporter', text: 'We will send the corrected invoice on 2026-10-12.' })).case;
  assert.equal(c.status, 'stopped');
  c = (await run(c, { type: 'correspondence', sender: 'carrier', text: 'We will reissue the B/L on 2026-10-16.' })).case;
  assert.equal(c.status, 'approval'); assert.equal(c.lcUpdateRequirements.draftingRequired, false); assert.equal(c.plan.invoiceDraft, 'Synthetic current exporter draft.');
  c = (await run(c, { type: 'approve' })).case;
  const docs = fixtureDocs().filter(d => d.kind !== 'lc').map(({ kind, name, text }) => ({ kind, name, text: text.replace('currency: EUR', 'currency: USD').replace('consignee: NORTHSTAR TRADING LTD', 'consignee: TO ORDER OF MERIDIAN BANK') }));
  c = (await run(c, { type: 'reply', reply: 'available', docs })).case; assert.equal(c.status, 'received');
  c = (await run(c, { type: 'recheck' })).case; assert.equal(c.status, 'reviewed'); assert.equal(c.docs[0].version, 2);
});

test('retained selected Phase 4 scenario requires fresh approval, receives invoice/B/L v2 and independently rechecks while retaining original evidence', async () => {
  let c = JSON.parse(readFileSync(new URL('./fixtures/phase4-selected-recovery.json', import.meta.url), 'utf8'));
  const original = structuredClone(c); await seed(c);
  assert.equal(c.revision, 5); assert.equal(c.deadline, '2026-10-21'); assert.equal(c.approval, undefined);
  assert.deepEqual(c.docs.map(d => d.version), [2, 1, 1]); assert.equal(c.statements[0].date, '2026-10-16');
  const startModels = models, startInputs = modelInputs.length;
  await run(c, { type: 'approve' }, 400);
  const p = await run(c, { type: 'correspondence', sender: 'carrier', text: 'Synthetic carrier: We will reissue the B/L on 2026-10-17.' }); c = p.case;
  assert.equal(models - startModels, 4); assert.equal(c.status, 'approval'); assert.equal(c.revision, 6);
  assert.equal(c.approval, undefined); assert.equal(c.lcUpdateRequirements.draftingRequired, false);
  assert.equal(c.plan.documentVersions, documentVersions(c)); assert.equal(c.recoveryPlan.documentVersions, documentVersions(c));
  assert.deepEqual(c.correspondence[0], original.correspondence[0]); assert.deepEqual(c.statements[0], original.statements[0]);
  const calls = modelInputs.slice(startInputs);
  assert.equal(calls.filter(v => v.input.correspondence).length, 1);
  assert.equal(calls.filter(v => v.input.document).length, 0);
  const draftCall = calls.find(v => v.system.includes('Draft correction requests'));
  assert.deepEqual(draftCall.input.findings, c.findings); assert.equal(draftCall.input.deadline, '2026-10-21');
  assert.deepEqual(c.lcAssessmentHistory, original.lcAssessmentHistory);
  const docs = c.docs.filter(d => d.kind !== 'lc').map(d => ({ kind: d.kind, name: d.name.replace('v1', 'v2'), text: d.text.replace('currency: EUR', 'currency: USD').replace('consignee: SYNTHETIC BUYER LTD', 'consignee: TO ORDER OF SYNTHETIC TEST BANK') }));
  const unapproved = structuredClone(c); unapproved.id = crypto.randomUUID(); await seed(unapproved);
  const beforeUnapproved = models;
  const refused = (await run(unapproved, { type: 'reply', reply: 'available', docs })).case;
  assert.equal(models, beforeUnapproved); assert.deepEqual(refused.docs, c.docs); assert.equal(refused.approval, undefined);
  assert.ok(refused.events.some(e => e.title === 'Live action failed' && /approval matching/.test(e.detail)));
  c = (await run(c, { type: 'approve' })).case;
  const approved = structuredClone(c);
  assert.equal(c.approval.documentVersions, documentVersions(c)); assert.equal(c.approval.planId, c.recoveryPlan.id);
  const tampered = structuredClone(c); tampered.id = crypto.randomUUID();
  tampered.approval.documentVersions = documentVersions({ docs: original.lcAssessmentHistory.at(-1).previous.docs });
  await seed(tampered); const beforeRejected = models;
  const rejected = (await run(tampered, { type: 'reply', reply: 'available', docs })).case;
  assert.equal(models, beforeRejected); assert.deepEqual(rejected.docs, tampered.docs);
  assert.ok(rejected.events.some(e => e.title === 'Live action failed' && /approval matching/.test(e.detail)));
  c = (await run(c, { type: 'reply', reply: 'available', docs })).case;
  assert.equal(c.status, 'received'); assert.deepEqual(c.docs.map(d => d.version), [2, 2, 2]);
  assert.equal(c.approval, undefined); assert.equal(c.recoveryPlan, undefined); assert.equal(c.statements.length, 0);
  assert.deepEqual(c.planHistory.at(-1).approval, approved.approval);
  assert.deepEqual(c.priorAssessments.at(-1).statements, approved.statements);
  const recheckStart = modelInputs.length;
  c = (await run(c, { type: 'recheck' })).case;
  assert.equal(c.status, 'reviewed'); assert.equal(c.revision, 9); assert.equal(c.deadline, '2026-10-21'); assert.deepEqual(c.findings, []);
  assert.deepEqual(modelInputs.slice(recheckStart).map(v => [v.input.kind, v.input.version]).sort(), [['bl', 2], ['invoice', 2], ['lc', 2]]);
  assert.deepEqual(c.lcAssessmentHistory, original.lcAssessmentHistory);
  for (const doc of original.docs) assert.ok(c.history.some(d => d.kind === doc.kind && d.version === doc.version && d.text === doc.text));
  assert.ok(c.history.some(d => d.kind === 'lc' && d.version === 1));
  assert.deepEqual((await saved(c.id)).case, c);
});

test('demo dismissal and failure branches preserve active analysis and make zero outbound calls', async () => {
  const c = await investigated(), before = [models, exports];
  const p = await run(c, stageRequest(c, { expiry: '2026-10-20' }));
  const dismissed = await run(p.case, { type: 'dismiss_lc', ...p.lcAssessmentRequest });
  assert.deepEqual(business(dismissed.case), business(c)); assert.equal(dismissed.case.pendingLcAssessment, undefined);
  assert.equal(dismissed.case.lcAssessmentHistory.at(-1).outcome, 'dismissed');
  assert.deepEqual((await saved(c.id)).case, dismissed.case);
  await run(dismissed.case, stageRequest(dismissed.case, { reference: 'WRONG-LC' }), 400);
  await run(dismissed.case, stageRequest(dismissed.case, { expiry: '2026-02-30' }), 400);
  await run(dismissed.case, { ...selection(p), revision: dismissed.case.revision }, 409);
  assert.deepEqual([models, exports], before);
});

test('live dismissal preserves original approval and analysis with no model execution', async () => {
  let c = await investigated('live'); c = (await run(c, { type: 'approve' })).case;
  const p = await run(c, stageRequest(c, { expiry: '2026-10-20' })), before = models;
  const dismissed = await run(p.case, { type: 'dismiss_lc', ...p.lcAssessmentRequest });
  assert.equal(models, before); assert.deepEqual(business(dismissed.case), business(c));
  assert.equal(dismissed.case.lcAssessmentHistory.at(-1).outcome, 'dismissed');
  assert.deepEqual((await saved(c.id)).case, dismissed.case);
});

test('live wrong reference and ungrounded/missing/mislabeled extraction are rejected with retained analysis and truthful failed traces', async () => {
  for (const mode of ['normal', 'invent', 'missing', 'mislabel']) {
    const c = await investigated('live'), before = models; extractionMode = mode;
    const p = await run(c, stageRequest(c, mode === 'normal' ? { reference: 'OTHER-LC' } : { expiry: '2026-10-20' }), mode === 'normal' || mode === 'mislabel' ? 400 : 502);
    extractionMode = 'normal'; assert.equal(models - before, 1); assert.equal(p.case.pendingLcAssessment, undefined);
    assert.deepEqual(business(p.case), business(c)); assert.equal(p.case.modelRuns, c.modelRuns + 1);
    const tree = trees.at(-1); assert.equal(tree.status, 'ERROR'); assert.ok(tree.children.some(n => n.kind === 'AGENT'));
    assert.ok(!JSON.stringify(tree).includes('SECRET_PROVIDER_OUTPUT'));
    assert.deepEqual((await saved(c.id)).case, p.case);
  }
});

test('unprovable current invoice/B/L grounding returns an explicit fresh-investigation requirement before models', async () => {
  const c = newCase('live', fixtureDocs(), '2026-10-10'); for (const doc of c.docs) c.fields[doc.kind] = parseFixture(doc); finishInvestigation(c);
  delete c.fields.invoice.amount; c.docs[2].text = c.docs[2].text.replace('2026-10-08', '2026-10-07'); await seed(c);
  const before = models, p = await run(c, stageRequest(c, { expiry: '2026-10-20' }), 400);
  assert.equal(p.code, 'fresh_investigation_required'); assert.deepEqual(p.freshInvestigationRequired, ['invoice', 'bl']); assert.equal(models, before);
  assert.deepEqual((await saved(c.id)).case, c);
});

test('unsupported changed clauses cannot be cleared by reviewer assertions or feasible timing', async () => {
  let c = await investigated(); const p = await run(c, stageRequest(c, { expiry: '2026-10-20' }, '\nInsurance certificate and two signed originals required.'));
  assert.equal(p.case.pendingLcAssessment.outsideCoverage.unresolved, true);
  c = (await run(p.case, selection(p))).case; assert.equal(c.status, 'stopped');
  c = (await run(c, { type: 'correspondence', sender: 'exporter', text: 'We will send the invoice on 2026-10-12.' })).case;
  c = (await run(c, { type: 'correspondence', sender: 'carrier', text: 'We will reissue the B/L on 2026-10-16.' })).case;
  assert.equal(c.recoveryPlan.timing, 'feasible'); assert.equal(c.status, 'stopped'); assert.equal(c.lcUpdateRequirements.outsideCoverageUnresolved, true);
  await run(c, { type: 'approve' }, 400); await run(c, { type: 'clear_specialist' }, 400);
});

test('stale stage model result cannot overwrite an intervening mutation', async () => {
  const c = await investigated('live'), gate = barrier(); holdModel = gate;
  const pending = request('/api/cases/' + c.id, { ...stageRequest(c, { expiry: '2026-10-20' }), revision: c.revision });
  await gate.entered.promise;
  const changed = await run(c, { type: 'evidence', evidence: { ...c.evidence, checkpoint: 'Synthetic newer edit' } });
  gate.release.resolve(); const p = await pending; assert.equal(p.status, 409); assert.equal(p.code, 'stale_case');
  const current = await saved(c.id); assert.deepEqual(current.case, changed.case); assert.equal(current.case.pendingLcAssessment, undefined);
  assert.equal(trees.at(-1).status, 'ERROR'); assert.ok(trees.at(-1).children.some(n => n.name === 'lc_snapshot_compare_and_swap' && n.status === 'ERROR'));
});

test('stale tokens and concurrent selections permit only one committed selection', async () => {
  const c = await investigated(), p = await run(c, stageRequest(c, { expiry: '2026-10-20' }));
  const staleStage = await run(c, stageRequest(c, { expiry: '2026-10-21' }), 409); assert.equal(staleStage.code, 'stale_case');
  await run(p.case, { ...selection(p), candidateBinding: '0'.repeat(64) }, 409);
  const changed = await run(p.case, { type: 'evidence', evidence: { ...p.case.evidence, checkpoint: 'Changed while pending' } });
  await run(changed.case, { ...selection(p), revision: changed.case.revision }, 409);
  const dismissed = await run(changed.case, { type: 'dismiss_lc', ...p.lcAssessmentRequest, revision: changed.case.revision });
  const fresh = await run(dismissed.case, stageRequest(dismissed.case, { expiry: '2026-10-20' }));
  const results = await Promise.all([request('/api/cases/' + c.id, selection(fresh)), request('/api/cases/' + c.id, selection(fresh))]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const current = (await saved(c.id)).case; assert.equal(current.docs[0].version, 2); assert.equal(current.lcAssessmentHistory.filter(h => h.outcome === 'selected').length, 1);
});

test('receipt annotation after selected-basis persistence cannot overwrite intervening work', async () => {
  const c = await investigated('live'), p = await run(c, stageRequest(c, { expiry: '2026-10-20' })), gate = barrier(); holdTrace = gate;
  const selecting = request('/api/cases/' + c.id, selection(p)); await gate.entered.promise;
  const committed = (await saved(c.id)).case; assert.equal(committed.docs[0].version, 2); assert.equal(committed.approval, undefined);
  const newer = await run(committed, { type: 'evidence', evidence: { ...committed.evidence, checkpoint: 'Intervening edit after selection' } });
  gate.release.resolve(); const selected = await selecting; assert.equal(selected.status, 200); assert.equal(selected.telemetry.eventSaved, false);
  assert.deepEqual(selected.case, newer.case); assert.deepEqual((await saved(c.id)).case, newer.case);
  assert.equal(selected.operation.committedRevision, committed.revision);
});

test('drafting failure after successful selection retains selected basis, current timing and findings, blocks approval and supports reassess retry', async () => {
  let c = await investigated('live'); let p = await run(c, stageRequest(c, { expiry: '2026-10-20' }));
  c = (await run(p.case, selection(p))).case;
  c = (await run(c, { type: 'correspondence', sender: 'exporter', text: 'We will send the invoice on 2026-10-12.' })).case;
  failDrafts = true;
  c = (await run(c, { type: 'correspondence', sender: 'carrier', text: 'We will reissue the B/L on 2026-10-16.' })).case; failDrafts = false;
  assert.equal(c.docs[0].version, 2); assert.equal(c.status, 'stopped'); assert.equal(c.approval, undefined); assert.equal(c.recoveryPlan.timing, 'feasible');
  assert.equal(c.correspondence.length, 2); assert.equal(c.findings.length, 2); assert.equal(c.lcUpdateRequirements.draftingRequired, true);
  assert.ok(c.events.some(e => e.title === 'Drafting failed after LC selection')); assert.equal(trees.at(-1).status, 'ERROR');
  await run(c, { type: 'approve' }, 400);
  p = await run(c, { type: 'reassess' }); c = p.case;
  assert.equal(c.status, 'approval'); assert.equal(c.lcUpdateRequirements.draftingRequired, false); assert.equal(c.plan.carrierDraft, 'Synthetic current carrier draft.');
  c = (await run(c, { type: 'approve' })).case; assert.equal(c.approval.planId, c.recoveryPlan.id); assert.equal(c.docs[0].version, 2);
});

test('two rejected model proposals persist a stopped basis and successful extraction with exactly one repair and no extraction replay', async () => {
  let c = await investigated('live'), p = await run(c, stageRequest(c, { expiry: '2026-10-20' }));
  c = (await run(p.case, selection(p))).case;
  const before = models; invalidPlanner = true;
  try { c = (await run(c, { type: 'correspondence', sender: 'exporter', text: 'We will send the invoice on 2026-10-12.' })).case; }
  finally { invalidPlanner = false; }
  assert.equal(models - before, 3); assert.equal(c.docs[0].version, 2); assert.equal(c.status, 'stopped');
  assert.equal(c.modelAttempts, c.modelRuns);
  assert.equal(c.approval, undefined); assert.equal(c.recoveryPlan, undefined); assert.equal(c.correspondence.length, 1);
  assert.equal(c.statements[0].date, '2026-10-12'); assert.equal(c.planningFailures.at(-1).proposal.actions[0].evidenceRefs[0], 'missing:No supported carrier B/L availability date.');
  assert.equal(c.lcUpdateRequirements.timingConfirmationRequired, true);
  assert.ok(c.events.some(e => e.title === 'Recovery planning rejected'));
  const tree = trees.at(-1), guard = tree.children.find(n => n.name === 'recovery_plan_checks');
  assert.equal(tree.status, 'ERROR'); assert.equal(guard.status, 'ERROR'); assert.equal(guard.passed, false); assert.ok(guard.end);
  assert.equal(tree.children.filter(n => n.kind === 'AGENT').length, 3);
  assert.equal(tree.children.filter(n => n.name === 'remedy_planner_repair').length, 1);
  assert.equal(tree.children.filter(n => n.name === 'recovery_plan_checks' && n.status === 'ERROR').length, 2);
  assert.ok(tree.children.filter(n => n.kind === 'AGENT').every(n => Number.isInteger(n.children[0].metadata.attemptNumber)));
  await run(c, { type: 'approve' }, 400);
  const carrierBefore = models;
  c = (await run(c, { type: 'correspondence', sender: 'carrier', text: 'We will reissue the B/L on 2026-10-16.' })).case;
  assert.equal(models - carrierBefore, 4); assert.equal(c.status, 'approval'); assert.equal(c.correspondence.length, 2);
  assert.equal(c.planningFailures.length, 2); assert.equal(c.recoveryPlan.timing, 'feasible');
});

test('single supported planner repair validates current evidence without repeating successful extraction', async () => {
  let c = await investigated('live'), p = await run(c, stageRequest(c, { expiry: '2026-10-20' }));
  c = (await run(p.case, selection(p))).case;
  const before = models; invalidPlanner = 'once';
  try { c = (await run(c, { type: 'correspondence', sender: 'exporter', text: 'We will send the invoice on 2026-10-12.' })).case; }
  finally { invalidPlanner = false; }
  assert.equal(models - before, 3); assert.equal(c.correspondence.length, 1); assert.equal(c.statements.length, 1);
  assert.equal(c.status, 'stopped'); assert.equal(c.recoveryPlan.timing, 'unknown'); assert.equal(c.approval, undefined);
  assert.equal(c.planningFailures.length, 1); assert.ok(!c.events.some(e => e.title === 'Live action failed'));
  const tree = trees.at(-1); assert.equal(tree.status, 'OK');
  assert.equal(tree.children.filter(n => n.name === 'counterparty_coordinator').length, 1);
  assert.equal(tree.children.filter(n => n.name === 'remedy_planner_repair').length, 1);
  assert.deepEqual(tree.children.filter(n => n.name === 'recovery_plan_checks').map(n => n.status), ['ERROR', 'OK']);
});

test('failed repair provider request counts its attempt, preserves extraction and stops without another call', async () => {
  let c = await investigated('live'), p = await run(c, stageRequest(c, { expiry: '2026-10-20' }));
  c = (await run(p.case, selection(p))).case;
  const before = { models, attempts: c.modelAttempts, responses: c.modelRuns }; invalidPlanner = 'once'; failRepair = true;
  try { c = (await run(c, { type: 'correspondence', sender: 'exporter', text: 'We will send the invoice on 2026-10-12.' })).case; }
  finally { invalidPlanner = false; failRepair = false; }
  assert.equal(models - before.models, 3); assert.equal(c.modelAttempts - before.attempts, 3); assert.equal(c.modelRuns - before.responses, 2);
  assert.equal(c.status, 'stopped'); assert.equal(c.approval, undefined); assert.equal(c.correspondence.length, 1); assert.equal(c.statements.length, 1);
  assert.equal(c.recoveryPlan, undefined); assert.equal(c.planningFailures.length, 2);
  const tree = trees.at(-1); assert.equal(tree.status, 'ERROR');
  assert.equal(tree.children.find(n => n.name === 'remedy_planner_repair').children[0].status, 'ERROR');
  assert.ok(tree.children.every(n => n.end));
});

test('saved short extraction quotes stage through strict normalization and survive selection with original provider records', async () => {
  let c = await investigated('live');
  // Retain an exact original provider quotation independently of the supporting line.
  for (const kind of ['invoice', 'bl']) for (const item of Object.values(c.fields[kind])) item.quote = item.value;
  for (const record of c.extractionHistory) record.originalFields = structuredClone(c.fields[record.kind]);
  await db.prepare('UPDATE cases SET snapshot = ? WHERE id = ?').bind(JSON.stringify(c), c.id).run();
  const original = structuredClone(c.fields), before = models;
  const p = await run(c, stageRequest(c, { expiry: '2026-10-20' }));
  assert.equal(models - before, 1); assert.deepEqual(p.case.fields, original);
  assert.equal(p.case.pendingLcAssessment.sourceGrounding.previous.invoice.evidence.currency.providerQuote, 'EUR');
  assert.equal(p.case.pendingLcAssessment.sourceGrounding.previous.invoice.evidence.currency.sourceLine, 'currency: EUR');
  c = (await run(p.case, selection(p))).case;
  assert.equal(c.fields.invoice.currency.quote, 'currency: EUR');
  assert.deepEqual(c.lcAssessmentHistory.at(-1).previous.fields, original);
  assert.equal(c.extractionHistory.find(r => r.kind === 'invoice').originalFields.currency.quote, 'EUR');
  assert.deepEqual((await saved(c.id)).case.extractionHistory, c.extractionHistory);
});

test('trace rejection retains business results and compact finalized source-bound evidence without readback claims or secrets', async () => {
  const c = await investigated('live'); rejectTrace = true;
  let p = await run(c, stageRequest(c, { expiry: '2026-10-20' }, '\nSECRET_LC_MARKER')); const staged = p.case;
  p = await run(p.case, selection(p)); assert.equal(p.case.docs[0].version, 2); assert.equal(p.case.status, 'stopped');
  assert.equal(p.telemetry.acknowledged, false); assert.equal(p.telemetry.persistedReadback, false);
  assert.ok(p.case.events.some(e => e.title === 'Trace export failed'));
  assert.deepEqual((await saved(c.id)).case, p.case);
  for (const tree of trees.slice(-2)) {
    const text = JSON.stringify(tree); assert.ok(Buffer.byteLength(text) < 6144, `Trace ${Buffer.byteLength(text)} bytes`);
    assert.equal(tree.metadata.assessmentId, staged.pendingLcAssessment.id);
    for (const secret of ['synthetic-model-secret', 'nlw_synthetic-trace-secret', 'SECRET_LC_MARKER', staged.pendingLcAssessment.candidate.text, staged.pendingLcAssessment.candidateBinding, staged.pendingLcAssessment.assertion.note]) assert.ok(!text.includes(secret));
    const visit = n => { assert.ok(n.end); n.children.forEach(visit); }; visit(tree);
  }
  const current = p.case, next = await run(current, stageRequest(current, { expiry: '2026-10-21' }));
  await run(next.case, { type: 'dismiss_lc', ...next.lcAssessmentRequest }); rejectTrace = false;
});

test('legacy snapshots without LC-update fields remain compatible with the API and JSON persistence', async () => {
  const c = await investigated(); for (const key of ['pendingLcAssessment', 'lcAssessmentHistory', 'lcUpdateRequirements']) assert.equal(Object.hasOwn(c, key), false);
  const p = await run(c, stageRequest(c, { expiry: '2026-10-20' })); const serialized = (await saved(c.id)).case;
  assert.deepEqual(serialized.pendingLcAssessment, p.case.pendingLcAssessment);
  const selected = await run(serialized, selection(p)); assert.deepEqual((await saved(c.id)).case.lcAssessmentHistory, selected.case.lcAssessmentHistory);
});

test('large retained source bindings use bounded transport tokens and serialize through stage and selection', async () => {
  const c = await investigated(), before = [models, exports], extra = '\nUncovered synthetic clause: ' + 'x'.repeat(14500);
  const p = await run(c, stageRequest(c, { expiry: '2026-10-20' }, extra));
  assert.ok(JSON.stringify(p.case.pendingLcAssessment).length > 60000);
  assert.ok(JSON.stringify(selection(p)).length < 1024);
  const selected = await run(p.case, selection(p));
  assert.equal(selected.case.status, 'stopped');
  assert.equal(selected.case.lcAssessmentHistory.at(-1).assessment.sources.proposed.text, p.case.pendingLcAssessment.sources.proposed.text);
  assert.deepEqual((await saved(c.id)).case, selected.case);
  assert.ok(Buffer.byteLength(serializeSnapshot(selected.case)) <= MAX_SNAPSHOT_BYTES);
  assert.deepEqual([models, exports], before);
});

test('snapshot budget counts UTF-8 bytes at the exact boundary and refuses oversized writes without truncating evidence', async () => {
  const c = newCase('demo', fixtureDocs(), '2026-10-10'), baseline = Buffer.byteLength(JSON.stringify(c));
  c.evidence.checkpoint = 'x'.repeat(MAX_SNAPSHOT_BYTES - baseline);
  assert.equal(Buffer.byteLength(serializeSnapshot(c)), MAX_SNAPSHOT_BYTES);
  c.evidence.checkpoint += 'x'; assert.throws(() => serializeSnapshot(c), /storage budget/);
  c.evidence.checkpoint = 'é'.repeat(Math.floor((MAX_SNAPSHOT_BYTES - baseline) / 2) + 1);
  assert.ok(JSON.stringify(c).length < MAX_SNAPSHOT_BYTES); assert.throws(() => serializeSnapshot(c), /storage budget/);
  const large = newCase('demo', fixtureDocs(), '2026-10-10'); for (const doc of large.docs) large.fields[doc.kind] = parseFixture(doc); finishInvestigation(large);
  const largeBaseline = Buffer.byteLength(JSON.stringify(large)); large.evidence.checkpoint = 'x'.repeat(MAX_SNAPSHOT_BYTES - largeBaseline - 300); await seed(large);
  const rejected = await run(large, stageRequest(large, { expiry: '2026-10-20' }), 413);
  assert.equal(rejected.code, 'snapshot_too_large'); assert.deepEqual((await saved(large.id)).case, large);
});

test('every LC-update invocation, including planning failures, exports one compact finalized tree with source bindings', () => {
  const updateTrees = trees.filter(tree => tree.metadata?.assessmentId);
  assert.ok(updateTrees.some(tree => tree.name === 'lc-rescue.stage_lc'));
  assert.ok(updateTrees.some(tree => tree.name === 'lc-rescue.correspondence' && tree.status === 'ERROR'));
  assert.ok(updateTrees.some(tree => tree.name === 'lc-rescue.reassess'));
  for (const tree of updateTrees) {
    const text = JSON.stringify(tree);
    assert.ok(Buffer.byteLength(text) < 6144, `${tree.name} emitted ${Buffer.byteLength(text)} bytes`);
    assert.ok(Array.isArray(tree.metadata.sourceVersions));
    assert.ok(!text.includes('synthetic-model-secret')); assert.ok(!text.includes('nlw_synthetic-trace-secret'));
    const visit = n => { assert.ok(n.end); assert.ok(n.start <= n.end); n.children.forEach(child => { assert.ok(child.end <= n.end); visit(child); }); }; visit(tree);
  }
});
