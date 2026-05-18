import { useState, useEffect, useRef, useMemo } from 'react';
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
} from '@/lib/draftPrompts';
import { addUserTask, useUserTasks } from '@/lib/userTasksStore';
import { recordSent, useSentLog, lastSentByEmailId, type DraftVariant } from '@/lib/sentLogStore';
import { useEmailEvidenceMap } from '@/lib/evidenceStore';
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

const KIND_COLOUR: Record<string, string> = {
  clinical: 'bg-red-50 text-red-700 border-red-200',
  triage: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  script: 'bg-blue-50 text-blue-700 border-blue-200',
  complex: 'bg-purple-50 text-purple-700 border-purple-200',
  admin: 'bg-slate-50 text-slate-600 border-slate-200',
  meeting: 'bg-amber-50 text-amber-700 border-amber-200',
  professional: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  none: 'bg-slate-50 text-slate-500 border-slate-200',
};

interface InboxTabProps {
  initialSelectedId?: number | null;
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
  // Helper: an email is "out of the inbox" if it has been acknowledged or
  // archived (acknowledged or marked done). Both flow into the Archive tab.
  const isOutOfInbox = (id: number) => acknowledged.has(id) || archived.has(id);

  // Inbox list = anything not yet archived/acknowledged. Archived items live
  // in the Archive tab — they don't appear here at all.
  const [searchQuery, setSearchQuery] = useState('');

  const orderedEmails = useMemo(() => {
    const inInbox = emails.filter(e => !isOutOfInbox(e.id));
    const q = searchQuery.trim().toLowerCase();
    if (!q) return inInbox;
    return inInbox.filter(e =>
      e.subject.toLowerCase().includes(q) ||
      e.from.toLowerCase().includes(q) ||
      (e.preview ?? '').toLowerCase().includes(q) ||
      (e.body ?? '').toLowerCase().includes(q),
    );
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

  const runDraft = async (email: Email, slot: DraftSlot, prompt: string) => {
    const tokKey = `${email.id}:${slot}`;
    const myToken = (draftTokenRef.current.get(tokKey) ?? 0) + 1;
    draftTokenRef.current.set(tokKey, myToken);
    setSlotLoading(email.id, slot, true);
    setSlotError(email.id, slot, false);
    try {
      const res = await aiComplete.mutateAsync({ data: { prompt } });
      if (draftTokenRef.current.get(tokKey) !== myToken) return; // stale
      setAiDrafts(prev => ({ ...prev, [email.id]: { ...prev[email.id], [slot]: res.text } }));
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
      const prompt = promptFor(selectedEmail, slot, cls);
      if (!prompt) return;
      const key = `${selectedEmail.id}:${slot}:${cls.category}`;
      if (autoDraftedRef.current.has(key)) return;
      autoDraftedRef.current.add(key);
      void runDraft(selectedEmail, slot, prompt);
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
    const prompt = promptFor(selectedEmail, slot, cls);
    if (!prompt) return;
    void runDraft(selectedEmail, slot, prompt);
  };

  // On-demand acknowledgement draft for NONE/CPD emails — only fired when the
  // clinician clicks "Draft acknowledgement". Bypasses the auto-draft guard.
  const handleDraftAck = () => {
    if (!selectedEmail) return;
    void runDraft(selectedEmail, 'single', buildAcknowledgementPrompt(selectedEmail));
  };

  // ---- Mini chat box (extra draft from a freeform clinician instruction) ----
  const [extraInstruction, setExtraInstruction] = useState('');
  const [extraDraft, setExtraDraft] = useState<Record<number, string>>({});
  const [extraLoading, setExtraLoading] = useState<Record<number, boolean>>({});
  const [extraError, setExtraError] = useState<Record<number, boolean>>({});
  const handleExtraDraft = async () => {
    if (!selectedEmail) return;
    const instruction = extraInstruction.trim();
    if (!instruction) return;
    const id = selectedEmail.id;
    setExtraLoading((p) => ({ ...p, [id]: true }));
    setExtraError((p) => ({ ...p, [id]: false }));
    try {
      const res = await aiComplete.mutateAsync({
        data: { prompt: buildExtraDraftPrompt(selectedEmail, instruction) },
      });
      setExtraDraft((p) => ({ ...p, [id]: res.text ?? '' }));
      setExtraInstruction('');
    } catch {
      setExtraError((p) => ({ ...p, [id]: true }));
    } finally {
      setExtraLoading((p) => ({ ...p, [id]: false }));
    }
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
            {orderedEmails.map((e) => {
              const cls = classifications.get(e.id);
              return (
                <div
                  key={e.id}
                  onClick={() => setSelectedId(e.id)}
                  className={cn(
                    "p-4 cursor-pointer transition-colors relative hover:bg-muted/30",
                    selectedId === e.id ? "bg-blue-50/50 border-l-4 border-primary" : "border-l-4 border-transparent"
                  )}
                  data-testid={`email-row-${e.id}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0", avatarColor(e.from))}>
                      {initials(e.from)}
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <div className="flex justify-between items-start mb-1">
                        <p className="text-sm font-bold truncate">{e.from}</p>
                        <span className="text-[10px] text-muted-foreground font-medium uppercase">{e.date}</span>
                      </div>
                      <p className="text-xs font-semibold mb-1 truncate">{e.subject}</p>
                      <p className="text-[11px] text-muted-foreground line-clamp-1">{e.preview}</p>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
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
                </div>
              );
            })}
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
                      return (
                        <div className="flex gap-2 flex-wrap justify-end">
                          <span className={cn("inline-flex items-center text-[11px] font-bold border px-2.5 py-1 rounded-full", PRIORITY_BADGE[cls.priority])}>
                            {PRIORITY_LABEL[cls.priority]} priority
                          </span>
                          <span className={cn("inline-flex items-center text-[11px] font-bold border px-2.5 py-1 rounded-full", CATEGORY_BADGE[cls.category])}>
                            {CATEGORY_LABEL[cls.category]}
                          </span>
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

              {/* Meta strip: kind, time, deadline */}
              <div className="flex flex-wrap items-center gap-2 mb-6 pb-4 border-b border-border">
                {selectedEmail.kind && (
                  <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border", KIND_COLOUR[selectedEmail.kind])}>
                    {KIND_LABEL[selectedEmail.kind]}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full">
                  <Clock size={11} /> {selectedEmail.estMin} min to action
                </span>
                {(() => {
                  const reasons = complexityReasonsFor(selectedEmail, classifications.get(selectedEmail.id));
                  if (reasons.length === 0) return null;
                  return (
                    <span
                      className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border bg-violet-50 text-violet-700 border-violet-200 cursor-help"
                      title={`Time estimate bumped because: ${reasons.join(' • ')}`}
                    >
                      <Sparkles size={11} /> Complex content
                    </span>
                  );
                })()}
                {selectedEmail.deadline !== null && (
                  <span className={cn(
                    "inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border",
                    selectedEmail.deadline <= 1
                      ? "bg-red-50 text-red-700 border-red-200"
                      : selectedEmail.deadline <= 3
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-slate-50 text-slate-600 border-slate-200"
                  )}>
                    Reply within {selectedEmail.deadline}d
                  </span>
                )}
              </div>

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

                {/* ---- Mini chat box: ad-hoc extra drafts (hidden for UNCLEAR) ---- */}
                {(() => {
                  const cls = classifications.get(selectedEmail.id);
                  if (!cls) return null;
                  const mode = draftModeFor(cls.category);
                  // LEGAL is human-only — never offer any AI draft surface,
                  // including the freeform mini chat. UNCLEAR also hidden
                  // because the clinician should pick a category first.
                  if (mode === 'unclear' || mode === 'legal') return null;
                  const text = extraDraft[selectedEmail.id];
                  const isLoading = extraLoading[selectedEmail.id];
                  const isError = extraError[selectedEmail.id];
                  return (
                    <div className="bg-blue-50/40 border border-blue-200 rounded-xl p-4 shadow-sm" data-testid="mini-chat-box">
                      <div className="flex items-center gap-2 mb-2">
                        <MessageSquare size={14} className="text-blue-700" />
                        <h4 className="text-[11px] font-bold text-blue-800 uppercase tracking-widest">Need a different draft?</h4>
                      </div>
                      <p className="text-[11px] text-blue-900/80 mb-3">
                        Tell the AI what to write instead — e.g. "decline politely", "ask for blood results first", "write a one-liner".
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={extraInstruction}
                          onChange={(e) => setExtraInstruction(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !isLoading) void handleExtraDraft(); }}
                          placeholder="Type an instruction…"
                          className="flex-1 bg-white border border-blue-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"
                          data-testid="input-extra-instruction"
                          disabled={isLoading}
                        />
                        <button
                          onClick={() => void handleExtraDraft()}
                          disabled={isLoading || !extraInstruction.trim()}
                          className="flex items-center gap-1.5 bg-blue-600 text-white text-xs font-bold px-4 py-2 rounded-lg shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
                          data-testid="button-extra-draft"
                        >
                          {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                          Draft
                        </button>
                      </div>
                      {isError && !text && (
                        <p className="mt-2 text-[11px] text-red-600 font-bold">Draft failed. Try rephrasing.</p>
                      )}
                      {text && (
                        <div className="mt-3">
                          <textarea
                            value={text}
                            onChange={(e) => setExtraDraft((p) => ({ ...p, [selectedEmail.id]: e.target.value }))}
                            className="w-full min-h-[160px] text-sm text-slate-700 whitespace-pre-wrap leading-relaxed border-l-4 border-blue-300 pl-4 bg-white p-4 rounded shadow-inner font-sans resize-y focus:outline-none focus:ring-2 focus:ring-blue-300"
                            data-testid="extra-draft-textarea"
                          />
                          <div className="mt-2 flex justify-end">
                            <button
                              onClick={() => handleCopy(selectedEmail.id, 'single', text)}
                              className="text-[10px] font-bold bg-blue-600 text-white px-3 py-1.5 rounded shadow hover:bg-blue-700 transition-colors uppercase tracking-tight"
                              data-testid="button-copy-extra-draft"
                            >
                              Copy to Clipboard
                            </button>
                          </div>
                        </div>
                      )}
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
