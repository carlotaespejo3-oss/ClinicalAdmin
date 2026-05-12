import { useMemo } from 'react';
import { AlertTriangle, ShieldAlert, Clock, Mail, CheckCircle2, ChevronRight, Sparkles, User } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { emails } from '@/lib/data';
import type { TabType, AiCategory, AiPriority } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAiClassifications } from '@/lib/aiClassifyStore';
import { useAcknowledgedEmails } from '@/lib/acknowledgedStore';
import { useArchivedEmails } from '@/lib/archivedStore';
import { CATEGORY_LABEL, CATEGORY_BADGE, PRIORITY_LABEL, PRIORITY_BADGE } from '@/lib/aiCategory';

interface Props {
  onNavigate: (tab: TabType) => void;
  onOpenEmail: (id: number) => void;
}

// Step 4 — High-Risk tab is now driven entirely by the AI classifier:
//   - SAFEGUARDING: highest tier, red treatment, "needs urgent triage call /
//     face-to-face review" framing.
//   - URGENT_CLINICAL: orange treatment, "needs review within the working
//     day" framing.
//   - Anything else (CLINICAL/PROFESSIONAL/ADMIN/LEGAL/NONE/CPD/UNCLEAR) is
//     not surfaced here, regardless of the legacy `risk` field on the email.
// Items already acknowledged or archived from the inbox drop off this tab.
const HIGH_RISK_CATEGORIES = new Set<AiCategory>(['SAFEGUARDING', 'URGENT_CLINICAL']);

// Used to sort cards within a tier when multiple share a category.
const PRIORITY_ORDER: Record<AiPriority, number> = {
  URGENT: 0,
  MEDIUM: 1,
  LOW: 2,
  UNCLEAR: 3,
};

export default function HighRiskTab({ onNavigate, onOpenEmail }: Props) {
  const classifications = useAiClassifications();
  const acknowledged = useAcknowledgedEmails();
  const archived = useArchivedEmails();

  const { flagged, awaitingClassification } = useMemo(() => {
    const inbox = emails.filter((e) => !acknowledged.has(e.id) && !archived.has(e.id));
    const flagged = inbox
      .map((e) => ({ email: e, cls: classifications.get(e.id) }))
      .filter((x): x is { email: typeof x.email; cls: NonNullable<typeof x.cls> } =>
        !!x.cls && HIGH_RISK_CATEGORIES.has(x.cls.category),
      )
      .sort((a, b) => {
        // SAFEGUARDING before URGENT_CLINICAL, then by priority, then by
        // raw email id (stable order).
        if (a.cls.category !== b.cls.category) {
          return a.cls.category === 'SAFEGUARDING' ? -1 : 1;
        }
        const pa = PRIORITY_ORDER[a.cls.priority] ?? 99;
        const pb = PRIORITY_ORDER[b.cls.priority] ?? 99;
        if (pa !== pb) return pa - pb;
        return a.email.id - b.email.id;
      });
    // Inbox items the AI hasn't yet classified — surfaced as a small notice
    // so the clinician knows the list isn't necessarily complete yet.
    const awaitingClassification = inbox.filter((e) => !classifications.get(e.id)).length;
    return { flagged, awaitingClassification };
  }, [classifications, acknowledged, archived]);

  const handleOpen = (id: number) => {
    onOpenEmail(id);
    onNavigate('Emails');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="bg-[#FCEBEB] border border-red-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className={cn(
            'p-3 bg-red-100 text-red-600 rounded-full',
            flagged.length > 0 && 'animate-pulse',
          )}>
            <AlertTriangle size={24} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-[#791F1F]">Safety oversight required</h3>
            <p className="text-sm text-[#791F1F]/80 mt-1 leading-relaxed">
              Emails the AI has flagged as <strong>safeguarding</strong> or <strong>urgent clinical</strong>.
              Please triage these before any other admin work — open each one to review the holding reply
              to the family and the urgent booking request to your admin team.
            </p>
            {awaitingClassification > 0 && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
                <Sparkles size={12} /> {awaitingClassification} inbox email{awaitingClassification === 1 ? '' : 's'} still being classified — this list may grow.
              </p>
            )}
          </div>
        </div>
      </div>

      {flagged.length === 0 ? (
        awaitingClassification > 0 ? (
          // Don't claim "all clear" while items are still being classified —
          // safeguarding emails could be hiding in the unclassified set.
          <Card className="border-amber-200 bg-amber-50/40">
            <CardContent className="p-8 flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mb-4">
                <Sparkles size={24} />
              </div>
              <h4 className="font-bold text-amber-900">Classification in progress</h4>
              <p className="text-sm text-amber-800/80 mt-1 max-w-md leading-relaxed">
                {awaitingClassification} inbox email{awaitingClassification === 1 ? '' : 's'} still being classified by the AI. Any safeguarding or urgent clinical items will appear here as they're identified — please check back in a moment.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-emerald-200 bg-emerald-50/40">
            <CardContent className="p-8 flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-4">
                <CheckCircle2 size={24} />
              </div>
              <h4 className="font-bold text-emerald-900">No high-risk emails right now</h4>
              <p className="text-sm text-emerald-800/80 mt-1 max-w-md leading-relaxed">
                Nothing in the inbox has been classified as safeguarding or urgent clinical. Keep an eye on the Emails tab as new mail arrives.
              </p>
            </CardContent>
          </Card>
        )
      ) : (
        <div className="space-y-6">
          {flagged.map(({ email, cls }) => {
            const isSafeguarding = cls.category === 'SAFEGUARDING';
            const recommended = isSafeguarding
              ? 'Safeguarding triage call + urgent face-to-face/phone review'
              : 'Urgent clinical review within the working day';
            return (
              <Card
                key={email.id}
                className={cn(
                  'border-l-8 border-border/50 shadow-md overflow-hidden hover:shadow-lg transition-shadow',
                  isSafeguarding ? 'border-l-red-500' : 'border-l-orange-500',
                )}
                data-testid={`high-risk-card-${email.id}`}
              >
                <CardContent className="p-0">
                  <div className="p-6">
                    <div className="flex justify-between items-start mb-5 gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h4 className="text-xl font-bold truncate">{email.from}</h4>
                          {cls.patientName && (
                            <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                              <User size={10} /> {cls.patientName}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{email.subject}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-bold text-muted-foreground uppercase">{email.date}</p>
                        <div className="flex flex-wrap gap-2 mt-2 justify-end">
                          <span className={cn('inline-flex items-center text-[10px] font-bold border px-2 py-0.5 rounded-full uppercase tracking-tight', CATEGORY_BADGE[cls.category])}>
                            {CATEGORY_LABEL[cls.category]}
                          </span>
                          <span className={cn('inline-flex items-center text-[10px] font-bold border px-2 py-0.5 rounded-full uppercase tracking-tight', PRIORITY_BADGE[cls.priority])}>
                            {PRIORITY_LABEL[cls.priority]}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-muted/30 rounded-lg p-4 mb-5 text-sm italic border-l-2 border-muted leading-relaxed">
                      "{email.preview}"
                    </div>

                    {cls.reasoning && (
                      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-5">
                        <div className="flex items-center gap-2 mb-1">
                          <Sparkles size={12} className="text-blue-600" />
                          <span className="text-[10px] font-bold text-blue-700 uppercase tracking-widest">AI reasoning</span>
                        </div>
                        <p className="text-xs text-blue-900/90 leading-relaxed">{cls.reasoning}</p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className={cn(
                        'border rounded-lg p-3',
                        isSafeguarding ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-200',
                      )}>
                        <div className="flex items-center gap-2 mb-1">
                          <ShieldAlert size={14} className={isSafeguarding ? 'text-red-600' : 'text-orange-600'} />
                          <span className={cn(
                            'text-[10px] font-bold uppercase tracking-widest',
                            isSafeguarding ? 'text-red-700' : 'text-orange-700',
                          )}>
                            Recommended action
                          </span>
                        </div>
                        <p className={cn(
                          'text-sm font-bold leading-snug',
                          isSafeguarding ? 'text-red-900' : 'text-orange-900',
                        )}>
                          {recommended}
                        </p>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Clock size={14} className="text-slate-600" />
                          <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Estimated review</span>
                        </div>
                        <p className="text-sm font-bold text-slate-900">
                          {isSafeguarding ? '15–20 minutes' : '10–15 minutes'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-muted/20 border-t border-border p-4 flex justify-between items-center">
                    <p className="text-[11px] text-muted-foreground italic flex items-center gap-1.5">
                      <Mail size={12} /> Open in inbox to review the AI-drafted holding reply and admin booking request.
                    </p>
                    <button
                      onClick={() => handleOpen(email.id)}
                      className="bg-primary text-white text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm hover:bg-primary/90 transition-colors uppercase tracking-tight"
                      data-testid={`button-open-in-inbox-${email.id}`}
                    >
                      Open in inbox <ChevronRight size={14} />
                    </button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="pt-8 border-t border-border flex flex-col items-center text-center max-w-2xl mx-auto">
        <div className="w-12 h-12 rounded-full bg-green-50 text-green-600 flex items-center justify-center mb-4">
          <CheckCircle2 size={24} />
        </div>
        <h4 className="font-bold">Patient safety first</h4>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
          This tab only lists items the AI has flagged as safeguarding or urgent clinical.
          Once you've acknowledged or marked an item as done in the inbox, it disappears from this list automatically.
        </p>
      </div>
    </div>
  );
}
