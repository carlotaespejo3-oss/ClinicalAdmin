import type { Email, AiClassification } from './types';
import type { RegistryItem, ServerCitation } from './evidenceStore';

// AI source-matching for Stage 3. The clinician has pre-vetted a small
// registry of clinical-guideline pointers (evidence_sources). For a
// given clinical email, this module asks the AI to select ONLY rows
// from that registry that are directly relevant. It NEVER asks the AI
// to invent a source, write a URL, or author a clinical rationale.
//
// Design invariants (signed off with the clinician):
//   1. The AI may only return sourceIds that exist in the registry it
//      was given. Anything else is dropped client-side (and again at
//      the server, which has an orphan-ID guard).
//   2. The per-citation flag is the four-letter vocab {A, B, C, D} or
//      null. Free-text rationale (`flagText`) is ALWAYS forced to
//      null in Stage 3 — clinician review writes that field later.
//   3. The empty array `{ "citations": [] }` is a legitimate outcome.
//      The store persists it as a no-match marker so the matcher
//      never re-asks for the same email.
//   4. The view's "No verified clinical source available" panel is
//      the only failure surface — we never silently fall back to a
//      generic answer.

export type RunPrompt = (prompt: string) => Promise<string>;

const VALID_FLAGS = new Set(['A', 'B', 'C', 'D']);

const SYSTEM = `You are an evidence-base lookup assistant for an Australian / NHS CAMHS consultant. You will be given ONE clinical email and a registry of clinical guideline sources the clinician has pre-vetted. Your job is to select ONLY sources from that registry that are directly relevant to the clinical question in the email, AND surface a per-email prescribing warning when the email mentions a specific drug or dose.

ABSOLUTE RULES:
- NEVER invent a source. Use ONLY the integer "id" values shown in the registry.
- NEVER cite a source that is not in the registry.
- If NO source in the registry is directly relevant, return {"citations": [], "prescribingWarning": null}. An honest "no match" is always preferable to a weak or tangential citation.
- Return JSON only — no preamble, no markdown fences, no commentary.
- Use UK English in any free text.

PRESCRIBING WARNING:
- If the email mentions a specific drug or dose (e.g. methylphenidate 36 mg, sertraline, dexamfetamine), return a SINGLE plain sentence of UK English (≤200 chars) naming the drug and pointing the clinician at the Australian therapeutic resources to verify (eTG / AMH). Do not invent doses. Do not give a recommendation. Example: "Methylphenidate dose change — verify against eTG Paediatrics and AMH before responding."
- Otherwise return null.`;

export function buildMatchPrompt(
  email: Email,
  classification: AiClassification | undefined,
  registry: RegistryItem[],
): string {
  // Compact JSON to keep the token budget down — the registry is small
  // (single digits today) but will grow.
  const registryJson = JSON.stringify(registry);
  const classSummary = classification
    ? `category=${classification.category}; priority=${classification.priority}`
    : 'unclassified';
  return `${SYSTEM}

CONCORDANCE FLAG (pick exactly one per cited source):
- "A" — concordant with the other source(s) you are also citing for this email.
- "B" — minor variation from another source you are also citing (different threshold, different sequencing, both defensible).
- "C" — direct conflict where Australian practice (Tier 2 AU sources) should be followed over an international source you are also citing.
- "D" — direct conflict where the international source you are citing is more current or authoritative than the Australian source you are also citing.
- null — the source stands alone (you are not citing anything else to compare against).

REGISTRY (the ONLY sources you may cite — use the exact integer "id"):
${registryJson}

CLASSIFICATION: ${classSummary}

EMAIL TO MATCH:
From: ${email.from}
Subject: ${email.subject}
---
${email.body}

OUTPUT JSON SHAPE (exact keys, no extras):
{"citations": [{"sourceId": <integer from registry>, "flag": "A"|"B"|"C"|"D"|null}], "prescribingWarning": "<sentence>"|null}

If no registry source is directly relevant, return: {"citations": [], "prescribingWarning": null}`;
}

function tryParseJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  let cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    /* fall through to brace-extraction */
  }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

// Per-email matcher verdict. `prescribingWarning` is a short UK-English
// sentence the AI surfaces when the email mentions a specific drug or
// dose; null otherwise. Stored in `email_evidence.prescribing_warning`
// alongside the citation list (Stage 4 T006 — no schema change).
export interface MatchResult {
  citations: ServerCitation[];
  prescribingWarning: string | null;
}

const MAX_WARNING_CHARS = 200;

function parsePrescribingWarning(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_WARNING_CHARS) return trimmed.slice(0, MAX_WARNING_CHARS);
  return trimmed;
}

// Strict, defensive parse. Returns:
//   - MatchResult (possibly empty citations / null warning) on a valid response.
//   - null on malformed JSON or a missing/non-array citations field.
// An empty citations array is a legitimate "no match"; null is
// treated as an error by the queue's onError path.
export function parseMatchResponse(
  text: string,
  registryIds: Set<number>,
): MatchResult | null {
  const obj = tryParseJson(text);
  if (!obj) return null;
  const raw = obj['citations'];
  if (!Array.isArray(raw)) return null;
  const out: ServerCitation[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const rec = c as Record<string, unknown>;
    const sid = rec['sourceId'];
    if (typeof sid !== 'number' || !Number.isInteger(sid)) continue;
    if (!registryIds.has(sid)) continue; // orphan — drop silently
    const flagRaw = rec['flag'];
    const flag: ServerCitation['flag'] =
      typeof flagRaw === 'string' && VALID_FLAGS.has(flagRaw)
        ? (flagRaw as 'A' | 'B' | 'C' | 'D')
        : null;
    // Stage 3 invariant: flagText is ALWAYS null. Strip whatever the
    // AI sent. Clinician-review step in Stage 4 will populate it.
    out.push({ sourceId: sid, flag, flagText: null });
  }
  // Dedupe by sourceId — keep the FIRST occurrence so prompt-order is
  // preserved (the AI typically lists the most relevant source first).
  const seen = new Set<number>();
  const deduped: ServerCitation[] = [];
  for (const c of out) {
    if (seen.has(c.sourceId)) continue;
    seen.add(c.sourceId);
    deduped.push(c);
  }
  return {
    citations: deduped,
    prescribingWarning: parsePrescribingWarning(obj['prescribingWarning']),
  };
}

export async function matchEmailEvidence(
  email: Email,
  classification: AiClassification | undefined,
  registry: RegistryItem[],
  runPrompt: RunPrompt,
): Promise<MatchResult | null> {
  const text = await runPrompt(buildMatchPrompt(email, classification, registry));
  const ids = new Set(registry.map((r) => r.id));
  return parseMatchResponse(text, ids);
}

// Concurrent worker pool, identical shape to classifyQueue. onResult
// receives the verdict per email: a (possibly empty) citation array,
// OR null if the response was malformed (treated as an error so the
// queue's onError path runs and the email is left untouched for next
// session rather than persisted as a fake no-match).
export async function matchQueue(
  targets: Email[],
  classifications: Map<number, AiClassification>,
  registry: RegistryItem[],
  runPrompt: RunPrompt,
  onResult: (emailId: number, result: MatchResult) => void,
  opts: {
    concurrency?: number;
    signal?: AbortSignal;
    onError?: (emailId: number, err: unknown) => void;
  } = {},
): Promise<void> {
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const queue = [...targets];
  const worker = async () => {
    while (queue.length > 0 && !opts.signal?.aborted) {
      const email = queue.shift();
      if (!email) return;
      try {
        const result = await matchEmailEvidence(
          email,
          classifications.get(email.id),
          registry,
          runPrompt,
        );
        if (opts.signal?.aborted) return;
        if (result === null) {
          opts.onError?.(email.id, new Error('Malformed match response'));
          continue;
        }
        onResult(email.id, result);
      } catch (err) {
        opts.onError?.(email.id, err);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}
