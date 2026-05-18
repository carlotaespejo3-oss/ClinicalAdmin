import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import { Mail, Search, Sparkles, Send, CheckCircle2, Loader2, RefreshCcw, Clock, ListChecks, Link2, ShieldAlert, Archive as ArchiveIcon, AlertTriangle, Scale, MessageSquare, Plus, ChevronDown, Info } from 'lucide-react';
import { emails, manualTasks } from '@/lib/data';
import type { Email } from '@/lib/data';
import type { AiCategory, AiClassification } from '@/lib/types';
import { cn, initials, avatarColor } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAiComplete } from '@workspace/api-client-react';
import { useAcknowledgedEmails, acknowledgeEmail } from '@/lib/acknowledgedStore';
import { useArchivedEmails, archiveEmail } from '@/lib/archivedStore';
import { manualTasks as seedManualTasks } from '@/lib/data';
import { requestLinkedTaskPrompt } from '@/lib/linkedTaskPromptStore';
import { findLinkedTaskForEmail, detectCompletionLanguage } from '@/lib/linkedTaskUtils';
import { useAiClassifications, setClassification, overrideCategory, confirmDocumentDirection } from '@/lib/aiClassifyStore';
import { classifyQueue, classifyEmail } from '@/lib/classifyEmail';
import { complexityReasonsFor } from '@/lib/estimateMinutes';
import { CATEGORY_LABEL, CATEGORY_BADGE, PRIORITY_LABEL, PRIORITY_BADGE } from '@/lib/aiCategory';
import {
  buildSafeguardingFamilyPrompt,
  buildSafeguardingAdminPrompt,
  buildUrgentClinicalFamilyPrompt,
  buildUrgentClinicalAdminPrompt,
  buildClinicalPrompt,
  buildPrescriptionPrompt,
  buildProfessionalPrompt,
  buildAdminPrompt,
  buildAcknowledgementPrompt,
  buildExtraDraftPrompt,
  buildChatPrompt,
  type ChatTurn,
} from '@/lib/draftPrompts';
import { addUserTask, useUserTasks } from '@/lib/userTasksStore';
import { recordSent, useSentLog, lastSentByEmailId, type DraftVariant } from '@/lib/sentLogStore';
import { useEmailEvidenceMap, useEvidencePending, useEvidenceSources } from '@/lib/evidenceStore';
import { buildEvidenceSnapshot, fetchEvidenceForGrounding, buildGroundingBlock } from '@/lib/evidenceGrounding';
import { recordDraft, recordSent as recordAuditSent } from '@/lib/draftAuditStore';
import { recordChatTurn } from '@/lib/chatAuditStore';
import { extractParticipants } from '@/lib/draftParticipants';
import type { EvidenceSnapshotEntry, EmailParticipant } from '@workspace/api-zod';
import { useEnsureEvidenceMatch } from '@/lib/useEnsureEvidenceMatch';
import { EvidenceBlockView, NoEvidenceRefusal } from '@/components/EvidenceBlockView';
import { buildMailtoUrl, buildReplySubject, extractAddress } from '@/lib/mailto';
import { useLinkedDocTasks } from '@/lib/linkedDocTasksStore';
import PotentialTaskPanel from '@/components/PotentialTaskPanel';
import AutoCreatedTasksStrip from '@/components/AutoCreatedTasksStrip';
import UnresolvedTaskStrip from '@/components/UnresolvedTaskStrip';
import { useAutoTaskCreator } from '@/lib/autoTaskCreator';

// ---- Step 3 helpers: drive UI behaviour purely from the AI category ----
//
// Each AI category maps to one of five "draft modes":
//   - 'dual'      → SAFEGUARDING, URGENT_CLINICAL: auto-fire family + admin drafts
//   - 'single'    → CLINICAL, PROFESSIONAL, ADMIN: auto-fire single draft
//   - 'legal'     → LEGAL: amber warning, no auto-draft (human only)
//   - 'ack'       → NONE, CPD: on-demand acknowledgement only (button click)
//   - 'unclear'   → UNCLEAR: yellow banner + override dropdown, no draft
type DraftMode = 'dual' | 'single' | 'legal' | 'ack' | 'unclear';

function draftModeFor(category: AiCategory): DraftMode {
  switch (category) {
    case 'SAFEGUARDING':
    case 'URGENT_CLINICAL':
      return 'dual';
    case 'CLINICAL':
    case 'PROFESSIONAL':
    case 'ADMIN':
      return 'single';
    case 'LEGAL':
      return 'legal';
    case 'NONE':
    case 'CPD':
      return 'ack';
    case 'UNCLEAR':
      return 'unclear';
  }
}

// Categories the user can manually pick when overriding UNCLEAR. Excludes
// UNCLEAR itself (no point overriding to the same thing).
const OVERRIDE_CATEGORIES: AiCategory[] = [
  'SAFEGUARDING',
  'URGENT_CLINICAL',
  'CLINICAL',
  'PROFESSIONAL',
  'ADMIN',
  'LEGAL',
  'NONE',
  'CPD',
];

type DraftSlot = 'single' | 'family' | 'admin';
type DraftState = { single?: string; family?: string; admin?: string };

const KIND_LABEL: Record<string, string> = {
  clinical: 'Clinical question',
  triage: 'Triage / quick decision',
  script: 'Script request',
  complex: 'Complex — creates a task',
  admin: 'Admin',
  meeting: 'Meeting / event',
  professional: 'Professional',
  none: 'Acknowledge',
};

interface InboxTabProps {
  initialSelectedId?: number | null;
}

// ---- Inbox date parsing -----------------------------------------------------
//
// Seed email dates are fuzzy strings ('Today, 08:45', 'Yesterday',
// '2 days ago', '1 week ago'). For the side-column inbox we want
// two things from them: (a) a sortable timestamp so newest sits at
// the top, and (b) a group label so we can render section headers
// ("Today", "Yesterday", "Friday", "06 May") the way Outlook /
// Gmail / Apple Mail all do. The row itself gets just the time
// (when known) — the section header already carries the date.
//
// All clock reads use the BROWSER's local "now"; same input + same
// clock → same output. When real Microsoft Graph timestamps replace
// the seed strings this helper can collapse to a single
// `new Date(receivedDateTime)` and the grouping stays identical.
interface ParsedEmailDate {
  sortMs: number;       // descending sort key
  groupKey: string;     // stable grouping id (rows with same key bucket together)
  groupLabel: string;   // header text rendered above the first row of the group
  rowLabel: string;     // shown on the row itself; empty when we only know the day
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Stable pseudo-time derived from the email id, used when the seed
// string doesn't carry one ("Yesterday", "2 days ago", "1 week
// ago"). Spread across working hours 08:00–17:59 so the column
// looks like a real inbox. Deterministic so the same email always
// shows the same time across reloads. Real Microsoft Graph
// `receivedDateTime` values always include a time, so this branch
// stops firing the moment seed data is replaced.
function synthesiseTimeFromId(id: number): { h: number; m: number; label: string } {
  const h = 8 + (Math.abs(id) % 10);                // 8..17
  const m = (Math.abs(id) * 37) % 60;               // 0..59, deterministic
  return { h, m, label: `${pad2(h)}:${pad2(m)}` };
}

function parseEmailDate(raw: string, now: Date, id: number): ParsedEmailDate {
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const todayMatch = raw.match(/^Today(?:,\s*(\d{1,2}):(\d{2}))?$/i);
  if (todayMatch) {
    let h: number; let m: number; let label: string;
    if (todayMatch[1]) {
      h = parseInt(todayMatch[1], 10);
      m = parseInt(todayMatch[2], 10);
      label = `${pad2(h)}:${pad2(m)}`;
    } else {
      ({ h, m, label } = synthesiseTimeFromId(id));
    }
    const d = new Date(todayMid);
    d.setHours(h, m, 0, 0);
    return { sortMs: d.getTime(), groupKey: 'today', groupLabel: 'Today', rowLabel: label };
  }

  const yMatch = raw.match(/^Yesterday(?:,\s*(\d{1,2}):(\d{2}))?$/i);
  if (yMatch) {
    let h: number; let m: number; let label: string;
    if (yMatch[1]) {
      h = parseInt(yMatch[1], 10);
      m = parseInt(yMatch[2], 10);
      label = `${pad2(h)}:${pad2(m)}`;
    } else {
      ({ h, m, label } = synthesiseTimeFromId(id));
    }
    const d = new Date(todayMid);
    d.setDate(d.getDate() - 1);
    d.setHours(h, m, 0, 0);
    return { sortMs: d.getTime(), groupKey: 'yesterday', groupLabel: 'Yesterday', rowLabel: label };
  }

  const daysMatch = raw.match(/^(\d+)\s+days?\s+ago$/i);
  if (daysMatch) {
    const n = parseInt(daysMatch[1], 10);
    const { h, m, label } = synthesiseTimeFromId(id);
    const d = new Date(todayMid);
    d.setDate(d.getDate() - n);
    d.setHours(h, m, 0, 0);
    return {
      sortMs: d.getTime(),
      groupKey: `d-${n}`,
      groupLabel: formatGroupHeader(d, todayMid),
      rowLabel: label,
    };
  }

  const wkMatch = raw.match(/^(\d+)\s+weeks?\s+ago$/i);
  if (wkMatch) {
    const n = parseInt(wkMatch[1], 10);
    const { h, m, label } = synthesiseTimeFromId(id);
    const d = new Date(todayMid);
    d.setDate(d.getDate() - n * 7);
    d.setHours(h, m, 0, 0);
    return {
      sortMs: d.getTime(),
      groupKey: `w-${n}`,
      groupLabel: formatGroupHeader(d, todayMid),
      rowLabel: label,
    };
  }

  // Anything we don't recognise sorts to the bottom under its own
  // header (preserves the raw label rather than silently losing it).
  return { sortMs: 0, groupKey: `raw-${raw}`, groupLabel: raw, rowLabel: '' };
}

function formatGroupHeader(d: Date, todayMid: Date): string {
  const diffDays = Math.round((todayMid.getTime() - d.getTime()) / 86_400_000);
  if (diffDays >= 2 && diffDays <= 6) {
    return d.toLocaleDateString('en-GB', { weekday: 'long' });
  }
  const sameYear = d.getFullYear() === todayMid.getFullYear();
  return d.toLocaleDateString(
    'en-GB',
    sameYear
      ? { day: '2-digit', month: 'short' }
      : { day: '2-digit', month: 'short', year: 'numeric' },
  );
}

export default function InboxTab({ initialSelectedId }: InboxTabProps = {}) {
  const [selectedId, setSelectedId] = useState<number | null>(
    initialSelectedId ?? emails[0]?.id ?? null
  );
  const [aiAnalysis, setAiAnalysis] = useState<Record<number, string>>({});
  const [aiDrafts, setAiDrafts] = useState<Record<number, DraftState>>({});
  const [draftLoading, setDraftLoading] = useState<Record<number, Partial<Record<DraftSlot, boolean>>>>({});
  const [draftError, setDraftError] = useState<Record<number, Partial<Record<DraftSlot, boolean>>>>({});
  const [copiedSlot, setCopiedSlot] = useState<{ id: number; slot: DraftSlot } | null>(null);
  const sentLog = useSentLog();
  const lastSentMap = useMemo(() => lastSentByEmailId(sentLog), [sentLog]);

  const selectedEmail = emails.find(e => e.id === selectedId);
  const aiComplete = useAiComplete();
  // Auto-creator: turns Tier 1/2 detections (high date + intent
  // confidence) into prompted tasks silently. Tier 3 stays as a
  // ghost row in My tasks. Mounted here because InboxTab is where
  // classification happens, so the hook fires the moment new
  // classifications arrive.
  useAutoTaskCreator();
  const acknowledged = useAcknowledgedEmails();
  const archived = useArchivedEmails();
  const classifications = useAiClassifications();
  const linkedDocTasks = useLinkedDocTasks();
  const evidenceMap = useEmailEvidenceMap();
  const evidenceSources = useEvidenceSources();
  const evidencePending = useEvidencePending();
  // Stage 3: on-demand AI source-matcher for CLINICAL emails. Fires
  // at most once per email per session; URGENT_CLINICAL +
  // SAFEGUARDING are already handled by the boot-time matcher.
  useEnsureEvidenceMatch(selectedId);
  // Helper: an email is "out of the inbox" if it has been acknowledged or
  // archived (acknowledged or marked done). Both flow into the Archive tab.
  const isOutOfInbox = (id: number) => acknowledged.has(id) || archived.has(id);

  // Inbox list = anything not yet archived/acknowledged. Archived items live
  // in the Archive tab — they don't appear here at all.
  const [searchQuery, setSearchQuery] = useState('');

  // Inbox list, sorted newest-first by parsed date, with each row
  // carrying its parsed meta so the render pass can group rows and
  // emit section headers (Today / Yesterday / Friday / 06 May).
  const orderedEmails = useMemo(() => {
    const inInbox = emails.filter(e => !isOutOfInbox(e.id));
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? inInbox.filter(e =>
          e.subject.toLowerCase().includes(q) ||
          e.from.toLowerCase().includes(q) ||
          (e.preview ?? '').toLowerCase().includes(q) ||
          (e.body ?? '').toLowerCase().includes(q),
        )
      : inInbox;
    const now = new Date();
    return filtered
      .map(email => ({ email, meta: parseEmailDate(email.date, now, email.id) }))
      .sort((a, b) => b.meta.sortMs - a.meta.sortMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acknowledged, archived, searchQuery]);

  // Move to the next remaining inbox email so the list flows naturally
  // after the current one leaves.
  const advanceToNextEmail = (currentId: number) => {
    const remaining = emails.filter(e => e.id !== currentId && !isOutOfInbox(e.id));
    setSelectedId(remaining.length > 0 ? remaining[0].id : null);
  };

  // If the current email has an open linked task AND any of the AI drafts
  // (or the freeform extra draft) contain "please find attached / I have
  // completed / the report is in the file" style language, queue a
  // 'reply-language' prompt BEFORE the email is archived. The prompt store
  // dedupes by emailId, so this beats ClinAdmin's generic 'email-done'
  // detector to the queue.
  const maybeQueueReplyLanguagePrompt = (emailId: number, subject: string) => {
    const linked = findLinkedTaskForEmail(emailId, seedManualTasks, linkedDocTasks);
    if (!linked || linked.done) return;
    const drafts = aiDrafts[emailId] ?? {};
    const extra = extraDraft[emailId] ?? '';
    const combined = [drafts.single, drafts.family, drafts.admin, extra]
      .filter(Boolean)
      .join('\n\n');
    if (!detectCompletionLanguage(combined)) return;
    requestLinkedTaskPrompt({
      mode: 'reply-language',
      emailId,
      emailSubject: subject,
      taskId: linked.id,
      taskTitle: linked.title,
      taskSource: linked.source,
    });
  };

  // Acknowledge: also archive (kind='acknowledged') so it shows in the Archive
  // tab. We keep the legacy acknowledgedStore in sync so Forecast/Today counts
  // continue to subtract the email correctly.
  const handleAcknowledge = () => {
    if (!selectedEmail) return;
    maybeQueueReplyLanguagePrompt(selectedEmail.id, selectedEmail.subject);
    acknowledgeEmail(selectedEmail.id);
    archiveEmail(selectedEmail.id, 'acknowledged');
    advanceToNextEmail(selectedEmail.id);
  };

  // Mark as done: clinician has handled the email outside the app (called the
  // patient, sent a reply manually, etc). Goes to archive as 'done'. Also
  // mirrored into acknowledgedStore so downstream counts stay correct.
  const handleMarkDone = () => {
    if (!selectedEmail) return;
    maybeQueueReplyLanguagePrompt(selectedEmail.id, selectedEmail.subject);
    acknowledgeEmail(selectedEmail.id);
    archiveEmail(selectedEmail.id, 'done');
    advanceToNextEmail(selectedEmail.id);
  };

  const setSlotLoading = (id: number, slot: DraftSlot, value: boolean) => {
    setDraftLoading(prev => ({ ...prev, [id]: { ...prev[id], [slot]: value } }));
  };
  const setSlotError = (id: number, slot: DraftSlot, value: boolean) => {
    setDraftError(prev => ({ ...prev, [id]: { ...prev[id], [slot]: value } }));
  };

  // "Re-classify" — re-runs the AI category/priority classifier for the
  // currently selected email and overwrites its entry in the classification
  // store. Used when the clinician thinks the AI got the badge wrong.
  const handleClassify = async () => {
    if (!selectedEmail) return;
    const target = selectedEmail;
    // Clear all auto-draft guards for this email so the new category's
    // auto-draft fires instead of being silently blocked by an old key from
    // the previous category.
    for (const key of Array.from(autoDraftedRef.current)) {
      if (key.startsWith(`${target.id}:`)) autoDraftedRef.current.delete(key);
    }
    const runPrompt = async (prompt: string) => {
      const res = await aiComplete.mutateAsync({ data: { prompt } });
      return res.text ?? '';
    };
    try {
      const c = await classifyEmail(target, runPrompt);
      setClassification(c);
    } catch {
      setClassification({
        emailId: target.id,
        category: 'UNCLEAR',
        priority: 'UNCLEAR',
        confidence: 0,
        reasoning: 'Classification failed — please re-classify.',
        classifiedAt: Date.now(),
        professionalSubType: null,
        patientName: null,
        documentRequested: null,
        eventDate: null,
        registrationDeadline: null,
        documentDirection: null,
        requiresDocument: false,
        documentType: null,
        documentDueDays: null,
        prescriptionRequest: null,
        complexity: null,
        complexityReasons: [],
      });
    }
  };

  // Pick the right prompt builder for a given (slot, classification). Single
  // source of truth so the auto-draft effect and the Regenerate button stay
  // in sync. Returns null when no draft is appropriate (LEGAL/UNCLEAR or
  // missing classification).
  const promptFor = (
    email: Email,
    slot: DraftSlot,
    cls: AiClassification | undefined,
  ): string | null => {
    if (!cls) return null;
    const mode = draftModeFor(cls.category);
    if (mode === 'legal' || mode === 'unclear') return null;
    if (mode === 'dual') {
      if (slot === 'family') {
        return cls.category === 'SAFEGUARDING'
          ? buildSafeguardingFamilyPrompt(email, cls)
          : buildUrgentClinicalFamilyPrompt(email, cls);
      }
      if (slot === 'admin') {
        return cls.category === 'SAFEGUARDING'
          ? buildSafeguardingAdminPrompt(email, cls)
          : buildUrgentClinicalAdminPrompt(email, cls);
      }
      return null;
    }
    if (mode === 'single' && slot === 'single') {
      // Prescription requests get a dedicated draft prompt (warm,
      // practical, confirms the script will be arranged, bakes in
      // controlled-drug + travel notes). Wins over the generic
      // CLINICAL prompt when the deterministic detector fired.
      if (cls.prescriptionRequest) return buildPrescriptionPrompt(email, cls);
      if (cls.category === 'CLINICAL') {
        // "Never invent" rule: do not generate an AI clinical draft
        // unless verified evidence exists in the approved tier
        // hierarchy. Gates the auto-draft effect AND the manual
        // Regenerate button (both route through promptFor). An
        // EvidenceBlock with zero resolved citations (e.g. all source
        // IDs orphaned) does NOT satisfy the gate.
        const ev = evidenceMap.get(email.id);
        if (!ev || ev.citations.length === 0) return null;
        return buildClinicalPrompt(email);
      }
      if (cls.category === 'PROFESSIONAL') return buildProfessionalPrompt(email, cls);
      if (cls.category === 'ADMIN') return buildAdminPrompt(email);
    }
    if (mode === 'ack' && slot === 'single') {
      // On-demand only — caller decides when to invoke.
      return buildAcknowledgementPrompt(email);
    }
    return null;
  };

  // Use mutateAsync + try/catch instead of mutate({ onSuccess }) — when two
  // drafts fire back-to-back (UNSAFE emails fire family + admin in parallel),
  // react-query's per-call callbacks race and the first one's onSuccess can be
  // dropped, leaving its card stuck in a loading spinner forever.
  // Per-(email,slot) request token. Bumped on every runDraft call. Late
  // responses whose token no longer matches are dropped, so reclassifying or
  // regenerating mid-flight cannot let a stale draft overwrite the newer one.
  // This matters clinically — e.g. a stale SAFEGUARDING response must never
  // overwrite a fresh URGENT_CLINICAL draft after a re-classification.
  const draftTokenRef = useRef<Map<string, number>>(new Map());

  // Tracks which (emailId, slot) pairs have a server-side draft_audit
  // row written for them in this session. handleSend uses this to
  // decide whether to fire the sent-hash POST — we never record a
  // sent hash for a draft we didn't first record at draft time
  // (would orphan the row's audit metadata).
  const auditedSlotsRef = useRef<Set<string>>(new Set());

  interface AuditContext {
    snapshot: EvidenceSnapshotEntry[];
    participants: EmailParticipant[];
  }

  const runDraft = async (
    email: Email,
    slot: DraftSlot,
    prompt: string,
    audit?: AuditContext,
  ) => {
    const tokKey = `${email.id}:${slot}`;
    const myToken = (draftTokenRef.current.get(tokKey) ?? 0) + 1;
    draftTokenRef.current.set(tokKey, myToken);
    setSlotLoading(email.id, slot, true);
    setSlotError(email.id, slot, false);
    try {
      const res = await aiComplete.mutateAsync({ data: { prompt } });
      if (draftTokenRef.current.get(tokKey) !== myToken) return; // stale
      setAiDrafts(prev => ({ ...prev, [email.id]: { ...prev[email.id], [slot]: res.text } }));
      // Audit-trail carve-out: only record drafts that came with
      // evidence context (i.e. CLINICAL single-slot path). Fire-and-
      // forget — the draft is already in the panel and the audit row
      // is medico-legal documentation, not a safety gate. The server
      // de-identifies the text before it lands in the DB.
      if (audit) {
        auditedSlotsRef.current.add(tokKey);
        void recordDraft({
          outlookEmailId: String(email.id),
          aiDraftText: res.text,
          evidenceSnapshot: audit.snapshot,
          participants: audit.participants,
        });
      }
    } catch {
      if (draftTokenRef.current.get(tokKey) !== myToken) return; // stale
      setSlotError(email.id, slot, true);
      // Clear the auto-fire guard so reselecting this email retries the draft
      // automatically instead of leaving the clinician on a stale error state.
      // We clear ALL category-suffixed variants for this (email, slot).
      for (const key of Array.from(autoDraftedRef.current)) {
        if (key.startsWith(`${email.id}:${slot}:`)) autoDraftedRef.current.delete(key);
      }
    } finally {
      if (draftTokenRef.current.get(tokKey) === myToken) {
        setSlotLoading(email.id, slot, false);
      }
    }
  };

  // Track which (emailId, slot, category) triples the auto-drafter has already
  // kicked off so re-renders don't refire requests. Category is part of the key
  // so a re-classification (e.g. CLINICAL → PROFESSIONAL) re-fires the draft
  // with the right prompt instead of being silently blocked.
  // Regenerate bypasses this ref entirely.
  const autoDraftedRef = useRef<Set<string>>(new Set());

  // Classification bootstrap is now lifted to ClinAdmin (useClassifyBootstrap)
  // so tabs other than the inbox (e.g. High-Risk) get a populated classification
  // store on first open instead of an empty one.

  // Stage 4 evidence-grounding: for the CLINICAL single-slot path,
  // build the snapshot, fetch live content for each cited source
  // (AU first, international fallback), and append a grounding block
  // to the prompt. Other categories (SAFEGUARDING / URGENT_CLINICAL
  // family + admin, PROFESSIONAL, ADMIN, NONE/CPD ack) don't cite
  // guideline content, so they skip both the fetch and the audit row.
  // The fetch is best-effort — failure proceeds on metadata only.
  const fireDraft = async (email: Email, slot: DraftSlot, cls: AiClassification) => {
    const prompt = promptFor(email, slot, cls);
    if (!prompt) return;
    const isEvidenceBacked =
      slot === 'single' && cls.category === 'CLINICAL';
    if (!isEvidenceBacked) {
      void runDraft(email, slot, prompt);
      return;
    }
    const ev = evidenceMap.get(email.id);
    if (!ev || ev.citations.length === 0) {
      // promptFor already gates on this — defensive double-check so a
      // future change to promptFor can't sneak through an audit row
      // with an empty snapshot.
      void runDraft(email, slot, prompt);
      return;
    }
    const snapshot = buildEvidenceSnapshot(ev, evidenceSources);
    const participants = extractParticipants(email, cls);
    let groundedPrompt = prompt;
    try {
      const outcomes = await fetchEvidenceForGrounding(snapshot, evidenceSources);
      const groundingBlock = buildGroundingBlock(snapshot, outcomes);
      if (groundingBlock) groundedPrompt = `${prompt}\n\n${groundingBlock}`;
    } catch (err) {
      // Fetch pipeline failed wholesale — proceed on metadata only.
      console.warn('[InboxTab] evidence grounding failed', err);
    }
    void runDraft(email, slot, groundedPrompt, { snapshot, participants });
  };

  // Auto-draft based on the AI category, as soon as the classification lands
  // for the currently-selected email:
  //   - 'dual' (SAFEGUARDING / URGENT_CLINICAL) → fire family + admin
  //   - 'single' (CLINICAL / PROFESSIONAL / ADMIN) → fire single
  //   - 'legal' / 'ack' / 'unclear' → no auto-draft
  // The auto-fire is gated on (emailId, slot) via autoDraftedRef so re-renders
  // don't refire requests. Regenerate bypasses the ref entirely.
  useEffect(() => {
    if (!selectedEmail) return;
    const cls = classifications.get(selectedEmail.id);
    if (!cls) return; // wait for classification
    const mode = draftModeFor(cls.category);
    const fire = (slot: DraftSlot) => {
      const key = `${selectedEmail.id}:${slot}:${cls.category}`;
      if (autoDraftedRef.current.has(key)) return;
      // Pre-check that there's actually a prompt to send before we
      // commit the auto-fire guard — fireDraft will silently no-op
      // if promptFor returns null, but consuming the guard either
      // way would block a later legitimate re-trigger.
      if (!promptFor(selectedEmail, slot, cls)) return;
      autoDraftedRef.current.add(key);
      void fireDraft(selectedEmail, slot, cls);
    };
    if (mode === 'dual') {
      fire('family');
      fire('admin');
    } else if (mode === 'single') {
      fire('single');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmail?.id, classifications.get(selectedEmail?.id ?? -1)?.category]);

  const handleRegenerate = (slot: DraftSlot) => {
    if (!selectedEmail) return;
    const cls = classifications.get(selectedEmail.id);
    if (!cls) return;
    if (!promptFor(selectedEmail, slot, cls)) return;
    void fireDraft(selectedEmail, slot, cls);
  };

  // On-demand acknowledgement draft for NONE/CPD emails — only fired when the
  // clinician clicks "Draft acknowledgement". Bypasses the auto-draft guard.
  const handleDraftAck = () => {
    if (!selectedEmail) return;
    void runDraft(selectedEmail, 'single', buildAcknowledgementPrompt(selectedEmail));
  };

  // ---- Mini chat box: ad-hoc conversation about the open email ----
  //
  // The clinician can either ask for a different draft ("decline politely")
  // or a clinical/literature question ("what does RANZCP say about X?"). The
  // AI replies with a small JSON envelope { kind: 'draft'|'answer', ... } so
  // the UI knows whether to render a copyable draft or a prose answer.
  // Anything that fails to parse falls back to a plain answer.
  const [chatInput, setChatInput] = useState('');
  const [chatThreads, setChatThreads] = useState<Record<number, ChatTurn[]>>({});
  const [chatLoading, setChatLoading] = useState<Record<number, boolean>>({});
  const [chatError, setChatError] = useState<Record<number, boolean>>({});
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Latest AI draft per email, harvested from chat — used by the
  // reply-language detector below. Old name kept to minimise churn at the
  // call site.
  const extraDraft: Record<number, string> = Object.fromEntries(
    Object.entries(chatThreads).map(([id, turns]) => {
      const lastDraft = [...turns].reverse().find((t) => t.role === 'assistant' && t.kind === 'draft');
      return [id, lastDraft?.content ?? ''];
    }),
  );

  const parseChatReply = (raw: string): { kind: 'draft' | 'answer'; content: string } => {
    const trimmed = (raw ?? '').trim();
    // Strip a possible ```json fence the model may add despite instructions.
    const unfenced = trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    try {
      const obj = JSON.parse(unfenced) as { kind?: string; body?: string; text?: string };
      if (obj && obj.kind === 'draft' && typeof obj.body === 'string') {
        return { kind: 'draft', content: obj.body };
      }
      if (obj && obj.kind === 'answer' && typeof obj.text === 'string') {
        return { kind: 'answer', content: obj.text };
      }
    } catch {
      // fall through to plain-text fallback
    }
    return { kind: 'answer', content: unfenced };
  };

  const handleChatSend = async () => {
    if (!selectedEmail) return;
    const message = chatInput.trim();
    if (!message) return;
    const id = selectedEmail.id;
    const history = chatThreads[id] ?? [];
    const nextHistory: ChatTurn[] = [...history, { role: 'clinician', kind: 'answer', content: message }];
    setChatThreads((p) => ({ ...p, [id]: nextHistory }));
    setChatInput('');
    setChatLoading((p) => ({ ...p, [id]: true }));
    setChatError((p) => ({ ...p, [id]: false }));

    // Medico-legal trail: capture the clinician turn before the AI call so a
    // network failure still leaves the question in the audit log. Server
    // scrubs names against participants before any DB write. Fire-and-forget.
    const participants = extractParticipants(selectedEmail, classifications.get(id));
    const clinicianTurnIndex = history.length;
    void recordChatTurn({
      outlookEmailId: String(id),
      turnIndex: clinicianTurnIndex,
      role: 'clinician',
      kind: 'message',
      content: message,
      participants,
    });

    try {
      const res = await aiComplete.mutateAsync({
        data: { prompt: buildChatPrompt(selectedEmail, history, message) },
      });
      const parsed = parseChatReply(res.text ?? '');
      setChatThreads((p) => ({
        ...p,
        [id]: [...nextHistory, { role: 'assistant', kind: parsed.kind, content: parsed.content }],
      }));
      // And the assistant turn — same de-id pass, same fire-and-forget. The
      // ai_draft_hash in draft_audit covers the consultant's SENT reply
      // text; this audit row covers the AI's chat reply, which may never
      // be sent at all (questions, discarded drafts) but still needs a
      // trail for a clinical pilot.
      void recordChatTurn({
        outlookEmailId: String(id),
        turnIndex: clinicianTurnIndex + 1,
        role: 'assistant',
        kind: parsed.kind,
        content: parsed.content,
        participants,
      });
    } catch {
      setChatError((p) => ({ ...p, [id]: true }));
    } finally {
      setChatLoading((p) => ({ ...p, [id]: false }));
    }
  };

  // Auto-scroll the chat thread to the latest message whenever the open
  // email's turns or loading state changes.
  const selectedTurns = selectedEmail ? chatThreads[selectedEmail.id] ?? [] : [];
  const selectedLoading = selectedEmail ? chatLoading[selectedEmail.id] ?? false : false;
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selectedTurns.length, selectedLoading, selectedEmail?.id]);

  const handleChatClear = () => {
    if (!selectedEmail) return;
    setChatThreads((p) => {
      const next = { ...p };
      delete next[selectedEmail.id];
      return next;
    });
    setChatError((p) => ({ ...p, [selectedEmail.id]: false }));
  };

  // ---- UNCLEAR override (manual category pick) ----
  const handleOverride = (category: AiCategory) => {
    if (!selectedEmail) return;
    // Reasonable priority defaults per category (clinician can refine later).
    const priorityDefault =
      category === 'SAFEGUARDING' || category === 'URGENT_CLINICAL'
        ? 'URGENT'
        : category === 'CLINICAL' || category === 'PROFESSIONAL' || category === 'LEGAL'
        ? 'MEDIUM'
        : 'LOW';
    overrideCategory(selectedEmail.id, category, priorityDefault);
    // Clear all auto-draft guards for this email so the new category's
    // auto-draft fires (keys are category-suffixed, so old-category keys are
    // harmless but we clear them anyway to avoid memory growth).
    for (const key of Array.from(autoDraftedRef.current)) {
      if (key.startsWith(`${selectedEmail.id}:`)) autoDraftedRef.current.delete(key);
    }
  };

  // ---- CPD: add as task (uses extracted event date / registration deadline) ----
  //
  // Three-bucket rule: the email subject lives in Outlook only and is
  // never copied into our DB. The title field opens with a structural
  // prefix ("CPD — ") only — no email content. The clinician types the
  // rest themselves, and Save stays disabled until they've added
  // content beyond the prefix.
  const CPD_TITLE_PREFIX = 'CPD — ';
  const userTasks = useUserTasks();
  const [cpdEditing, setCpdEditing] = useState(false);
  const [cpdTitleDraft, setCpdTitleDraft] = useState('');

  // Reset the inline CPD form whenever the selected email changes — the
  // draft belongs to whichever email was open when it was started.
  useEffect(() => {
    setCpdEditing(false);
    setCpdTitleDraft('');
  }, [selectedEmail?.id]);

  const openCpdEditor = () => {
    if (!selectedEmail) return;
    setCpdTitleDraft(CPD_TITLE_PREFIX);
    setCpdEditing(true);
  };

  // Save is enabled only once the clinician has typed something
  // beyond the structural prefix — guarantees the persisted title is
  // their own words.
  const cpdTitleHasContent = cpdTitleDraft.trim().length > CPD_TITLE_PREFIX.trim().length;

  const saveCpdTask = () => {
    if (!selectedEmail) return;
    const title = cpdTitleDraft.trim();
    if (!cpdTitleHasContent) return;
    const cls = classifications.get(selectedEmail.id);
    addUserTask({
      title,
      source: 'cpd',
      emailId: selectedEmail.id,
      eventDate: cls?.eventDate ?? null,
      registrationDeadline: cls?.registrationDeadline ?? null,
    });
    setCpdEditing(false);
    setCpdTitleDraft('');
  };

  const cancelCpdEdit = () => {
    setCpdEditing(false);
    setCpdTitleDraft('');
  };

  const handleCopy = async (id: number, slot: DraftSlot, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSlot({ id, slot });
      window.setTimeout(() => {
        setCopiedSlot(curr => (curr && curr.id === id && curr.slot === slot ? null : curr));
      }, 1500);
    } catch {
      // ignore
    }
  };

  // Send handoff: record to local sent log, copy body as a backstop in
  // case the mail client truncates the mailto body, then open the
  // user's default mail app with To/Subject/Body pre-filled. We
  // intentionally do NOT auto-archive — the clinician may want to
  // send follow-ups (e.g. single + admin variants for the same thread).
  const handleSend = (email: Email, slot: DraftSlot, text: string) => {
    if (!text) return;
    const subject = buildReplySubject(email.subject);
    const to = extractAddress(email.from);
    const variant: DraftVariant = slot;
    // Three-bucket rule: only metadata is persisted (id, emailId,
    // variant, sentAt). The subject and body computed here go into
    // the mailto: handoff URL only — they are not passed to the
    // store. They live in Outlook Sent Items the moment the user
    // confirms send.
    recordSent({ emailId: email.id, variant });
    // Stage 4 audit-trail carve-out: if a draft_audit row was written
    // at draft time for this (emailId, slot), POST the SHA-256 hash
    // of the final sent text so the server can compute draft_edited.
    // The text itself never leaves the browser. Fire-and-forget — we
    // never block the mailto handoff on the audit write.
    if (auditedSlotsRef.current.has(`${email.id}:${slot}`)) {
      void recordAuditSent(String(email.id), text);
    }
    // Best-effort clipboard backup in case the mailto body gets
    // truncated or the user's client refuses long URLs.
    try { void navigator.clipboard?.writeText(text); } catch { /* ignore */ }
    const url = buildMailtoUrl({ to, subject, body: text });
    window.location.href = url;
  };

  const handleDraftEdit = (id: number, slot: DraftSlot, text: string) => {
    setAiDrafts(prev => ({ ...prev, [id]: { ...prev[id], [slot]: text } }));
  };

  return (
    <div className="h-[calc(100vh-12rem)] flex gap-6 animate-in fade-in duration-500">
      {/* List Pane */}
      <div className="w-1/3 flex flex-col border border-border/50 rounded-xl overflow-hidden bg-card shadow-sm">
        <div className="p-4 border-b border-border bg-muted/20">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sender, subject or body..."
              className="w-full bg-background border border-border rounded-lg pl-10 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              data-testid="input-search-inbox"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs px-1.5 py-0.5 rounded"
                data-testid="button-clear-search"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="divide-y divide-border">
            {orderedEmails.length === 0 && (
              <div className="p-8 text-center text-xs text-muted-foreground">
                Inbox zero. Anything you've handled is in the Archive tab.
              </div>
            )}
            {(() => {
              // Walk the sorted list and emit a sticky section header
              // whenever the groupKey changes. Keeps the inbox feeling
              // like a normal mail client (Today / Yesterday / Friday /
              // 06 May) without changing the underlying data shape.
              let lastGroupKey: string | null = null;
              return orderedEmails.map(({ email: e, meta }) => {
                const showHeader = meta.groupKey !== lastGroupKey;
                lastGroupKey = meta.groupKey;
                const cls = classifications.get(e.id);
                return (
                  <Fragment key={e.id}>
                    {showHeader && (
                      <div
                        className="sticky top-0 z-10 px-4 py-1.5 bg-muted/80 backdrop-blur text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-y border-border"
                        data-testid={`inbox-date-header-${meta.groupKey}`}
                      >
                        {meta.groupLabel}
                      </div>
                    )}
                    <div
                      onClick={() => setSelectedId(e.id)}
                      className={cn(
                        "px-4 py-2.5 cursor-pointer transition-colors relative hover:bg-muted/30",
                        selectedId === e.id ? "bg-blue-50/50 border-l-4 border-primary" : "border-l-4 border-transparent"
                      )}
                      data-testid={`email-row-${e.id}`}
                    >
                      {/* Outlook-style compact row: sender on top,
                          subject + time on the second line, preview
                          underneath. No avatar — keeps the column
                          slim and readable when there's a lot to
                          scan. */}
                      <div className="overflow-hidden">
                        <p className="text-sm font-bold truncate mb-0.5">{e.from}</p>
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <p className="text-xs font-semibold truncate flex-1">{e.subject}</p>
                          {meta.rowLabel && (
                            <span
                              className="text-[11px] text-muted-foreground font-medium tabular-nums flex-shrink-0"
                              data-testid={`email-row-time-${e.id}`}
                            >
                              {meta.rowLabel}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground line-clamp-1">{e.preview}</p>
                        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        {cls ? (
                          <>
                            <span
                              className={cn(
                                "inline-flex items-center text-[10px] font-bold border px-2 py-0.5 rounded-full",
                                PRIORITY_BADGE[cls.priority],
                              )}
                              data-testid={`badge-priority-${e.id}`}
                            >
                              {PRIORITY_LABEL[cls.priority]}
                            </span>
                            <span
                              className={cn(
                                "inline-flex items-center text-[10px] font-bold border px-2 py-0.5 rounded-full",
                                CATEGORY_BADGE[cls.category],
                              )}
                              data-testid={`badge-category-${e.id}`}
                            >
                              {CATEGORY_LABEL[cls.category]}
                            </span>
                          </>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-bold border border-slate-200 bg-slate-50 text-slate-500 px-2 py-0.5 rounded-full"
                            data-testid={`badge-classifying-${e.id}`}
                          >
                            <Loader2 size={9} className="animate-spin" /> Classifying…
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  </Fragment>
                );
              });
            })()}
          </div>
        </ScrollArea>
      </div>

      {/* Detail Pane */}
      <div className="flex-1 flex flex-col border border-border/50 rounded-xl overflow-hidden bg-card shadow-sm">
        {selectedEmail ? (
          <ScrollArea className="flex-1">
            <div className="p-8">
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h3 className="text-xl font-bold mb-2">{selectedEmail.subject}</h3>
                  <div className="flex items-center gap-3">
                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs", avatarColor(selectedEmail.from))}>
                      {initials(selectedEmail.from)}
                    </div>
                    <div>
                      <p className="text-sm font-bold">{selectedEmail.from}</p>
                      <p className="text-xs text-muted-foreground">To: Dr. A. Patterson (Consultant Child &amp; Adolescent Psychiatrist)</p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 text-right">
                  <span className="text-xs font-bold text-muted-foreground uppercase">{selectedEmail.date}</span>
                  {(() => {
                    const cls = classifications.get(selectedEmail.id);
                    if (cls) {
                      const bannerVisible = cls.category === 'SAFEGUARDING' || cls.category === 'URGENT_CLINICAL';
                      const pillLabel = bannerVisible
                        ? `${PRIORITY_LABEL[cls.priority]} priority`
                        : `${PRIORITY_LABEL[cls.priority]} · ${CATEGORY_LABEL[cls.category]}`;
                      const tightDeadline = selectedEmail.deadline !== null && selectedEmail.deadline <= 3;
                      return (
                        <div className="flex gap-2 flex-wrap justify-end">
                          <span
                            className={cn("inline-flex items-center text-[11px] font-bold border px-2.5 py-1 rounded-full", PRIORITY_BADGE[cls.priority])}
                            data-testid="badge-priority-category"
                          >
                            {pillLabel}
                          </span>
                          {tightDeadline && (
                            <span className={cn(
                              "inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border",
                              selectedEmail.deadline! <= 1
                                ? "bg-red-50 text-red-700 border-red-200"
                                : "bg-amber-50 text-amber-700 border-amber-200"
                            )}>
                              Reply within {selectedEmail.deadline}d
                            </span>
                          )}
                          {cls.documentDirection === 'outgoing' && (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] font-bold border border-purple-200 bg-purple-50 text-purple-700 px-2.5 py-1 rounded-full"
                              data-testid="badge-document-required"
                              title={cls.documentType ?? 'Document requested'}
                            >
                              📄 Document requested — task created
                            </span>
                          )}
                          {cls.documentDirection === 'incoming' && (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] font-bold border border-slate-200 bg-slate-50 text-slate-600 px-2.5 py-1 rounded-full"
                              data-testid="badge-document-received"
                              title={cls.documentType ?? 'Document received'}
                            >
                              📄 Document received — for your information
                            </span>
                          )}
                          {cls.documentDirection === 'unclear' && (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] font-bold border border-amber-200 bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full"
                              data-testid="badge-document-unclear"
                              title={cls.documentType ?? 'Document — please confirm'}
                            >
                              📄 Document — please confirm
                            </span>
                          )}
                        </div>
                      );
                    }
                    return (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold border border-slate-200 bg-slate-50 text-slate-500 px-2.5 py-1 rounded-full">
                        <Loader2 size={11} className="animate-spin" /> Classifying…
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* Quiet meta line: kind · time · complexity · (deadline if loose) */}
              {(() => {
                const reasons = complexityReasonsFor(selectedEmail, classifications.get(selectedEmail.id));
                const looseDeadline = selectedEmail.deadline !== null && selectedEmail.deadline > 3;
                const parts: import('react').ReactNode[] = [];
                if (selectedEmail.kind) {
                  parts.push(<span key="kind">{KIND_LABEL[selectedEmail.kind]}</span>);
                }
                parts.push(<span key="time">{selectedEmail.estMin} min</span>);
                if (reasons.length > 0) {
                  parts.push(
                    <span
                      key="complex"
                      className="cursor-help underline decoration-dotted underline-offset-2"
                      title={`Time estimate bumped because: ${reasons.join(' • ')}`}
                    >
                      complex content
                    </span>
                  );
                }
                if (looseDeadline) {
                  parts.push(<span key="deadline">reply within {selectedEmail.deadline}d</span>);
                }
                return (
                  <div className="text-xs text-muted-foreground mb-6 pb-4 border-b border-border flex flex-wrap items-center gap-x-1.5">
                    {parts.map((part, i) => (
                      <Fragment key={i}>
                        {i > 0 && <span aria-hidden="true">·</span>}
                        {part}
                      </Fragment>
                    ))}
                  </div>
                );
              })()}

              {/* Direction-confirm banner — shown when a document was
                  detected but the AI couldn't tell whether it's incoming
                  (FYI) or outgoing (action). The clinician decides;
                  pressing "Yes" creates the linked task, pressing "No"
                  leaves it as a received document. */}
              {(() => {
                const cls = classifications.get(selectedEmail.id);
                if (cls?.documentDirection !== 'unclear') return null;
                return (
                  <div
                    className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl p-4"
                    data-testid="document-direction-confirm"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0 text-base">
                        📄
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-amber-900 mb-1">
                          Is this asking you to write something?
                        </p>
                        <p className="text-xs text-amber-800 leading-snug mb-3">
                          A document was mentioned ({cls.documentType ?? 'document'}),
                          but it's not clear whether the sender is asking
                          you to produce it or sharing it for your
                          information.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => confirmDocumentDirection(selectedEmail.id, 'outgoing')}
                            className="text-xs font-bold bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 transition-colors"
                            data-testid="confirm-doc-outgoing"
                          >
                            Yes — create a task
                          </button>
                          <button
                            type="button"
                            onClick={() => confirmDocumentDirection(selectedEmail.id, 'incoming')}
                            className="text-xs font-bold bg-white border border-amber-300 text-amber-800 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-colors"
                            data-testid="confirm-doc-incoming"
                          >
                            No — just information
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Auto-created linked-document task panel (Step 4: document/form detection) */}
              {(() => {
                const docTask = linkedDocTasks.get(selectedEmail.id);
                if (!docTask) return null;
                return (
                  <div
                    className="mb-4 bg-purple-50 border border-purple-200 rounded-2xl p-4"
                    data-testid="linked-doc-task-panel"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0 text-base">
                        📄
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold text-purple-700 uppercase tracking-widest">Document required</span>
                          <Link2 size={10} className="text-purple-400" />
                        </div>
                        <p className="text-sm font-bold text-foreground mb-1">{docTask.title}</p>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span><Clock size={9} className="inline" /> {docTask.estMin} min total (email + document)</span>
                          <span>·</span>
                          <span>Due in {docTask.deadline}d</span>
                        </div>
                        <p className="text-[11px] text-purple-700 mt-2 font-medium leading-snug">
                          A task has been created for this document. It will complete automatically when you mark this email as done — one piece of work, one time block, one tick.
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Linked-task panel for complex emails */}
              {selectedEmail.linkedTaskId && (() => {
                const task = manualTasks.find(t => t.id === selectedEmail.linkedTaskId);
                if (!task) return null;
                return (
                  <div className="mb-6 bg-purple-50/50 border border-purple-200 rounded-2xl p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0">
                        <ListChecks size={15} className="text-purple-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold text-purple-700 uppercase tracking-widest">Linked task</span>
                          <Link2 size={10} className="text-purple-400" />
                        </div>
                        <p className="text-sm font-bold text-foreground mb-1">{task.title}</p>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="font-semibold">{task.type}</span>
                          <span>·</span>
                          <span><Clock size={9} className="inline" /> {task.estMin} min</span>
                          <span>·</span>
                          <span>Due in {task.deadline}d</span>
                        </div>
                        {task.autoCompleteOnReply && (
                          <p className="text-[11px] text-purple-700 mt-2 font-medium">
                            <span className="inline-block w-1.5 h-1.5 bg-purple-500 rounded-full mr-1.5 align-middle" />
                            Will auto-complete when this email chain closes
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="prose prose-sm max-w-none mb-10 text-foreground leading-relaxed">
                {selectedEmail.body.split('\n').map((line, i) => <p key={i}>{line}</p>)}
              </div>

              {(() => {
                const cls = classifications.get(selectedEmail.id);
                const mode = cls ? draftModeFor(cls.category) : null;
                const cpdHasTask = userTasks.some((t) => t.emailId === selectedEmail.id);
                return (
                  <div className="flex flex-wrap gap-3 mb-8">
                    {/* On-demand acknowledgement draft for NONE/CPD */}
                    {mode === 'ack' && (
                      <button
                        onClick={handleDraftAck}
                        className="flex items-center gap-2 bg-primary text-white font-bold text-xs px-4 py-2.5 rounded-lg shadow-sm hover:bg-primary/90 transition-colors"
                        data-testid="button-draft-ack"
                        title="Optional polite acknowledgement reply"
                      >
                        <Sparkles size={14} />
                        Draft acknowledgement
                      </button>
                    )}
                    {/* CPD: add to tasks (uses extracted event date /
                        registration deadline). Two-step: first click
                        opens an inline editable title field pre-filled
                        with the email subject; Save stays disabled
                        until the clinician interacts with the field
                        (focus or edit), so the saved title is always
                        an explicit clinician choice — see three-bucket
                        rationale next to handleAddCpdTask. */}
                    {cls?.category === 'CPD' && !cpdEditing && (
                      <button
                        onClick={openCpdEditor}
                        disabled={cpdHasTask}
                        className={cn(
                          "flex items-center gap-2 font-bold text-xs px-4 py-2.5 rounded-lg border transition-colors",
                          cpdHasTask
                            ? "bg-teal-50 text-teal-700 border-teal-200 cursor-default"
                            : "bg-teal-50 text-teal-800 border-teal-300 hover:bg-teal-100",
                        )}
                        data-testid="button-cpd-add-task"
                        title={cpdHasTask ? 'Already added to your tasks' : 'Add this CPD event as a task'}
                      >
                        {cpdHasTask ? <CheckCircle2 size={14} /> : <Plus size={14} />}
                        {cpdHasTask ? 'Added to tasks' : 'Add CPD to tasks'}
                      </button>
                    )}
                    {cls?.category === 'CPD' && cpdEditing && (
                      <div
                        className="flex items-center gap-2 bg-teal-50 border border-teal-300 rounded-lg px-2 py-1.5"
                        data-testid="cpd-add-task-editor"
                      >
                        <input
                          type="text"
                          value={cpdTitleDraft}
                          onChange={(e) => setCpdTitleDraft(e.target.value)}
                          autoFocus
                          placeholder="CPD — type your task title"
                          className="bg-white border border-teal-200 rounded px-2 py-1 text-xs font-bold text-teal-900 min-w-[260px] focus:outline-none focus:ring-2 focus:ring-teal-300"
                          data-testid="input-cpd-task-title"
                        />
                        <button
                          onClick={saveCpdTask}
                          disabled={!cpdTitleHasContent}
                          className={cn(
                            "flex items-center gap-1.5 font-bold text-xs px-3 py-1.5 rounded-lg border transition-colors",
                            cpdTitleHasContent
                              ? "bg-teal-600 text-white border-teal-700 hover:bg-teal-700"
                              : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed",
                          )}
                          data-testid="button-cpd-save-task"
                          title={
                            !cpdTitleHasContent
                              ? 'Type a title after the "CPD — " prefix'
                              : 'Save this CPD event as a task'
                          }
                        >
                          <Plus size={12} /> Save
                        </button>
                        <button
                          onClick={cancelCpdEdit}
                          className="flex items-center gap-1.5 bg-white text-slate-700 font-bold text-xs px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 transition-colors"
                          data-testid="button-cpd-cancel-task"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    <button
                      onClick={handleAcknowledge}
                      className="flex items-center gap-2 bg-emerald-50 text-emerald-700 font-bold text-xs px-4 py-2.5 rounded-lg border border-emerald-200 hover:bg-emerald-100 transition-colors"
                      data-testid="button-acknowledge"
                      title="Mark as read — no reply needed. Moves to Archive."
                    >
                      <CheckCircle2 size={14} />
                      Acknowledge — no action
                    </button>
                    <button
                      onClick={handleMarkDone}
                      className="flex items-center gap-2 bg-blue-50 text-blue-700 font-bold text-xs px-4 py-2.5 rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors"
                      data-testid="button-mark-done"
                      title="You've handled this email — moves to Archive as Done."
                    >
                      <ArchiveIcon size={14} />
                      Mark as done
                    </button>
                    <button
                      onClick={handleClassify}
                      disabled={aiComplete.isPending}
                      className="flex items-center gap-2 bg-slate-50 text-slate-700 font-bold text-xs px-4 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors disabled:opacity-50 ml-auto"
                      data-testid="button-classify-ai"
                    >
                      {aiComplete.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      Re-classify
                    </button>
                  </div>
                );
              })()}

              {/* AI Panels */}
              <div className="space-y-4">

                {aiAnalysis[selectedEmail.id] && (
                  <div className="bg-[#E6F1FB] border border-[#94C4F0] rounded-xl p-6 shadow-sm animate-in zoom-in-95 duration-300">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles size={16} className="text-[#185FA5]" />
                      <h4 className="text-xs font-bold text-[#185FA5] uppercase tracking-widest">AI Classification</h4>
                    </div>
                    <div className="text-sm text-[#185FA5] whitespace-pre-wrap leading-relaxed font-medium">
                      {aiAnalysis[selectedEmail.id]}
                    </div>
                  </div>
                )}

                {/* "Already replied" indicator — surfaced above the
                    draft area regardless of category mode so the
                    clinician knows a reply has gone out before they
                    start drafting (or re-drafting) again. */}
                {(() => {
                  const alreadySent = lastSentMap.get(selectedEmail.id);
                  if (!alreadySent) return null;
                  return (
                    <div
                      className="mb-3 flex items-center gap-2 text-[11px] font-semibold text-primary bg-primary/5 border border-primary/20 rounded-lg px-3 py-2"
                      data-testid="banner-already-sent"
                    >
                      <Send size={12} />
                      <span>
                        You opened a reply in your mail app earlier (
                        <strong>{alreadySent.variant}</strong> draft).
                        Send again only if you intend a follow-up.
                      </span>
                    </div>
                  );
                })()}

                {/* ---- Category-driven draft area (Step 3) ---- */}
                {(() => {
                  const cls = classifications.get(selectedEmail.id);
                  if (!cls) return null;
                  const mode = draftModeFor(cls.category);
                  const drafts = aiDrafts[selectedEmail.id] ?? {};
                  const loading = draftLoading[selectedEmail.id] ?? {};
                  const errors = draftError[selectedEmail.id] ?? {};

                  const renderDraftCard = (slot: DraftSlot, label: string, sub: string) => {
                    const text = drafts[slot];
                    const isLoading = loading[slot];
                    const isError = errors[slot];
                    const isCopied = copiedSlot?.id === selectedEmail.id && copiedSlot.slot === slot;
                    return (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col" data-testid={`draft-card-${slot}`}>
                        <div className="flex items-center gap-2 mb-3">
                          <Send size={14} className="text-slate-600" />
                          <div className="flex-1">
                            <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-widest">{label}</h4>
                            <p className="text-[10px] text-slate-500 font-medium">{sub}</p>
                          </div>
                        </div>
                        {isLoading ? (
                          <div className="flex-1 min-h-[180px] flex flex-col items-center justify-center gap-2 bg-white border border-slate-200 rounded p-4">
                            <Loader2 size={18} className="animate-spin text-primary" />
                            <p className="text-[10px] font-bold text-primary uppercase tracking-widest">Drafting…</p>
                          </div>
                        ) : isError && !text ? (
                          <div className="flex-1 min-h-[180px] flex flex-col items-center justify-center gap-2 bg-red-50 border border-red-200 rounded p-4">
                            <p className="text-xs font-bold text-red-600">Draft failed.</p>
                            <button
                              onClick={() => handleRegenerate(slot)}
                              className="text-[10px] font-bold bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700 uppercase tracking-tight"
                            >
                              Retry
                            </button>
                          </div>
                        ) : text ? (
                          <textarea
                            value={text}
                            onChange={(e) => handleDraftEdit(selectedEmail.id, slot, e.target.value)}
                            className="flex-1 min-h-[200px] text-sm text-slate-700 whitespace-pre-wrap leading-relaxed border-l-4 border-slate-300 pl-4 bg-white p-4 rounded shadow-inner font-sans resize-y focus:outline-none focus:ring-2 focus:ring-primary/20"
                            data-testid={`draft-textarea-${slot}`}
                          />
                        ) : null}
                        <div className="mt-3 flex justify-end gap-2">
                          <button
                            onClick={() => handleRegenerate(slot)}
                            disabled={isLoading}
                            className="text-[10px] font-bold text-slate-500 hover:text-slate-700 flex items-center gap-1 px-2 py-1 disabled:opacity-50"
                            data-testid={`button-regenerate-${slot}`}
                          >
                            <RefreshCcw size={10} /> Regenerate
                          </button>
                          <button
                            onClick={() => text && handleCopy(selectedEmail.id, slot, text)}
                            disabled={!text}
                            className="text-[10px] font-bold text-slate-700 bg-white border border-slate-300 px-3 py-2 rounded hover:bg-slate-100 transition-colors uppercase tracking-tight disabled:opacity-50"
                            data-testid={`button-copy-${slot}`}
                          >
                            {isCopied ? 'Copied!' : 'Copy'}
                          </button>
                          <button
                            onClick={() => text && handleSend(selectedEmail, slot, text)}
                            disabled={!text}
                            className="text-[10px] font-bold bg-primary text-white px-4 py-2 rounded shadow hover:bg-primary/90 transition-colors uppercase tracking-tight disabled:opacity-50 inline-flex items-center gap-1.5"
                            data-testid={`button-send-${slot}`}
                            title="Open in your default mail app with this draft pre-filled. Review and click Send in your mail app to actually send."
                          >
                            <Send size={11} /> Open in mail app
                          </button>
                        </div>
                      </div>
                    );
                  };

                  // ---- LEGAL: amber warning, no draft ever ----
                  if (mode === 'legal') {
                    return (
                      <div
                        className="bg-amber-50 border-2 border-amber-300 text-amber-900 text-xs p-5 rounded-xl flex items-start gap-3 shadow-sm animate-in zoom-in-95 duration-300"
                        data-testid="banner-legal"
                      >
                        <Scale size={20} className="text-amber-700 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="font-bold uppercase tracking-tight text-[11px] text-amber-800 mb-1">Medico-legal correspondence — do not auto-draft</p>
                          <p className="leading-relaxed text-amber-900/90">
                            This email has been classified as legal/medico-legal. No reply has been drafted. Please respond personally or forward to your medical defence organisation before replying.
                          </p>
                          {cls.reasoning && (
                            <p className="mt-2 text-[11px] italic text-amber-800/80">AI: {cls.reasoning}</p>
                          )}
                        </div>
                      </div>
                    );
                  }

                  // ---- UNCLEAR: yellow banner with manual override dropdown ----
                  if (mode === 'unclear') {
                    return (
                      <div
                        className="bg-yellow-50 border-2 border-yellow-300 text-yellow-900 text-xs p-5 rounded-xl shadow-sm animate-in zoom-in-95 duration-300"
                        data-testid="banner-unclear"
                      >
                        <div className="flex items-start gap-3 mb-3">
                          <AlertTriangle size={20} className="text-yellow-700 flex-shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <p className="font-bold uppercase tracking-tight text-[11px] text-yellow-800 mb-1">AI was unsure — please pick a category</p>
                            <p className="leading-relaxed text-yellow-900/90">
                              The classifier couldn't confidently place this email. Pick the right category below and the matching draft will appear.
                            </p>
                            {cls.reasoning && (
                              <p className="mt-2 text-[11px] italic text-yellow-800/80">AI: {cls.reasoning}</p>
                            )}
                          </div>
                        </div>
                        <div className="relative ml-7">
                          <select
                            value=""
                            onChange={(e) => {
                              const v = e.target.value as AiCategory;
                              if (v) handleOverride(v);
                            }}
                            className="appearance-none w-full md:w-72 bg-white border border-yellow-300 rounded-lg pl-3 pr-9 py-2 text-xs font-bold text-yellow-900 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                            data-testid="select-override-category"
                          >
                            <option value="" disabled>Choose a category…</option>
                            {OVERRIDE_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>{CATEGORY_LABEL[cat]}</option>
                            ))}
                          </select>
                          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-yellow-700 pointer-events-none" />
                        </div>
                      </div>
                    );
                  }

                  // ---- DUAL: SAFEGUARDING (red banner) + URGENT_CLINICAL (orange) ----
                  if (mode === 'dual') {
                    const isSafeguarding = cls.category === 'SAFEGUARDING';
                    return (
                      <div className="space-y-4 animate-in zoom-in-95 duration-300">
                        <div
                          className={cn(
                            "border-2 text-xs p-4 rounded-xl flex items-start gap-3 shadow-sm",
                            isSafeguarding
                              ? "bg-red-50 border-red-300 text-red-900"
                              : "bg-orange-50 border-orange-300 text-orange-900",
                          )}
                          data-testid={isSafeguarding ? "banner-safeguarding" : "banner-urgent-clinical"}
                        >
                          <ShieldAlert size={18} className={cn("flex-shrink-0 mt-0.5", isSafeguarding ? "text-red-700" : "text-orange-700")} />
                          <div className="flex-1">
                            <p className={cn("font-bold uppercase tracking-tight text-[11px] mb-1", isSafeguarding ? "text-red-800" : "text-orange-800")}>
                              {isSafeguarding ? 'Safeguarding concern — clinical review required' : 'Urgent clinical — review within the working day'}
                            </p>
                            <p className={cn("leading-relaxed", isSafeguarding ? "text-red-900/90" : "text-orange-900/90")}>
                              {isSafeguarding
                                ? 'These drafts are an interim acknowledgement only. They do not contain specific clinical advice and do not replace a face-to-face or telephone assessment.'
                                : 'Holding reply to the family + urgent booking request to admin. Please review both before sending.'}
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {renderDraftCard('family', 'Draft to family', isSafeguarding ? 'Holding reply — no clinical specifics' : 'Holding reply — interim acknowledgement')}
                          {renderDraftCard('admin', 'Draft to admin team', isSafeguarding ? 'Urgent safeguarding booking' : 'Urgent booking request')}
                        </div>
                      </div>
                    );
                  }

                  // ---- SINGLE auto-draft: CLINICAL / PROFESSIONAL / ADMIN ----
                  if (mode === 'single') {
                    const labelByCat: Record<string, { label: string; sub: string }> = {
                      CLINICAL: { label: 'Clinical reply', sub: 'Routine clinical question — auto-drafted' },
                      PROFESSIONAL: {
                        label: 'Reply to colleague',
                        sub:
                          cls.professionalSubType === 'document_request'
                            ? 'Document/letter request — acknowledges turnaround'
                            : cls.professionalSubType === 'meeting'
                            ? 'Meeting coordination'
                            : cls.professionalSubType === 'clinical_input'
                            ? 'Clinical input requested'
                            : 'Collegial reply',
                      },
                      ADMIN: { label: 'Admin reply', sub: 'Brief, decisive admin response' },
                    };
                    const meta = labelByCat[cls.category] ?? { label: 'Suggested draft', sub: 'Edit, regenerate or write your own.' };
                    const rawEvidence = cls.category === 'CLINICAL' ? evidenceMap.get(selectedEmail.id) : undefined;
                    // A block with zero resolved citations counts as "no
                    // evidence" for the never-invent gate — same as a
                    // missing record. Prevents an AI draft sneaking
                    // through with an empty/orphan citations array.
                    const evidence = rawEvidence && rawEvidence.citations.length > 0 ? rawEvidence : undefined;
                    // "Never invent" rule: a CLINICAL email with no verified
                    // source in the approved hierarchy must not get an AI
                    // draft. Show a neutral refusal panel instead.
                    if (cls.category === 'CLINICAL' && !evidence) {
                      // Stage 3: AI source-match in flight — show a
                      // neutral lookup state instead of jumping
                      // straight to the refusal. Resolves to either
                      // an evidence block or the refusal panel.
                      if (evidencePending.has(selectedEmail.id)) {
                        return (
                          <div className="space-y-4 animate-in zoom-in-95 duration-300">
                            <div
                              className="bg-slate-50 border border-slate-200 text-slate-600 text-xs p-4 rounded-lg flex items-center gap-2"
                              data-testid="evidence-lookup-pending"
                            >
                              <div className="h-3 w-3 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
                              <span>Looking up evidence…</span>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div className="space-y-4 animate-in zoom-in-95 duration-300">
                          <NoEvidenceRefusal />
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-4 animate-in zoom-in-95 duration-300">
                        {/* PROFESSIONAL document_request: surface document hint */}
                        {cls.category === 'PROFESSIONAL' && cls.professionalSubType === 'document_request' && cls.documentRequested && (
                          <div className="bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs p-3 rounded-lg flex items-start gap-2">
                            <Info size={14} className="flex-shrink-0 mt-0.5 text-indigo-700" />
                            <div className="flex-1">
                              <span className="font-bold">Document requested:</span> {cls.documentRequested}
                            </div>
                          </div>
                        )}
                        {renderDraftCard('single', meta.label, meta.sub)}
                        {evidence && <EvidenceBlockView block={evidence} />}
                      </div>
                    );
                  }

                  // ---- ACK (NONE / CPD): only show a card if the user clicked "Draft acknowledgement" ----
                  if (mode === 'ack') {
                    const text = drafts.single;
                    const isLoading = loading.single;
                    const isError = errors.single;
                    const showCard = text || isLoading || isError;
                    return (
                      <div className="space-y-4 animate-in zoom-in-95 duration-300">
                        {/* CPD: hint with extracted dates */}
                        {cls.category === 'CPD' && (cls.eventDate || cls.registrationDeadline) && (
                          <div className="bg-teal-50 border border-teal-200 text-teal-900 text-xs p-3 rounded-lg flex items-start gap-2" data-testid="banner-cpd-dates">
                            <Info size={14} className="flex-shrink-0 mt-0.5 text-teal-700" />
                            <div className="flex-1 space-y-0.5">
                              {cls.eventDate && (<div><span className="font-bold">Event:</span> {cls.eventDate}</div>)}
                              {cls.registrationDeadline && (<div><span className="font-bold">Register by:</span> {cls.registrationDeadline}</div>)}
                            </div>
                          </div>
                        )}
                        {!showCard && (
                          <div className="bg-slate-50 border border-slate-200 text-slate-600 text-xs p-4 rounded-lg italic">
                            No reply needed. Acknowledge to clear, mark as done if you've handled it, or click "Draft acknowledgement" above for an optional polite reply.
                          </div>
                        )}
                        {showCard && renderDraftCard('single', cls.category === 'CPD' ? 'CPD acknowledgement' : 'Polite acknowledgement', 'Optional courtesy reply')}
                      </div>
                    );
                  }

                  return null;
                })()}

                {/* ---- Possible-task prompts (phone calls, appointments,
                       results, referrals, prescriptions, follow-ups,
                       deadlines). Sits between the draft reply and the
                       mini chat box per spec. Auto-skipped for NONE,
                       CPD, LEGAL, UNCLEAR, and any email with a
                       documentDirection (handled by document detection). */}
                {/* ---- Auto-created task strip: quiet "Task created"
                       acknowledgement for Tier 1 (slate w/ green tick)
                       and Tier 2 (amber w/ "date estimated"). Each
                       strip exposes Undo. */}
                <AutoCreatedTasksStrip email={selectedEmail} />

                {/* ---- Unresolved strip: Tier 3 detections — the AI
                       spotted something but date / intent were low
                       confidence. "Classify" opens a 3-question
                       modal that closes the loop in ~5 seconds. */}
                <UnresolvedTaskStrip email={selectedEmail} />

                <PotentialTaskPanel
                  email={selectedEmail}
                  classification={classifications.get(selectedEmail.id)}
                />

                {/* ---- Mini chat: ad-hoc conversation about the open email ----
                  Supports two intents in one thread: writing/revising a reply
                  draft, OR asking a clinical / literature question. Hidden for
                  LEGAL (human-only) and UNCLEAR (pick a category first). */}
                {(() => {
                  const cls = classifications.get(selectedEmail.id);
                  if (!cls) return null;
                  const mode = draftModeFor(cls.category);
                  if (mode === 'unclear' || mode === 'legal') return null;
                  const turns = chatThreads[selectedEmail.id] ?? [];
                  const isLoading = chatLoading[selectedEmail.id];
                  const isError = chatError[selectedEmail.id];
                  return (
                    <div className="bg-blue-50/40 border border-blue-200 rounded-xl p-4 shadow-sm" data-testid="mini-chat-box">
                      <div className="flex items-center gap-2 mb-2">
                        <MessageSquare size={14} className="text-blue-700" />
                        <h4 className="text-[11px] font-bold text-blue-800 uppercase tracking-widest flex-1">Ask the AI</h4>
                        {turns.length > 0 && (
                          <button
                            onClick={handleChatClear}
                            className="text-[10px] font-semibold text-blue-700/70 hover:text-blue-900 uppercase tracking-tight"
                            data-testid="button-chat-clear"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      {turns.length === 0 && (
                        <p className="text-[11px] text-blue-900/80 mb-3">
                          Ask for a different draft (e.g. "decline politely", "write a one-liner"), or a clinical question
                          (e.g. "what does RANZCP say about SSRIs in under-18s?", "is sertraline safe with methylphenidate?").
                        </p>
                      )}
                      {turns.length > 0 && (
                        <div ref={chatScrollRef} className="space-y-2 mb-3 max-h-[420px] overflow-y-auto pr-1" data-testid="chat-thread">
                          {turns.map((turn, i) => {
                            if (turn.role === 'clinician') {
                              return (
                                <div key={i} className="flex justify-end" data-testid={`chat-turn-clinician-${i}`}>
                                  <div className="max-w-[85%] bg-blue-600 text-white text-xs leading-relaxed px-3 py-2 rounded-2xl rounded-br-sm whitespace-pre-wrap">
                                    {turn.content}
                                  </div>
                                </div>
                              );
                            }
                            if (turn.kind === 'draft') {
                              return (
                                <div key={i} className="flex flex-col items-start" data-testid={`chat-turn-draft-${i}`}>
                                  <div className="text-[10px] font-bold text-blue-700/70 uppercase tracking-widest mb-1 pl-1">
                                    Suggested draft
                                  </div>
                                  <div className="w-full text-sm text-slate-700 whitespace-pre-wrap leading-relaxed border-l-4 border-blue-300 pl-4 bg-white p-4 rounded shadow-inner font-sans">
                                    {turn.content}
                                  </div>
                                  <div className="mt-1.5 self-end">
                                    <button
                                      onClick={() => handleCopy(selectedEmail.id, 'single', turn.content)}
                                      className="text-[10px] font-bold bg-blue-600 text-white px-3 py-1.5 rounded shadow hover:bg-blue-700 transition-colors uppercase tracking-tight"
                                      data-testid={`button-copy-chat-draft-${i}`}
                                    >
                                      Copy to Clipboard
                                    </button>
                                  </div>
                                </div>
                              );
                            }
                            return (
                              <div key={i} className="flex justify-start" data-testid={`chat-turn-answer-${i}`}>
                                <div className="max-w-[92%] bg-white border border-blue-100 text-slate-800 text-xs leading-relaxed px-3 py-2 rounded-2xl rounded-bl-sm whitespace-pre-wrap shadow-sm">
                                  {turn.content}
                                </div>
                              </div>
                            );
                          })}
                          {isLoading && (
                            <div className="flex justify-start" data-testid="chat-loading">
                              <div className="bg-white border border-blue-100 text-blue-700 text-xs px-3 py-2 rounded-2xl rounded-bl-sm shadow-sm flex items-center gap-2">
                                <Loader2 size={12} className="animate-spin" />
                                Thinking…
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {isError && (
                        <p className="mb-2 text-[11px] text-red-600 font-bold">That didn't go through. Try again or rephrase.</p>
                      )}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !isLoading) void handleChatSend(); }}
                          placeholder="Draft a reply, or ask a clinical question…"
                          className="flex-1 bg-white border border-blue-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"
                          data-testid="input-extra-instruction"
                          disabled={isLoading}
                        />
                        <button
                          onClick={() => void handleChatSend()}
                          disabled={isLoading || !chatInput.trim()}
                          className="flex items-center gap-1.5 bg-blue-600 text-white text-xs font-bold px-4 py-2 rounded-lg shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
                          data-testid="button-extra-draft"
                        >
                          {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                          Send
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </ScrollArea>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
            <Mail size={48} className="mb-4 opacity-20" />
            <p className="font-semibold">Select an email to view</p>
            <p className="text-xs mt-1">Select any item from the left pane to view clinical details and AI tools.</p>
          </div>
        )}
      </div>
    </div>
  );
}
