import { CaseError, dateOK, groundedFields, required } from './domain.ts';
import type { Doc, Fields } from './domain.ts';

/** An exact source binding; never export the serialized source to telemetry. */
export function sourceBinding(doc: Doc): string {
  return JSON.stringify(doc, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
export type SourceGrounding = {
  documentBinding: string; kind: Doc['kind']; version: number;
  originalFields: Fields; fields: Fields;
  evidence: Record<string, { providerQuote: string; sourceLine: string; lineNumber: number; version: number }>;
};
export type ExtractionRecord = {
  documentBinding: string; kind: Doc['kind']; version: number; originalFields: Fields;
  at: string; origin: 'investigator' | 'cached_fields_revalidated' | 'lc_assessment';
  fields?: Fields; evidence?: SourceGrounding['evidence'];
};

/** Diagnostic per field, using exactly the strict pre-adapter checks. */
export function groundingIssues(doc: Doc, fields: Fields): { field: string; reason: string }[] {
  return required[doc.kind].flatMap(field => {
    try { const item = fields[field]; if (!item) throw new CaseError('Missing source evidence.'); checkedField(doc, field, item); return []; }
    catch (error) { return [{ field, reason: error instanceof Error ? error.message : 'Invalid source evidence.' }]; }
  });
}

function escape(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Conservative literal validation. Each quote must be a complete, unique source line.
 * This does not verify semantic interpretation, completeness or authenticity. Unsupported
 * layouts/alternatives require fresh investigation, never a guessed value or amendment merge. */
export function checkedFields(doc: Doc, raw: unknown): Fields {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !required[doc.kind].includes(key)))
    throw new CaseError('Invalid grounded fields or unsupported extraction claims.');
  const fields = groundedFields(doc, raw);
  for (const key of required[doc.kind]) {
    const item = fields[key];
    if (!item) throw new CaseError(`Missing grounded ${doc.kind}.${key}.`);
    const original = (raw as Record<string, object>)[key];
    if (Object.keys(original).sort().join(',') !== 'quote,value') throw new CaseError(`Unsupported extraction claims for ${key}.`);
    checkedField(doc, key, item);
  }
  return fields;
}
function checkedField(doc: Doc, key: string, item: Fields[string]): void {
    const lines = doc.text.split(/\r?\n/);
    const labeled = lines.filter(line => new RegExp(`^\\s*${key}\\s*:`, 'i').test(line));
    if (item.value.length > 200 || lines.filter(line => line === item.quote).length !== 1 ||
      labeled.length > 1 ||
      /\b(or|either|alternatively|unknown|unclear)\b/i.test(item.quote)) throw new CaseError(`Ambiguous or incomplete source quotation for ${key}.`);
    if (labeled.length === 1 && labeled[0] !== item.quote) throw new CaseError(`Source quotation does not match the ${key} field label.`);
    const matches = [...item.quote.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_.-])${escape(item.value)}(?![\\p{L}\\p{N}_.-])`, 'gu'))];
    if (matches.length !== 1) throw new CaseError(`Ambiguous source value for ${key}.`);
    if (['expiry', 'latest_shipment', 'shipment_date'].includes(key) &&
      (!dateOK(item.value) || [...item.quote.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].length !== 1)) throw new CaseError(`Invalid or ambiguous date for ${key}.`);
    if (['max_amount', 'amount', 'presentation_days'].includes(key) &&
      (!/^\d+(\.\d+)?$/.test(item.value) || !Number.isFinite(Number(item.value)) || Number(item.value) <= 0 ||
      [...item.quote.matchAll(/\d+(?:[.,]\d+)*/g)].length !== 1)) throw new CaseError(`Invalid or ambiguous numeric value for ${key}.`);
    if (['max_amount', 'amount'].includes(key) && (!/^\d+(?:\.\d{1,2})?$/.test(item.value) || Number(item.value) > 1e12))
      throw new CaseError(`Unsupported numeric precision or range for ${key}.`);
    if (key === 'presentation_days' && (!Number.isInteger(Number(item.value)) || Number(item.value) > 365)) throw new CaseError('Unsupported presentation period.');
    if (key === 'currency' && (!/^[A-Z]{3}$/.test(item.value) || [...item.quote.matchAll(/\b[A-Z]{3}\b/g)].length !== 1)) throw new CaseError('Invalid or ambiguous currency.');
}

/** Exact excerpts only. Field labels and literal token boundaries use the same
 * strict validator to exclude incidental prefixes; multiple supporting lines fail.
 * Original quotations are never overwritten by this adapter. */
export function normalizeSourceLines(doc: Doc, raw: unknown, documentBinding: string): SourceGrounding {
  if (!required[doc.kind] || !Number.isSafeInteger(doc.version) || doc.version < 1) throw new CaseError('Invalid extraction source version.');
  if (documentBinding !== sourceBinding(doc)) throw new CaseError('Stale extraction document binding.', 409);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !required[doc.kind].includes(key)))
    throw new CaseError('Invalid grounded fields or unsupported extraction claims.');
  const originalFields = groundedFields(doc, raw), fields: Fields = {}, evidence: SourceGrounding['evidence'] = {};
  const lines = doc.text.split(/\r?\n/);
  for (const key of required[doc.kind]) {
    const item = originalFields[key], original = (raw as Record<string, unknown>)[key];
    if (!item) throw new CaseError(`Missing grounded ${doc.kind}.${key}.`);
    if (!original || Object.keys(original).sort().join(',') !== 'quote,value') throw new CaseError(`Unsupported extraction claims for ${key}.`);
    const matches = lines.flatMap((line, i) => {
      if (!line.includes(item.quote)) return [];
      try { checkedField(doc, key, { value: item.value, quote: line }); return [{ line, number: i + 1 }]; }
      catch { return []; }
    });
    if (matches.length !== 1) throw new CaseError(`No unique strictly supporting source line for ${doc.kind}.${key}.`);
    fields[key] = { value: item.value, quote: matches[0].line };
    evidence[key] = { providerQuote: item.quote, sourceLine: matches[0].line, lineNumber: matches[0].number, version: doc.version };
  }
  checkedFields(doc, fields);
  return { documentBinding, kind: doc.kind, version: doc.version, originalFields: structuredClone(originalFields), fields, evidence };
}
