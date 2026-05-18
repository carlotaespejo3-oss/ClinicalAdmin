import { useEffect, useMemo, useState } from 'react';
import {
  X,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Mail,
  ExternalLink,
  ShieldAlert,
  Stethoscope,
  Scale,
  UserCheck,
  Briefcase,
  ClipboardList,
  BookOpen,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { emails } from '@/lib/data';
import type { AiCategory, AiPriority } from '@/lib/types';
import {
  useAiClassifications,
  overrideCategory,
} from '@/lib/aiClassifyStore';

interface Props {
  // Ordered queue of unclear emails to triage. The dialog steps
  // through them in this order; once classified, the row drops out
  // of the queue (the planner re-derives) and the dialog auto-
  // advances. When the queue empties, the dialog closes.
  emailIds: number[];
  open: boolean;
  onClose: () => void;
  // Optional "open the full inbox" escape hatch — for when a row
  // needs more context than this lightweight view exposes.
  onOpenInInbox?: (id: number) => void;
}

// Categories the clinician can pick when triaging an unclear email.
// Mirrors OVERRIDE_CATEGORIES in InboxTab and the same per-category
// priority defaults used by handleOverride, so behaviour matches
// either entry point.
const CHOICES: {
  id: AiCategory;
  label: string;
  blurb: string;
  Icon: typeof Mail;
  classes: string;
  priority: AiPriority;
}[] = [
  {
    id: 'SAFEGUARDING',
    label: 'Safeguarding',
    blurb: 'Risk of harm — needs clinical review',
    Icon: ShieldAlert,
    classes:
      'border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800',
    priority: 'URGENT',
  },
  {
    id: 'URGENT_CLINICAL',
    label: 'Urgent clinical',
    blurb: 'Action within the working day',
    Icon: Stethoscope,
    classes:
      'border-red-200 bg-red-50 hover:bg-red-100 text-red-800',
    priority: 'URGENT',
  },
  {
    id: 'CLINICAL',
    label: 'Clinical',
    blurb: 'Routine clinical question',
    Icon: Stethoscope,
    classes:
      'border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-800',
    priority: 'MEDIUM',
  },
  {
    id: 'PROFESSIONAL',
    label: 'Professional',
    blurb: 'Colleague-to-colleague',
    Icon: UserCheck,
    classes:
      'border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-800',
    priority: 'MEDIUM',
  },
  {
    id: 'LEGAL',
    label: 'Legal',
    blurb: 'Medico-legal — handle personally',
    Icon: Scale,
    classes:
      'border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-800',
    priority: 'MEDIUM',
  },
  {
    id: 'ADMIN',
    label: 'Admin',
    blurb: 'Routine admin / scheduling',
    Icon: Briefcase,
    classes:
      'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700',
    priority: 'LOW',
  },
  {
    id: 'CPD',
    label: 'CPD',
    blurb: 'Training / conference / learning',
    Icon: BookOpen,
    classes:
      'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800',
    priority: 'LOW',
  },
  {
    id: 'NONE',
    label: 'No action',
    blurb: 'FYI only — acknowledge to clear',
    Icon: ClipboardList,
    classes:
      'border-slate-200 bg-white hover:bg-slate-50 text-slate-700',
    priority: 'LOW',
  },
];

export default function UnclearTriageDialog({
  emailIds,
  open,
  onClose,
  onOpenInInbox,
}: Props) {
  const classifications = useAiClassifications();

  // Track how many we've classified in this session — purely for
  // the "X of Y done" badge so the clinician gets a sense of
  // progress.
  const [doneCount, setDoneCount] = useState(0);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  // Snapshot the total at open time. `emailIds` is a live list from
  // the planner — it shrinks as soon as we classify, so we can't use
  // it as the denominator for the "X of Y" badge.
  const [sessionTotal, setSessionTotal] = useState(0);

  // Reset the session counter every time the dialog re-opens.
  useEffect(() => {
    if (!open) return;
    setDoneCount(0);
    setConfirmation(null);
    setSessionTotal(emailIds.length);
    // Intentionally only re-runs on open — we want a stable snapshot
    // of the starting queue, not a live count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-derive the "still unclear" queue from live classifications,
  // intersected with the incoming list. As soon as the user picks a
  // category, that ID disappears here and the dialog auto-advances.
  const remaining = useMemo(() => {
    return emailIds.filter((id) => {
      const c = classifications.get(id);
      // No classification yet OR still UNCLEAR → still needs the
      // clinician's eyes.
      return !c || c.category === 'UNCLEAR';
    });
  }, [emailIds, classifications]);

  // Auto-close once the queue is empty. Brief delay so the user
  // sees the success confirmation for the last classification.
  useEffect(() => {
    if (!open) return;
    if (remaining.length === 0 && doneCount > 0) {
      const t = setTimeout(() => onClose(), 900);
      return () => clearTimeout(t);
    }
    return;
  }, [open, remaining.length, doneCount, onClose]);

  // Esc closes — matches AddPlannedItemDialog / other modals here.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const currentId = remaining[0];
  const email = currentId != null ? emails.find((e) => e.id === currentId) : undefined;
  const classification = currentId != null ? classifications.get(currentId) : undefined;

  const positionLabel =
    sessionTotal > 0
      ? `${Math.min(doneCount + 1, sessionTotal)} of ${sessionTotal}`
      : '';

  const handlePick = (cat: AiCategory, priority: AiPriority) => {
    if (!email) return;
    overrideCategory(email.id, cat, priority);
    setDoneCount((n) => n + 1);
    setConfirmation(`Saved as ${labelFor(cat)}`);
    window.setTimeout(() => setConfirmation(null), 800);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unclear-triage-title"
      onClick={onClose}
      data-testid="unclear-triage-backdrop"
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={18} className="text-amber-600" />
            </div>
            <div className="min-w-0">
              <h2
                id="unclear-triage-title"
                className="text-base font-bold leading-tight"
              >
                Classify unclear emails
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pick a category — the planner re-balances straight away.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {sessionTotal > 0 && remaining.length > 0 && (
              <span
                className="text-[10px] font-bold uppercase tracking-widest text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full tabular-nums"
                data-testid="unclear-triage-progress"
              >
                {positionLabel}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-md hover:bg-accent flex items-center justify-center text-muted-foreground"
              aria-label="Close"
              data-testid="unclear-triage-close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {!email ? (
            <div className="px-5 py-10 flex flex-col items-center justify-center text-center gap-2">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 size={22} className="text-green-600" />
              </div>
              <p className="text-sm font-semibold">
                {doneCount > 0 ? 'All sorted' : 'Nothing to classify'}
              </p>
              <p className="text-xs text-muted-foreground max-w-[280px]">
                {doneCount > 0
                  ? `You classified ${doneCount} email${doneCount === 1 ? '' : 's'}. Closing…`
                  : 'The AI is confident about everything in your inbox.'}
              </p>
            </div>
          ) : (
            <div className="p-5 space-y-4">
              {/* Email preview — three-bucket rule: this is live content
                  from the seed inbox, not duplicated to our DB. In
                  production the same fields would come from Graph at
                  display time. */}
              <div className="rounded-xl border border-border bg-slate-50/60 overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-white flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Mail
                      size={15}
                      className="text-muted-foreground mt-0.5 flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">
                        {email.subject}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        From <span className="font-semibold">{email.from}</span>
                        <span className="mx-1.5 text-border">·</span>
                        {email.date}
                      </p>
                    </div>
                  </div>
                  {onOpenInInbox && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenInInbox(email.id);
                        onClose();
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline flex-shrink-0"
                      data-testid="unclear-triage-open-inbox"
                    >
                      <ExternalLink size={11} />
                      Open in inbox
                    </button>
                  )}
                </div>
                <div className="px-4 py-3 text-sm text-foreground leading-relaxed whitespace-pre-wrap max-h-[180px] overflow-y-auto">
                  {email.body || email.preview}
                </div>
                {classification?.reasoning && (
                  <div className="px-4 py-2 border-t border-border bg-amber-50/60 text-[11px] italic text-amber-800">
                    AI: {classification.reasoning}
                  </div>
                )}
              </div>

              {/* Category picker */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                  Choose a category
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {CHOICES.map(({ id, label, blurb, Icon, classes, priority }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handlePick(id, priority)}
                      className={cn(
                        'flex items-start gap-2.5 text-left rounded-lg border px-3 py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40',
                        classes,
                      )}
                      data-testid={`unclear-triage-pick-${id}`}
                    >
                      <Icon size={15} className="mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold leading-tight">
                          {label}
                        </p>
                        <p className="text-[10px] opacity-80 mt-0.5 leading-snug">
                          {blurb}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {confirmation && (
                <div
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full animate-in fade-in"
                  data-testid="unclear-triage-confirmation"
                >
                  <CheckCircle2 size={11} />
                  {confirmation}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer — skip / nav. Only useful when there's >1 item. */}
        {remaining.length > 0 && (
          <div className="px-5 py-3 border-t border-border bg-slate-50/60 flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              {remaining.length === 1
                ? 'Last one.'
                : `${remaining.length} still to classify.`}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  // Skip = bump done counter so the badge progresses,
                  // and rotate the current ID to the back of the queue
                  // by classifying it as UNCLEAR with itself (no-op).
                  // Simpler: just close — the clinician can re-open
                  // from Today's Plan any time. Skipping is rare and
                  // not worth extra plumbing.
                  onClose();
                }}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent"
                data-testid="unclear-triage-skip"
              >
                <ChevronLeft size={11} />
                Do later
              </button>
              {onOpenInInbox && email && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenInInbox(email.id);
                    onClose();
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                  data-testid="unclear-triage-open-inbox-footer"
                >
                  Need more context
                  <ChevronRight size={11} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function labelFor(cat: AiCategory): string {
  const found = CHOICES.find((c) => c.id === cat);
  return found ? found.label : cat;
}
