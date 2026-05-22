import { useState, useEffect, useMemo } from 'react';
import {
  RefreshCcw,
  Sparkles,
  ChevronRight,
  AlertTriangle,
  Clock,
  Inbox,
  ShieldCheck,
  Loader2,
  Mail,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  CornerDownRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAiComplete, type AiCompleteResult } from '@workspace/api-client-react';
import { useAppSettingsCache } from '@/lib/clinicianSettingsStore';
import {
  useBacklogQueue,
  markBacklogItemDone,
  dismissBacklogItem,
  surfaceMoreBacklogItems,
  type BacklogItem,
} from '@/lib/backlogQueueStore';
import {
  runInboxScan,
  createDemoGraphClient,
  type ScanProgress,
} from '@/lib/inboxScanOrchestrator';

// ============================================================================
// Constants
// ============================================================================

type AbsenceType = 'annual' | 'sick' | 'maternity' | 'study' | 'other';
type AbsenceDuration = '1w' | '2w' | '4w' | '3m' | 'longer';

interface FormData {
  absenceType: AbsenceType;
  duration: AbsenceDuration;
  extraCapacity: string;
}

const ABSENCE_LABELS: Record<AbsenceType, string> = {
  annual: 'Annual leave',
  sick: 'Sick leave',
  maternity: 'Maternity / paternity',
  study: 'Study leave',
  other: 'Other',
};

const DURATION_LABELS: Record<AbsenceDuration, string> = {
  '1w': '1 week',
  '2w': '2 weeks',
  '4w': '3–4 weeks',
  '3m': '1–3 months',
  'longer': 'Longer',
};

// priorityScore → display tier
type RiskTier = 'high' | 'medium' | 'low';

function scoreToTier(score: number): RiskTier {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

const RISK_CONFIG: Record<RiskTier, {
  label: string;
  dot: string;
  badge: string;
  bar: string;
  heading: string;
}> = {
  high:   { label: 'Immediate — Act Today',    dot: 'bg-red-500',   badge: 'bg-red-50 text-red-700 border-red-200',     bar: 'border-l-red-500',   heading: 'text-red-700' },
  medium: { label: 'This Week',                dot: 'bg-amber-400', badge: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'border-l-amber-400', heading: 'text-amber-700' },
  low:    { label: 'Next 2 Weeks',             dot: 'bg-slate-300', badge: 'bg-slate-50 text-slate-600 border-slate-200', bar: 'border-l-slate-300',  heading: 'text-slate-500' },
};

const WEEK_COLOURS = [
  { bg: 'bg-red-50',   border: 'border-red-200',   heading: 'text-red-700',   badge: 'bg-red-100 text-red-800',   dot: 'bg-red-400' },
  { bg: 'bg-amber-50', border: 'border-amber-200', heading: 'text-amber-700', badge: 'bg-amber-100 text-amber-800', dot: 'bg-amber-400' },
  { bg: 'bg-blue-50',  border: 'border-blue-200',  heading: 'text-blue-700',  badge: 'bg-blue-100 text-blue-800',  dot: 'bg-blue-400' },
];

// ============================================================================
// Seed — convert static mock emails to BacklogItem shape for first scan
// ============================================================================

// ============================================================================
// BacklogRow — one item in the results list
// ============================================================================

function BacklogRow({ item }: { item: BacklogItem }) {
  const [open, setOpen] = useState(false);
  const tier = scoreToTier(item.priorityScore);
  const risk = RISK_CONFIG[tier];
  const receivedDate = new Date(item.receivedAt);
  const daysAgo = Math.round((Date.now() - receivedDate.getTime()) / 86_400_000);
  const dateLabel = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`;

  return (
    <div
      className={cn(
        'border-l-4 border border-border rounded-xl overflow-hidden transition-opacity',
        risk.bar,
        item.status !== 'pending' && 'opacity-40',
      )}
      data-testid={`backlog-row-${item.id}`}
    >
      <button
        type="button"
        className="w-full flex items-start gap-3 px-4 py-3.5 hover:bg-slate-50/60 transition-colors text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {/* Done checkbox */}
        <span
          role="checkbox"
          aria-checked={item.status === 'done'}
          tabIndex={0}
          className={cn(
            'flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 transition-colors cursor-pointer',
            item.status === 'done'
              ? 'bg-green-500 border-green-500'
              : 'border-muted-foreground/40 hover:border-green-400',
          )}
          onClick={(e) => {
            e.stopPropagation();
            if (item.status === 'pending') markBacklogItemDone(item.id);
          }}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              if (item.status === 'pending') markBacklogItemDone(item.id);
            }
          }}
        >
          {item.status === 'done' && <Check size={10} className="text-white" />}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={cn('text-sm font-bold leading-snug', item.status !== 'pending' && 'line-through')}>
                {item.senderName}
              </p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{item.subject}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">{dateLabel}</span>
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border', risk.badge)}>
                {tier}
              </span>
              {open ? (
                <ChevronUp size={14} className="text-muted-foreground" />
              ) : (
                <ChevronDown size={14} className="text-muted-foreground" />
              )}
            </div>
          </div>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-0 border-t border-border bg-slate-50/40">
          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
            <p>
              <span className="font-semibold text-foreground">From:</span> {item.senderName}{' '}
              <span className="opacity-60">({item.senderAddress})</span>
            </p>
            <p>
              <span className="font-semibold text-foreground">Received:</span>{' '}
              {receivedDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
            <p>
              <span className="font-semibold text-foreground">Priority score:</span> {item.priorityScore} / 100
            </p>
          </div>

          {item.status === 'pending' && (
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => { markBacklogItemDone(item.id); setOpen(false); }}
                className="text-xs font-bold text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-100 transition-colors flex items-center gap-1.5"
              >
                <Check size={11} /> Mark handled
              </button>
              <button
                type="button"
                onClick={() => { dismissBacklogItem(item.id, 'manual'); setOpen(false); }}
                className="text-xs font-bold text-muted-foreground bg-white border border-border px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5"
              >
                <X size={11} /> Dismiss
              </button>
              <a
                href={`https://outlook.office.com/mail/${item.outlookMessageId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-primary bg-primary/8 border border-primary/25 px-3 py-1.5 rounded-lg hover:bg-primary/15 transition-colors flex items-center gap-1.5"
              >
                <CornerDownRight size={11} /> Open in Outlook
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 3-week plan — derived from live items
// ============================================================================

function WeekPlan({ items }: { items: BacklogItem[] }) {
  const pending = items.filter((i) => i.status === 'pending');
  const high   = pending.filter((i) => scoreToTier(i.priorityScore) === 'high');
  const medium = pending.filter((i) => scoreToTier(i.priorityScore) === 'medium');
  const low    = pending.filter((i) => scoreToTier(i.priorityScore) === 'low');

  const weeks = [
    {
      label:    'Week 1 — Return Week',
      sublabel: 'High-priority & time-critical',
      items:    [...high, ...medium.slice(0, 2)],
      note:     'Clear clinical and urgent items first — phone where appropriate.',
    },
    {
      label:    'Week 2',
      sublabel: 'Professional, clinical & legal',
      items:    medium.slice(2),
      note:     'Aim for two focused admin blocks — Tuesday and Thursday work well.',
    },
    {
      label:    'Week 3',
      sublabel: 'Admin, scheduling & low-priority',
      items:    low,
      note:     'Batch similar tasks to reduce context-switching.',
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
        3-Week Clearance Plan
      </p>
      {weeks.map((week, wi) => {
        const col = WEEK_COLOURS[wi];
        if (week.items.length === 0 && wi > 0) return null;
        return (
          <div key={wi} className={cn('border rounded-2xl overflow-hidden', col.border, col.bg)}>
            <div className="px-5 py-4 border-b border-inherit">
              <div className="flex items-center justify-between mb-0.5">
                <p className={cn('text-sm font-bold', col.heading)}>{week.label}</p>
                <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', col.badge)}>
                  {week.items.length} item{week.items.length !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">{week.sublabel}</p>
            </div>
            <div className="px-5 py-3 space-y-2">
              {week.items.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Nothing queued here yet.</p>
              ) : (
                week.items.map((item) => (
                  <div key={item.id} className="flex items-start gap-2">
                    <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5', col.dot)} />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-snug truncate">{item.subject}</p>
                      <p className="text-[10px] text-muted-foreground">{item.senderName}</p>
                    </div>
                  </div>
                ))
              )}
              <p className="text-[10px] text-muted-foreground italic pt-1 border-t border-inherit mt-2">
                {week.note}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Main tab
// ============================================================================

export default function CatchUpTab() {
  const [step, setStep] = useState(0);
  const [scanProgress, setScanProgress] = useState(0);
  const [activeStepText, setActiveStepText] = useState('Preparing scan…');
  const [form, setForm] = useState<FormData>({ absenceType: 'annual', duration: '2w', extraCapacity: '2' });
  const [aiPlan, setAiPlan] = useState<string | null>(null);
  const [expandedRisk, setExpandedRisk] = useState<RiskTier | null>('high');

  const aiComplete = useAiComplete();
  const { profile } = useAppSettingsCache();
  const backlog = useBacklogQueue();

  // ---- Scan (real orchestrator) -----------------------------------------------
  //
  // When step transitions to 1 we kick off runInboxScan() with the demo
  // client (no Outlook token available yet). Real deployments would swap in
  // createProductionGraphClient(msalToken) here.
  //
  // Progress events from the orchestrator drive setScanProgress /
  // setActiveStepText so the UI bar reflects genuine work rather than a
  // synthetic timer.

  useEffect(() => {
    if (step !== 1) return;

    // In production: check for an Outlook access token and use
    // createProductionGraphClient(token) instead of the demo client.
    const graphClient = createDemoGraphClient(/* delayMs = default */);

    const scanWindowDays =
      form.duration === '1w' ? 14 :
      form.duration === '2w' ? 21 :
      form.duration === '4w' ? 42 :
      form.duration === '3m' ? 90 :
      180; // 'longer'

    const handle = runInboxScan(
      graphClient,
      { windowDays: scanWindowDays },
      (p: ScanProgress) => {
        setScanProgress(p.progress);
        setActiveStepText(p.currentStep);
        if (p.phase === 'done' || p.phase === 'aborted') {
          // Short pause so the "100%" bar is visible before transitioning.
          setTimeout(() => setStep(2), 600);
        }
      },
    );

    return () => {
      handle.abort();
    };
  // form.duration is captured once when the scan starts — intentional.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ---- Derived views ---------------------------------------------------------

  const allItems = backlog.items; // full sorted list from store

  const byTier = useMemo(() => ({
    high:   allItems.filter((i) => i.status === 'pending' && scoreToTier(i.priorityScore) === 'high'),
    medium: allItems.filter((i) => i.status === 'pending' && scoreToTier(i.priorityScore) === 'medium'),
    low:    allItems.filter((i) => i.status === 'pending' && scoreToTier(i.priorityScore) === 'low'),
  }), [allItems]);

  const resolvedCount = backlog.resolved;
  const pendingCount  = backlog.pending;

  // ---- AI plan ---------------------------------------------------------------

  const handleGenerateAiPlan = () => {
    const backlogDesc = allItems
      .filter((i) => i.status === 'pending')
      .map(
        (i) =>
          `- [${scoreToTier(i.priorityScore).toUpperCase()}] ${i.senderName}: "${i.subject}" (${new Date(i.receivedAt).toLocaleDateString('en-AU')})`,
      )
      .join('\n');

    aiComplete.mutate(
      {
        data: {
          prompt: `Catch-up plan for ${profile.fullName} (${profile.role}) returning from ${DURATION_LABELS[form.duration]} ${ABSENCE_LABELS[form.absenceType]}.
Extra capacity: ${form.extraCapacity}h/week above normal.
Backlog (${pendingCount} items pending):
${backlogDesc}

Write a detailed 3-week staged return plan. Week 1: immediate safety actions. Week 2: professional/clinical catch-up. Week 3: admin clearance. Include specific actions and safety note. Australian English. Max 250 words.`,
        },
      },
      { onSuccess: (res: AiCompleteResult) => setAiPlan(res.text) },
    );
  };

  // ============================================================================
  // Step 0 — Welcome form
  // ============================================================================

  if (step === 0) {
    return (
      <div className="max-w-xl mx-auto py-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-3">
            <RefreshCcw size={26} />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Welcome back, {profile.fullName}</h2>
          <p className="text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto">
            Let's scan your clinical inbox and build a safe, staged plan to clear the backlog from your absence.
          </p>
        </div>

        <div className="bg-white border border-border rounded-2xl shadow-sm p-6 space-y-5">
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Type of absence</p>
            <div className="grid grid-cols-3 gap-2">
              {(Object.entries(ABSENCE_LABELS) as [AbsenceType, string][]).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, absenceType: key }))}
                  className={cn(
                    'py-2 px-3 rounded-xl text-xs font-bold transition-all border-2 text-center',
                    form.absenceType === key
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-muted-foreground border-border hover:border-primary/40',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">How long were you away?</p>
            <div className="flex gap-2">
              {(Object.entries(DURATION_LABELS) as [AbsenceDuration, string][]).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, duration: key }))}
                  className={cn(
                    'flex-1 py-2 rounded-xl text-xs font-bold transition-all border-2 text-center',
                    form.duration === key
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-muted-foreground border-border hover:border-primary/40',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
              Extra catch-up capacity (hours/week)
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="0"
                max="10"
                step="0.5"
                value={form.extraCapacity}
                onChange={(e) => setForm((f) => ({ ...f, extraCapacity: e.target.value }))}
                className="w-28 border border-border rounded-xl px-4 py-2.5 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/30 text-center"
              />
              <span className="text-sm text-muted-foreground">hours above your normal weekly admin time</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => { setScanProgress(0); setStep(1); }}
            className="w-full bg-primary text-white font-bold py-3.5 rounded-xl shadow-lg hover:bg-primary/90 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
          >
            <Sparkles size={17} /> Start clinical scan <ChevronRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Step 1 — Scan animation
  // ============================================================================

  if (step === 1) {
    return (
      <div className="max-w-md mx-auto py-20 flex flex-col items-center gap-8 animate-in fade-in duration-300">
        <div className="relative w-24 h-24">
          <div className="absolute inset-0 rounded-full border-8 border-primary/10 border-t-primary animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Sparkles className="text-primary animate-pulse" size={28} />
          </div>
        </div>
        <div className="text-center space-y-3 w-full">
          <h3 className="text-xl font-bold">Scanning clinical backlog...</h3>
          <p className="text-sm font-semibold text-primary h-5">{activeStepText}</p>
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-100"
              style={{ width: `${scanProgress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{Math.round(scanProgress)}% complete</p>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Step 2 — Full results
  // ============================================================================

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">Catch-up Overview</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {DURATION_LABELS[form.duration]} {ABSENCE_LABELS[form.absenceType]} ·{' '}
            {backlog.total} item{backlog.total !== 1 ? 's' : ''} found · 3-week clearance plan
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setStep(0); setScanProgress(0); setAiPlan(null); }}
          className="text-xs text-muted-foreground font-semibold flex items-center gap-1 hover:text-foreground transition-colors border border-border px-3 py-2 rounded-xl"
        >
          <RefreshCcw size={12} /> Rescan
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Inbox,         val: String(backlog.total),          label: 'Total items',       bg: 'bg-blue-100',   color: 'text-blue-600' },
          { icon: AlertTriangle, val: String(byTier.high.length),     label: 'Immediate action',  bg: 'bg-red-100',    color: 'text-red-600' },
          { icon: Clock,         val: String(pendingCount),           label: 'Still pending',     bg: 'bg-amber-100',  color: 'text-amber-600' },
          { icon: ShieldCheck,   val: String(resolvedCount),          label: 'Cleared so far',    bg: 'bg-slate-100',  color: 'text-slate-600' },
        ].map((s, i) => (
          <div key={i} className="bg-white border border-border rounded-2xl p-4 flex items-center gap-3">
            <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', s.bg)}>
              <s.icon size={18} className={s.color} />
            </div>
            <div>
              <p className="text-xl font-bold leading-tight">{s.val}</p>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Progress bar — disappears when nothing is pending */}
      {backlog.total > 0 && (
        <div className="bg-white border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
              Progress
            </span>
            <span className="text-xs font-semibold text-muted-foreground">
              {resolvedCount} / {backlog.total} cleared
            </span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-500"
              style={{ width: `${backlog.total > 0 ? (resolvedCount / backlog.total) * 100 : 0}%` }}
            />
          </div>
          {pendingCount === 0 && (
            <p className="text-xs font-semibold text-green-700 mt-2 flex items-center gap-1.5">
              <Check size={13} /> All caught up — well done!
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* Backlog list — left column */}
        <div className="lg:col-span-3 space-y-4">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            Backlog — sorted by priority
          </p>

          {(['high', 'medium', 'low'] as const).map((tier) => {
            const tierItems = byTier[tier];
            const cfg = RISK_CONFIG[tier];
            const isOpen = expandedRisk === tier;

            // Also include resolved items in the collapsed count for context.
            const resolvedInTier = allItems.filter(
              (i) => i.status !== 'pending' && scoreToTier(i.priorityScore) === tier,
            );

            const totalInTier = tierItems.length + resolvedInTier.length;
            if (totalInTier === 0) return null;

            return (
              <div key={tier} className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
                <button
                  type="button"
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50/60 transition-colors"
                  onClick={() => setExpandedRisk(isOpen ? null : tier)}
                  aria-expanded={isOpen}
                >
                  <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', cfg.dot)} />
                  <span className={cn('text-sm font-bold', cfg.heading)}>{cfg.label}</span>
                  <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border ml-1', cfg.badge)}>
                    {tierItems.length} pending
                  </span>
                  {resolvedInTier.length > 0 && (
                    <span className="text-[10px] text-muted-foreground font-medium ml-0.5">
                      · {resolvedInTier.length} done
                    </span>
                  )}
                  {isOpen ? (
                    <ChevronUp size={15} className="ml-auto text-muted-foreground" />
                  ) : (
                    <ChevronDown size={15} className="ml-auto text-muted-foreground" />
                  )}
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 space-y-2 border-t border-border pt-3">
                    {/* Pending first */}
                    {tierItems.map((item) => (
                      <BacklogRow key={item.id} item={item} />
                    ))}
                    {/* Resolved — dimmed */}
                    {resolvedInTier.length > 0 && (
                      <>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pt-2">
                          Cleared
                        </p>
                        {resolvedInTier.map((item) => (
                          <BacklogRow key={item.id} item={item} />
                        ))}
                      </>
                    )}

                    {/* Load more — only if we're showing the surfaced (limited) view.
                        The catch-up tab shows ALL items, so surfaceMore is not needed
                        here, but we keep it wired for dashboard card sync. */}
                    {tierItems.length === 0 && resolvedInTier.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4 italic">
                        Nothing here yet.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {backlog.total === 0 && (
            <div className="bg-white border border-border rounded-2xl p-8 text-center">
              <Mail size={32} className="mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm font-semibold text-muted-foreground">No backlog items found.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Either your inbox was clear or the scan hasn't loaded yet.
              </p>
            </div>
          )}
        </div>

        {/* Right column — plan + AI */}
        <div className="lg:col-span-2 space-y-4">
          <WeekPlan items={allItems} />

          {/* AI narrative plan */}
          <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="bg-gradient-to-r from-primary to-primary/80 px-5 py-4 text-white">
              <div className="flex items-center gap-2 mb-0.5">
                <Sparkles size={15} />
                <p className="text-sm font-bold">AI Narrative Plan</p>
              </div>
              <p className="text-xs opacity-75">Personalised return strategy from Claude</p>
            </div>
            <div className="p-5">
              {!aiPlan && !aiComplete.isPending && (
                <button
                  type="button"
                  onClick={handleGenerateAiPlan}
                  disabled={pendingCount === 0}
                  className="w-full py-3 text-sm font-bold text-primary bg-primary/8 border border-primary/25 rounded-xl hover:bg-primary/15 transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Sparkles size={15} /> Generate personalised plan
                </button>
              )}
              {aiComplete.isPending && (
                <div className="flex flex-col items-center gap-3 py-4">
                  <Loader2 size={22} className="text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground font-medium">Writing your return plan...</p>
                </div>
              )}
              {aiPlan && (
                <div className="space-y-3 animate-in fade-in duration-500">
                  <pre className="text-xs text-foreground leading-relaxed whitespace-pre-wrap font-sans">
                    {aiPlan}
                  </pre>
                  <div className="flex gap-2 pt-2 border-t border-border">
                    <button
                      type="button"
                      className="flex-1 text-xs font-bold text-primary bg-primary/8 border border-primary/20 py-2 rounded-xl hover:bg-primary/15 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Check size={12} /> Adopt plan
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAiPlan(null); handleGenerateAiPlan(); }}
                      className="text-xs font-bold text-muted-foreground border border-border px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors"
                      aria-label="Regenerate plan"
                    >
                      <RefreshCcw size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Surface more — shown when there are more than the default visible */}
      {pendingCount > 0 && backlog.surfaced.length < pendingCount && (
        <div className="text-center pt-2">
          <button
            type="button"
            onClick={surfaceMoreBacklogItems}
            className="text-sm font-semibold text-primary border border-primary/30 px-5 py-2.5 rounded-xl hover:bg-primary/8 transition-colors"
          >
            Load more items
          </button>
        </div>
      )}
    </div>
  );
}
