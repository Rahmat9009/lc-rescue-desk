import { CaseError, basePlan, dateOK, documentVersions, plusDays, required, validate } from './domain.ts';
import type { Case, Doc, Fields, Finding, Kind } from './domain.ts';
import { checkedFields, normalizeSourceLines, sourceBinding } from './source-grounding.ts';
import type { SourceGrounding } from './source-grounding.ts';
export { sourceBinding } from './source-grounding.ts';

/** Exact, collision-free bindings, not hashes or authentication proofs. Do not export to telemetry. */
function binding(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
export function assessmentBinding(assessment: LcAssessment): string { return binding(assessment); }

export type GroundedInput = { documentBinding: string; fields: unknown; originalFields?: Fields };
export type ReviewerAssertion = { reviewer: string; at: string; completeText: true; note: string };
export type BasisAssertion = ReviewerAssertion & { selectForCoveredChecks: true; outsideCoverageReviewed: true };
type Evidence = { source: string; version: number; value: string; quote: string };
export type DeadlineBasis = { date: string; shipment: Evidence; expiry: Evidence; presentationDays: Evidence; shipmentPlusDays: string };
export type FindingDelta = { resolved: Finding[]; persistent: { before: Finding; after: Finding }[]; new: Finding[]; materiallyChanged: { before: Finding; after: Finding }[] };
export type LcRequirements = { documentVersions: string; timingConfirmationRequired: boolean; outsideCoverageUnresolved: boolean; specialistReviewRequired: boolean; draftingRequired?: boolean };
export type FollowUp = 'confirm_current_timing' | 'review_outside_coverage' | 'specialist_review' | 'fresh_request_approval' | 'full_presentation_review';
export type LcAssessment = {
  id: string; stagedRevision: number; baseRevision: number; baseBinding: string; baseStateBinding: string;
  candidateBinding: string; candidate: Doc; sources: { previous: Doc; proposed: Doc }; assertion: ReviewerAssertion;
  asOf: string; fields: Record<Kind, Fields>;
  sourceGrounding?: { previous: Record<Kind, SourceGrounding>; candidate: SourceGrounding };
  coveredTerms: { field: string; before: Evidence; after: Evidence; changed: boolean }[];
  deadlines: { before: DeadlineBasis; after: DeadlineBasis }; findings: FindingDelta;
  outsideCoverage: { unresolved: boolean; previousRemainder: string; proposedRemainder: string; reason: string };
  affected: { approval?: Case['approval']; plan?: Case['plan']; recoveryPlan?: Case['recoveryPlan']; replyAssessment?: Case['replyAssessment']; correspondence: NonNullable<Case['correspondence']> };
  limitations: string[];
};
export type AnalysisSnapshot = Pick<Case, 'docs' | 'history' | 'fields' | 'findings' | 'deadline' | 'status' | 'asOf' | 'plan' | 'approval' | 'recoveryPlan' | 'replyAssessment' | 'correspondence' | 'statements' | 'lcUpdateRequirements' | 'extractionHistory'>;
export type LcAssessmentAudit = { outcome: 'selected' | 'dismissed' | 'superseded'; assessment: LcAssessment; at: string; resultingRevision: number; previous?: AnalysisSnapshot; selection?: BasisAssertion };
export type StageInput = { revision: number; assessmentId: string; candidate: Doc; extraction: GroundedInput; assertion: ReviewerAssertion; asOf: string; documentEvidence?: Partial<Record<'invoice' | 'bl', GroundedInput>> };
export type AssessmentRequest = { revision: number; assessmentId: string; assessmentBinding: string; candidateBinding: string; baseBinding: string };
export type SelectInput = AssessmentRequest & { assertion: BasisAssertion; asOf: string };
export class FreshInvestigationRequired extends CaseError {
  documents: Kind[];
  constructor(documents: Kind[]) { super(`Fresh investigation required: grounding against the exact current ${documents.join(', ')} documents could not be established.`); this.documents = documents; }
}

function snapshot(c: Case): AnalysisSnapshot {
  return structuredClone({ docs: c.docs, history: c.history, fields: c.fields, findings: c.findings, deadline: c.deadline, status: c.status, asOf: c.asOf,
    plan: c.plan, approval: c.approval, recoveryPlan: c.recoveryPlan, replyAssessment: c.replyAssessment,
    correspondence: c.correspondence, statements: c.statements, lcUpdateRequirements: c.lcUpdateRequirements, extractionHistory: c.extractionHistory });
}
function assertionOK(a: ReviewerAssertion): void {
  if (!a || a.completeText !== true || typeof a.reviewer !== 'string' || !a.reviewer.trim() || a.reviewer.length > 120 ||
    typeof a.note !== 'string' || !a.note.trim() || a.note.length > 1000 || typeof a.at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(a.at) || !dateOK(a.at.slice(0, 10)) || !Number.isFinite(Date.parse(a.at)))
    throw new CaseError('An explicit, dated reviewer assertion that this is complete LC text is required.');
}
function revisionOK(c: Case, revision: number): void {
  if (revision !== c.revision) throw new CaseError('Case changed. Refresh before continuing.', 409);
}
function dateBasisOK(c: Case, asOf: string): void {
  if (!dateOK(asOf) || asOf < c.asOf) throw new CaseError('A current analysis date on or after the saved case date is required.');
}
function activeDoc(c: Case, kind: Kind): Doc {
  const docs = c.docs.filter(doc => doc.kind === kind);
  if (docs.length !== 1 || !Number.isSafeInteger(docs[0].version) || docs[0].version < 1) throw new CaseError('Current document versions are invalid.');
  return docs[0];
}
function extract(doc: Doc, input: GroundedInput): Fields {
  if (!input || input.documentBinding !== sourceBinding(doc)) throw new CaseError('Stale extraction document binding.', 409);
  if (input.originalFields) {
    const normalized = normalizeSourceLines(doc, input.originalFields, input.documentBinding);
    if (binding(normalized.fields) !== binding(input.fields)) throw new CaseError('Normalized source lines do not match original extraction.');
  }
  return checkedFields(doc, input.fields);
}
/** Preflight for orchestration: no model call can repair unproved cached document grounding. */
export function currentGroundedFields(c: Case): Record<Kind, Fields> {
  const fields = {} as Record<Kind, Fields>, missing: Kind[] = [];
  for (const kind of ['lc', 'invoice', 'bl'] as const) {
    const doc = activeDoc(c, kind);
    try { fields[kind] = cachedSourceGrounding(c, doc).fields; } catch { missing.push(kind); }
  }
  if (missing.length) throw new FreshInvestigationRequired(missing);
  return fields;
}
function cachedSourceGrounding(c: Case, doc: Doc): SourceGrounding {
  const saved = c.extractionHistory?.filter(record => record.kind === doc.kind).at(-1);
  if (saved && (saved.version !== doc.version || saved.kind !== doc.kind || saved.documentBinding !== sourceBinding(doc))) throw new CaseError('Stale cached extraction document binding.', 409);
  // Legacy snapshots have no provenance field. Strictly revalidate their exact
  // saved quotations against the current source; record this origin as legacy.
  const current = normalizeSourceLines(doc, c.fields[doc.kind], saved?.documentBinding ?? sourceBinding(doc));
  if (!saved) return current;
  const original = normalizeSourceLines(doc, saved.originalFields, saved.documentBinding);
  if (binding(original.fields) !== binding(current.fields)) throw new CaseError('Cached fields no longer match their version-bound original extraction.');
  return original;
}
function evidence(doc: Doc, fields: Fields, key: string): Evidence {
  return { source: sourceBinding(doc), version: doc.version, ...fields[key] };
}
function deadline(lc: Doc, bl: Doc, fields: Record<Kind, Fields>): DeadlineBasis {
  const shipment = evidence(bl, fields.bl, 'shipment_date'), expiry = evidence(lc, fields.lc, 'expiry'), presentationDays = evidence(lc, fields.lc, 'presentation_days');
  const shipmentPlusDays = plusDays(shipment.value, Number(presentationDays.value));
  if (!dateOK(shipmentPlusDays)) throw new CaseError('Calculated deadline is outside supported calendar dates.');
  return { date: [expiry.value, shipmentPlusDays].sort()[0], shipment, expiry, presentationDays, shipmentPlusDays };
}
/** Mask only the extracted values, keeping every other character, including clause context.
 * A broad quote cannot hide a newly added unsupported requirement. */
function remainder(doc: Doc, fields: Fields): string {
  const spans = Object.entries(fields).map(([key, item]) => {
    // Locate the validated whole line, not an earlier incidental substring.
    let lineStart = doc.text.indexOf(item.quote);
    while (lineStart >= 0) {
      const end = lineStart + item.quote.length;
      if ((lineStart === 0 || doc.text[lineStart - 1] === '\n') &&
        (end === doc.text.length || doc.text[end] === '\n' || doc.text.slice(end, end + 2) === '\r\n')) break;
      lineStart = doc.text.indexOf(item.quote, lineStart + 1);
    }
    if (lineStart < 0) throw new CaseError('Whole source line is not grounded.');
    return { key, start: lineStart + item.quote.indexOf(item.value), length: item.value.length };
  });
  spans.sort((a, b) => b.start - a.start);
  let text = doc.text, previousStart = doc.text.length;
  for (const span of spans) {
    if (span.start + span.length > previousStart) throw new CaseError('Overlapping source evidence is ambiguous.');
    text = text.slice(0, span.start) + `<covered:${span.key}>` + text.slice(span.start + span.length);
    previousStart = span.start;
  }
  return text;
}
export function findingDelta(before: Finding[], after: Finding[]): FindingDelta {
  const result: FindingDelta = { resolved: [], persistent: [], new: [], materiallyChanged: [] };
  const material = (f: Finding) => binding({ id: f.id, doc: f.doc, field: f.field, expected: f.expected, actual: f.actual, severity: f.severity, owner: f.owner, title: f.title });
  for (const old of before) {
    const next = after.find(f => f.id === old.id);
    if (!next) result.resolved.push(old);
    else result[material(old) === material(next) ? 'persistent' : 'materiallyChanged'].push({ before: old, after: next });
  }
  result.new = after.filter(f => !before.some(old => old.id === f.id));
  return structuredClone(result);
}
function evaluate(c: Case, candidate: Doc, fields: Record<Kind, Fields>, asOf: string): { findings: Finding[]; deadline: string | undefined } {
  const trial = structuredClone(c);
  trial.docs = trial.docs.map(doc => doc.kind === 'lc' ? candidate : doc);
  trial.fields = structuredClone(fields); trial.asOf = asOf;
  return { findings: validate(trial), deadline: trial.deadline };
}
function event(c: Case, at: string, actor: string, title: string, detail: string): void { c.events.push({ at, actor, title, detail }); }

export function stageLcAssessment(c: Case, input: StageInput): Case {
  revisionOK(c, input.revision); assertionOK(input.assertion); dateBasisOK(c, input.asOf);
  if (c.status === 'new' || !c.fields.lc) throw new CaseError('Investigate the current case before assessing a revised LC.');
  if (typeof input.assessmentId !== 'string' || !input.assessmentId.trim() || input.assessmentId.length > 120 ||
    c.pendingLcAssessment?.id === input.assessmentId || c.lcAssessmentHistory?.some(a => a.assessment.id === input.assessmentId)) throw new CaseError('Use a new assessment identifier.');
  const lc = activeDoc(c, 'lc'), bl = activeDoc(c, 'bl'); activeDoc(c, 'invoice');
  const candidate = input.candidate;
  if (!candidate || candidate.kind !== 'lc' || candidate.version !== lc.version + 1 || !Number.isSafeInteger(candidate.version) ||
    typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.length > 120 || typeof candidate.text !== 'string' ||
    !candidate.text.trim() || candidate.text.length > 16000 || typeof candidate.synthetic !== 'boolean') throw new CaseError('Provide a complete proposed LC at the next LC version, up to 16,000 characters.');
  const proposed = extract(candidate, input.extraction);
  const fields = {} as Record<Kind, Fields>;
  const previousGrounding = {} as Record<Kind, SourceGrounding>;
  const missing: Kind[] = [];
  for (const kind of ['lc', 'invoice', 'bl'] as const) {
    const doc = activeDoc(c, kind), supplied = kind === 'lc' ? undefined : input.documentEvidence?.[kind];
    try {
      if (supplied) extract(doc, supplied);
      const grounding = supplied ? normalizeSourceLines(doc, supplied.originalFields ?? supplied.fields, supplied.documentBinding) : cachedSourceGrounding(c, doc);
      previousGrounding[kind] = grounding; fields[kind] = grounding.fields;
    } catch (error) { if (supplied) throw error; missing.push(kind); }
  }
  if (missing.length) throw new FreshInvestigationRequired(missing);
  if (proposed.reference.value !== fields.lc.reference.value) throw new CaseError('Proposed LC reference must match the investigated LC reference.');
  const proposedFields = { ...fields, lc: proposed };
  const previousRemainder = remainder(lc, fields.lc), proposedRemainder = remainder(candidate, proposed);
  const unresolved = previousRemainder !== proposedRemainder || !!c.lcUpdateRequirements?.outsideCoverageUnresolved;
  const assessment: LcAssessment = {
    id: input.assessmentId, baseRevision: c.revision, stagedRevision: c.revision + 1, baseBinding: documentVersions(c), baseStateBinding: binding(snapshot(c)),
    candidateBinding: sourceBinding(candidate), candidate: structuredClone(candidate), sources: { previous: structuredClone(lc), proposed: structuredClone(candidate) },
    assertion: structuredClone(input.assertion), asOf: input.asOf, fields: structuredClone(proposedFields),
    sourceGrounding: { previous: previousGrounding, candidate: normalizeSourceLines(candidate, input.extraction.originalFields ?? input.extraction.fields, input.extraction.documentBinding) },
    coveredTerms: required.lc.map(field => ({ field, before: evidence(lc, fields.lc, field), after: evidence(candidate, proposed, field), changed: fields.lc[field].value !== proposed[field].value })),
    deadlines: { before: deadline(lc, bl, fields), after: deadline(candidate, bl, proposedFields) },
    findings: findingDelta(evaluate(c, lc, fields, input.asOf).findings, evaluate(c, candidate, proposedFields, input.asOf).findings),
    outsideCoverage: { unresolved, previousRemainder, proposedRemainder, reason: unresolved ? 'Changed source text outside extracted values, or earlier unresolved clauses. Specialist review remains required.' : 'No change detected outside extracted values. This is not a complete requirement inventory.' },
    affected: structuredClone({ approval: c.approval, plan: c.plan, recoveryPlan: c.recoveryPlan, replyAssessment: c.replyAssessment, correspondence: c.correspondence || [] }),
    limitations: ['Complete text is a human assertion, not independently verified.', 'Selection establishes only the prototype analysis basis; amendment effectiveness, authenticity and bank approval are unverified.', 'Only the existing seven LC fields and invoice/B/L checks are covered.', 'Bank calendars, cutoffs, originals, signatures and full presentation review remain outside coverage.'],
  };
  const n = structuredClone(c);
  if (n.pendingLcAssessment) n.lcAssessmentHistory = [...(n.lcAssessmentHistory || []), { outcome: 'superseded', assessment: n.pendingLcAssessment, at: input.assertion.at, resultingRevision: n.revision + 1 }];
  n.pendingLcAssessment = assessment; n.revision++;
  event(n, input.assertion.at, input.assertion.reviewer, 'Revised LC assessment staged', 'Active sources and decisions retained. Completeness asserted by reviewer; pending assessment requires selection or dismissal.');
  return n;
}

function pending(c: Case, input: AssessmentRequest): LcAssessment {
  revisionOK(c, input.revision);
  const assessment = c.pendingLcAssessment;
  if (!assessment || assessment.id !== input.assessmentId || assessment.stagedRevision !== c.revision ||
    assessment.baseBinding !== documentVersions(c) || input.baseBinding !== assessment.baseBinding ||
    assessment.baseStateBinding !== binding(snapshot(c)) || input.candidateBinding !== assessment.candidateBinding ||
    assessment.candidateBinding !== sourceBinding(assessment.candidate) || input.assessmentBinding !== assessmentBinding(assessment))
    throw new CaseError('Stale assessment, candidate or base-document binding. Stage a fresh assessment.', 409);
  return assessment;
}
export function selectLcBasis(c: Case, input: SelectInput): { case: Case; followUp: FollowUp[] } {
  const assessment = pending(c, input);
  assertionOK(input.assertion); dateBasisOK(c, input.asOf);
  if (input.asOf < assessment.asOf || input.assertion.selectForCoveredChecks !== true || input.assertion.outsideCoverageReviewed !== true)
    throw new CaseError('Explicit reviewer selection and acknowledgment of external review of uncovered changes are required.');
  // Revalidate saved extraction against exact sources; never trust a stored success flag or diff.
  const fields = {} as Record<Kind, Fields>;
  for (const kind of ['lc', 'invoice', 'bl'] as const) fields[kind] = checkedFields(kind === 'lc' ? assessment.candidate : activeDoc(c, kind), assessment.fields[kind]);
  if (assessment.sourceGrounding) {
    for (const doc of [...c.docs, assessment.candidate]) {
      const saved = doc === assessment.candidate ? assessment.sourceGrounding.candidate : assessment.sourceGrounding.previous[doc.kind];
      const normalized = normalizeSourceLines(doc, saved.originalFields, saved.documentBinding);
      if (binding(normalized) !== binding(saved)) throw new CaseError('Saved source normalization evidence is inconsistent.');
    }
  }
  const oldLc = activeDoc(c, 'lc'), oldFields = cachedSourceGrounding(c, oldLc).fields;
  if (fields.lc.reference.value !== oldFields.reference.value) throw new CaseError('Proposed LC reference must match the investigated LC reference.');
  const outsideUnresolved = remainder(oldLc, oldFields) !== remainder(assessment.candidate, fields.lc) || !!c.lcUpdateRequirements?.outsideCoverageUnresolved;
  const n = structuredClone(c), previous = snapshot(c);
  for (const doc of c.docs) if (!n.history.some(old => sourceBinding(old) === sourceBinding(doc))) n.history.push(structuredClone(doc));
  n.docs = n.docs.map(doc => doc.kind === 'lc' ? structuredClone(assessment.candidate) : doc);
  n.history.push(structuredClone(assessment.candidate));
  n.fields = fields; n.asOf = input.asOf;
  if (assessment.sourceGrounding) {
    n.extractionHistory = [...(n.extractionHistory || []), ...Object.values(assessment.sourceGrounding.previous).map(grounding => ({ ...structuredClone(grounding), origin: 'cached_fields_revalidated' as const, at: input.assertion.at })), { ...structuredClone(assessment.sourceGrounding.candidate), origin: 'lc_assessment' as const, at: input.assertion.at }];
  }
  n.approval = undefined; n.plan = undefined; n.recoveryPlan = undefined; n.replyAssessment = undefined;
  if (c.plan || c.recoveryPlan) n.planHistory = [...(n.planHistory || []), { plan: structuredClone(c.recoveryPlan || c.plan!), approval: structuredClone(c.approval), at: input.assertion.at }];
  if (c.statements?.length) n.priorAssessments = [...(n.priorAssessments || []), { at: input.assertion.at, statements: structuredClone(c.statements) }];
  n.statements = []; // Old statements remain in audit; old correspondence keeps its original sourceVersions.
  n.findings = validate(n);
  const specialist = n.findings.some(f => f.severity === 'review' || ['expiry', 'shipment_date', 'lc_reference'].includes(f.field));
  const corrections = n.findings.some(f => f.doc === 'invoice' || f.doc === 'bl');
  n.lcUpdateRequirements = { documentVersions: documentVersions(n), timingConfirmationRequired: corrections && !specialist,
    outsideCoverageUnresolved: outsideUnresolved, specialistReviewRequired: specialist };
  const followUp: FollowUp[] = [];
  if (outsideUnresolved) followUp.push('review_outside_coverage');
  if (specialist) followUp.push('specialist_review');
  if (corrections && !specialist) { n.plan = { ...basePlan(n), documentVersions: documentVersions(n) }; followUp.push('confirm_current_timing', 'fresh_request_approval'); }
  if (!n.findings.length) followUp.push('full_presentation_review');
  n.status = n.findings.length || outsideUnresolved ? 'stopped' : 'reviewed';
  n.pendingLcAssessment = undefined; n.revision++;
  n.lcAssessmentHistory = [...(n.lcAssessmentHistory || []), { outcome: 'selected', assessment: structuredClone(assessment), at: input.assertion.at, resultingRevision: n.revision, previous, selection: structuredClone(input.assertion) }];
  event(n, input.assertion.at, input.assertion.reviewer, 'Proposed LC selected for covered checks', `Previous analysis and decisions archived. Fresh timing and request approval required for corrections. Follow-up: ${followUp.join(', ')}. No amendment acceptance, authenticity or bank approval established.`);
  return { case: n, followUp };
}
export function dismissLcAssessment(c: Case, input: AssessmentRequest & { reviewer: string; at: string }): Case {
  revisionOK(c, input.revision);
  const assessment = c.pendingLcAssessment;
  // Dismissal can retire a stale assessment, but must still identify its exact immutable content.
  if (!assessment || assessment.id !== input.assessmentId || input.assessmentBinding !== assessmentBinding(assessment) ||
    input.baseBinding !== assessment.baseBinding || input.candidateBinding !== assessment.candidateBinding) throw new CaseError('Stale assessment binding.', 409);
  assertionOK({ reviewer: input.reviewer, at: input.at, completeText: true, note: 'Dismiss assessment' });
  const n = structuredClone(c); n.pendingLcAssessment = undefined; n.revision++;
  n.lcAssessmentHistory = [...(n.lcAssessmentHistory || []), { outcome: 'dismissed', assessment: structuredClone(assessment), at: input.at, resultingRevision: n.revision }];
  event(n, input.at, input.reviewer, 'Revised LC assessment dismissed', 'Active business state retained; proposed source and assessment retained in audit.');
  return n;
}
