import { useMemo, useState } from 'react';
import { Lightbulb, Check, X, Plus, CheckCircle2, Link2, Clock } from 'lucide-react';
import type { Email, AiClassification } from '@/lib/types';
import {
  detectPotentialTasks,
  type PotentialTask,
  type PotentialTaskKind,
} from '@/lib/potentialTaskDetect';
import {
  addPromptedTask,
  dismissPrompt,
  isPromptDismissed,
  hasPromptedTaskForKind,
  getPromptedTasksForEmail,
  usePromptedTasksState,
} from '@/lib/promptedTasksStore';
import { cn } from '@/lib/utils';

const KIND_LABEL: Record<PotentialTaskKind, string> = {
  phone_call: 'Phone call',
  appointment: 'Appointment',
  results_review: 'Results to review',
  referral: 'Referral',
  prescription: 'Prescription',
  follow_up: 'Follow-up',
  deadline: 'Deadline',
};

// AI category → suggested task priority. Falls back to MEDIUM.
function priorityFromAi(p: AiClassification['priority'] | undefined): 'high' | 'medium' | 'low' {
  if (p === 'URGENT') return 'high';
  if (p === 'LOW') return 'low';
  return 'medium';
}

// Spec rules for when prompts must NOT be shown:
//  - NONE category: truly no action required
//  - CPD: existing CPD task logic
//  - LEGAL / UNCLEAR: clinician must classify or handle manually first
//  - Any documentDirection (outgoing/incoming/unclear): document detection
//    owns this email's task creation flow
function shouldSkip(cls: AiClassification | undefined): boolean {
  if (!cls) return true;
  if (cls.category === 'NONE') return true;
  if (cls.category === 'CPD') return true;
  if (cls.category === 'LEGAL') return true;
  if (cls.category === 'UNCLEAR') return true;
  if (cls.documentDirection !== null) return true;
  return false;
}

interface Props {
  email: Email;
  classification: AiClassification | undefined;
  onOpenTasksTab?: () => void;
}

interface FormDraft {
  title: string;
  type: string;
  estMin: string;
  priority: 'high' | 'medium' | 'low';
  patientName: string;
  dueDays: string;
  notes: string;
}

function buildInitialForm(p: PotentialTask, cls: AiClassification | undefined, email: Email): FormDraft {
  const noteSnippet = email.body.length > 200 ? `${email.body.slice(0, 200)}…` : email.body;
  return {
    title: p.suggestedTitle,
    type: p.type,
    estMin: String(p.defaultMin),
    priority: priorityFromAi(cls?.priority),
    patientName: cls?.patientName ?? '',
    dueDays: p.dueDays !== null ? String(p.dueDays) : '',
    notes: noteSnippet,
  };
}

export default function PotentialTaskPanel({ email, classification, onOpenTasksTab }: Props) {
  // Subscribe to the prompted-tasks store so the panel reacts to
  // dismiss/create actions without needing local refresh logic.
  const state = usePromptedTasksState();
  // openForms tracks which prompts the clinician clicked "Yes" on
  // and is now editing. Keyed by kind.
  const [openForms, setOpenForms] = useState<Partial<Record<PotentialTaskKind, FormDraft>>>({});

  const detected = useMemo<PotentialTask[]>(() => {
    if (shouldSkip(classification)) return [];
    return detectPotentialTasks({ from: email.from, subject: email.subject, body: email.body });
  }, [email.id, email.from, email.subject, email.body, classification]);

  // Filter out prompts the clinician already responded to (created or
  // dismissed). Note: we still render the "Task created" confirmation
  // separately further down using getPromptedTasksForEmail.
  const pending = useMemo(() => {
    return detected.filter(
      (p) => !isPromptDismissed(email.id, p.kind) && !hasPromptedTaskForKind(email.id, p.kind),
    );
    // state is in deps so re-renders pick up dismiss/create changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected, email.id, state]);

  const created = useMemo(
    () => getPromptedTasksForEmail(email.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [email.id, state],
  );

  if (shouldSkip(classification)) return null;
  if (pending.length === 0 && created.length === 0) return null;

  const handleYes = (p: PotentialTask) => {
    setOpenForms((f) => ({ ...f, [p.kind]: buildInitialForm(p, classification, email) }));
  };

  const handleNo = (p: PotentialTask) => {
    dismissPrompt(email.id, p.kind);
  };

  const handleSave = (p: PotentialTask) => {
    const f = openForms[p.kind];
    if (!f || !f.title.trim()) return;
    addPromptedTask({
      emailId: email.id,
      kind: p.kind,
      title: f.title.trim(),
      type: f.type.trim() || p.type,
      estMin: Math.max(1, parseInt(f.estMin, 10) || p.defaultMin),
      priority: f.priority,
      patientName: f.patientName.trim() || null,
      dueDays: f.dueDays.trim() === '' ? null : Math.max(0, parseInt(f.dueDays, 10) || 0),
      notes: f.notes.trim(),
    });
    setOpenForms((curr) => {
      const { [p.kind]: _drop, ...rest } = curr;
      void _drop;
      return rest;
    });
  };

  const handleCancel = (p: PotentialTask) => {
    setOpenForms((curr) => {
      const { [p.kind]: _drop, ...rest } = curr;
      void _drop;
      return rest;
    });
  };

  const updateForm = (kind: PotentialTaskKind, patch: Partial<FormDraft>) => {
    setOpenForms((f) => {
      const curr = f[kind];
      if (!curr) return f;
      return { ...f, [kind]: { ...curr, ...patch } };
    });
  };

  return (
    <div
      className="mb-4 bg-amber-50/60 border border-amber-200 rounded-2xl p-4"
      data-testid="potential-task-panel"
    >
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb size={14} className="text-amber-600" />
        <h4 className="text-[11px] font-bold text-amber-800 uppercase tracking-widest">
          Possible task detected
        </h4>
      </div>

      {pending.map((p) => {
        const form = openForms[p.kind];
        return (
          <div
            key={p.kind}
            className="bg-white border border-amber-200/70 rounded-xl p-3 mb-2 last:mb-0"
            data-testid={`potential-task-prompt-${p.kind}`}
          >
            {!form ? (
              <>
                <p className="text-sm text-foreground leading-snug mb-1">
                  This email might need a follow-up action:
                </p>
                <p className="text-sm font-bold text-amber-900 mb-3">"{p.suggestedTitle}"</p>
                <p className="text-[11px] text-muted-foreground italic mb-3">
                  Detected: <span className="not-italic font-semibold">{KIND_LABEL[p.kind]}</span>
                  {p.dueDays !== null && <> · Due in {p.dueDays}d</>}
                  {' · '}"{p.evidence}"
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleYes(p)}
                    className="text-xs font-bold bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-1.5"
                    data-testid={`potential-task-yes-${p.kind}`}
                  >
                    <Check size={13} /> Yes — add task
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNo(p)}
                    className="text-xs font-bold bg-white border border-amber-300 text-amber-800 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-colors flex items-center gap-1.5"
                    data-testid={`potential-task-no-${p.kind}`}
                  >
                    <X size={13} /> No — not needed
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest">
                  New task — review and edit before saving
                </p>
                <Field label="Task title">
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => updateForm(p.kind, { title: e.target.value })}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                    data-testid={`potential-task-form-title-${p.kind}`}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Type">
                    <input
                      type="text"
                      value={form.type}
                      onChange={(e) => updateForm(p.kind, { type: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                    />
                  </Field>
                  <Field label="Est. minutes">
                    <input
                      type="number"
                      min={1}
                      value={form.estMin}
                      onChange={(e) => updateForm(p.kind, { estMin: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Priority">
                    <select
                      value={form.priority}
                      onChange={(e) => updateForm(p.kind, { priority: e.target.value as 'high' | 'medium' | 'low' })}
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                    >
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </Field>
                  <Field label="Due in (days, blank = no due date)">
                    <input
                      type="number"
                      min={0}
                      value={form.dueDays}
                      onChange={(e) => updateForm(p.kind, { dueDays: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                    />
                  </Field>
                </div>
                <Field label="Patient (optional)">
                  <input
                    type="text"
                    value={form.patientName}
                    onChange={(e) => updateForm(p.kind, { patientName: e.target.value })}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                  />
                </Field>
                <Field label="Notes (context from this email)">
                  <textarea
                    value={form.notes}
                    onChange={(e) => updateForm(p.kind, { notes: e.target.value })}
                    rows={2}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 resize-y"
                  />
                </Field>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <Link2 size={10} /> Linked to: <span className="font-semibold text-foreground">{email.subject}</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleSave(p)}
                    disabled={!form.title.trim()}
                    className={cn(
                      'text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors',
                      form.title.trim()
                        ? 'bg-amber-600 text-white hover:bg-amber-700'
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed',
                    )}
                    data-testid={`potential-task-save-${p.kind}`}
                  >
                    <Plus size={13} /> Add to my tasks
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCancel(p)}
                    className="text-xs font-bold bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
                    data-testid={`potential-task-cancel-${p.kind}`}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {created.map((t) => (
        <div
          key={t.id}
          className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-2 last:mb-0"
          data-testid={`potential-task-created-${t.kind}`}
        >
          <div className="flex items-start gap-2">
            <CheckCircle2 size={14} className="text-emerald-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-emerald-800 uppercase tracking-widest mb-0.5">
                Task created
              </p>
              <p className="text-sm font-bold text-foreground mb-1">{t.title}</p>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-semibold">{t.type}</span>
                <span>·</span>
                <span><Clock size={9} className="inline" /> {t.estMin} min</span>
                {t.dueDays !== null && (
                  <>
                    <span>·</span>
                    <span>Due in {t.dueDays}d</span>
                  </>
                )}
                {onOpenTasksTab && (
                  <>
                    <span>·</span>
                    <button
                      type="button"
                      onClick={onOpenTasksTab}
                      className="font-semibold text-emerald-700 underline hover:text-emerald-900"
                      data-testid={`potential-task-open-${t.kind}`}
                    >
                      Open in Tasks
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold text-slate-600 uppercase tracking-wide mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
