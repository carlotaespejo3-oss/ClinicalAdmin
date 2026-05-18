import { useEffect } from 'react';
import { X, ClipboardList, Calendar, Clock, Hash, StickyNote, User } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TaskDetail {
  title: string;
  // Plain-language source label shown at top of the modal —
  // "Manually added", "AI · from email", etc.
  sourceLabel: string;
  // Pretty date label ("Today", "Tomorrow", "Wed 20 May").
  dueLabel: string | null;
  estMin: number | null;
  typeLabel: string | null;
  // Risk tag if known ("high" / "medium"). Optional.
  risk?: 'high' | 'medium' | 'low' | 'none';
  // Patient context line — for prompted tasks where we know the
  // associated patient name.
  patientName?: string | null;
  // Optional free-text notes the clinician entered when classifying
  // or accepting the task.
  notes?: string | null;
}

interface Props {
  open: boolean;
  detail: TaskDetail | null;
  onClose: () => void;
}

// Read-only details popup for a "My tasks" row that doesn't have an
// originating email to open — i.e. manually added tasks (whether
// seeded or user-added). For prompted/linked-doc tasks the email
// modal is shown instead, since the email IS the context.
//
// Pure display, no mutations — Edit / delete still live in the
// Tasks tab where the full form lives. This modal is the fast
// "what was this again?" view from Home.
export default function TaskDetailModal({ open, detail, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !detail) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-detail-title"
      data-testid="task-detail-modal"
    >
      <div
        className={cn(
          'bg-white rounded-2xl shadow-xl border border-border',
          'w-full max-w-[520px] max-h-full overflow-hidden flex flex-col',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---- Header ---- */}
        <div className="flex items-start gap-3 px-6 pt-5 pb-4 border-b border-border">
          <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <ClipboardList size={16} className="text-indigo-700" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {detail.sourceLabel}
            </p>
            <h2
              id="task-detail-title"
              className="text-base font-semibold text-foreground mt-1"
            >
              {detail.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 rounded-md border border-border hover:bg-slate-50 flex items-center justify-center text-muted-foreground"
            aria-label="Close"
            data-testid="task-detail-close"
          >
            <X size={16} />
          </button>
        </div>

        {/* ---- Body ---- */}
        <div className="px-6 py-5 space-y-3 overflow-y-auto flex-1">
          {detail.dueLabel && (
            <Row icon={<Calendar size={14} />} label="Due">{detail.dueLabel}</Row>
          )}
          {detail.estMin !== null && (
            <Row icon={<Clock size={14} />} label="Estimated time">
              {detail.estMin} min
            </Row>
          )}
          {detail.typeLabel && (
            <Row icon={<Hash size={14} />} label="Type">{detail.typeLabel}</Row>
          )}
          {detail.patientName && (
            <Row icon={<User size={14} />} label="Patient">{detail.patientName}</Row>
          )}
          {detail.risk && detail.risk !== 'none' && (
            <Row icon={<Hash size={14} />} label="Risk">
              <span className={cn(
                'inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider',
                detail.risk === 'high'
                  ? 'bg-red-100 text-red-700'
                  : detail.risk === 'medium'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-slate-100 text-slate-700',
              )}>
                {detail.risk}
              </span>
            </Row>
          )}
          {detail.notes && detail.notes.trim() && (
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <StickyNote size={12} /> Notes
              </p>
              <p className="text-sm text-foreground mt-1 whitespace-pre-wrap leading-relaxed bg-slate-50 border border-border rounded-md p-3">
                {detail.notes}
              </p>
            </div>
          )}
        </div>

        {/* ---- Footer ---- */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-slate-50/40">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm font-semibold rounded-md border border-border bg-white text-foreground hover:bg-slate-100"
            data-testid="task-detail-cancel"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-32 flex-shrink-0">
        {icon} {label}
      </span>
      <span className="text-foreground">{children}</span>
    </div>
  );
}
