import { useMemo, useState } from 'react';
import { Lightbulb, Check, X, Plus, CheckCircle2, Link2, Clock, AlertTriangle, Pill, Zap } from 'lucide-react';
import type { Email, AiClassification } from '@/lib/types';
import {
  detectPotentialTasks,
  type PotentialTask,
  type PotentialTaskKind,
} from '@/lib/potentialTaskDetect';
import {
  estimateMinutes as prescriptionMinutes,
  suggestedTaskTitle as prescriptionTitle,
  taskDueDays as prescriptionDueDays,
  urgencyFor as prescriptionUrgency,
  todayLabel,
  CONTROLLED_DRUG_WARNING,
  type PrescriptionRequest,
} from '@/lib/prescriptionDetect';
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
//
// EXCEPTION: prescription requests bypass these skip rules — the
// clinician must always see them per the spec, even if the AI
// (mis)classified the email as ADMIN/UNCLEAR/etc.
function shouldSkip(cls: AiClassification | undefined): boolean {
  if (!cls) return true;
  if (cls.prescriptionRequest) return false;
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

// Three-bucket rule: the notes field starts BLANK. We never copy email
// body content into the form — anything the patient/family/colleague
// wrote lives in Outlook only. The clinician types their own words;
// only what they deliberately enter inside the app reaches our DB.
function buildInitialForm(_p: PotentialTask, cls: AiClassification | undefined, _email: Email): FormDraft {
  void _email;
  return {
    title: _p.suggestedTitle,
    type: _p.type,
    estMin: String(_p.defaultMin),
    priority: priorityFromAi(cls?.priority),
    patientName: cls?.patientName ?? '',
    dueDays: _p.dueDays !== null ? String(_p.dueDays) : '',
    notes: '',
  };
}

// Pre-fill builder for the rich prescription detector. Per spec:
//   - Title:    "Write early script — Ritalin 54mg — James" (or repeat/lost variant)
//   - Type:     Prescription
//   - Priority: URGENT when deadline ≤3 days, else high/medium per urgency
//   - Due:      ONE DAY BEFORE the family's deadline (safety buffer)
//   - Est:      3 / 5 / 8 / 5 minutes per the time-estimate table
//   - Notes:    travel context + controlled drug reminder where applicable
function buildPrescriptionForm(p: PrescriptionRequest, email: Email): FormDraft {
  const urgency = prescriptionUrgency(p);
  const priority: 'high' | 'medium' | 'low' =
    urgency === 'critical' || urgency === 'urgent' ? 'high' : 'medium';
  const noteParts: string[] = [];
  if (p.travelMentioned && p.deadlineLabel) {
    noteParts.push(`Family travelling — leaving on ${p.deadlineLabel}.`);
  } else if (p.deadlineLabel) {
    noteParts.push(`Family needs script before ${p.deadlineLabel}.`);
  }
  if (p.flavour === 'early') {
    const med = [p.medicationName, p.medicationDose].filter(Boolean).join(' ');
    const qty = p.medicationQuantity ?? 'standard supply';
    if (med) noteParts.push(`Early script for ${qty} of ${med} requested.`);
  } else if (p.flavour === 'lost') {
    noteParts.push('Reissue requested — original prescription lost.');
  } else {
    noteParts.push('Repeat prescription requested.');
  }
  if (p.travelMentioned) {
    noteParts.push('Family travelling — confirm whether travel letter or additional documentation is needed.');
  }
  if (p.controlledDrug) noteParts.push(`⚠️ ${CONTROLLED_DRUG_WARNING}.`);
  return {
    title: prescriptionTitle(p),
    type: 'Prescription',
    estMin: String(prescriptionMinutes(p)),
    priority,
    patientName: p.patientName ?? '',
    dueDays: prescriptionDueDays(p) !== null ? String(prescriptionDueDays(p)) : '',
    // Prescription notes are computed from structured detector output
    // (travel/deadline/medication), not from email body — they're a
    // clinician-facing summary the app generates, so they're safe to
    // persist as-is.
    notes: noteParts.join(' '),
  };
}

export default function PotentialTaskPanel({ email, classification }: Props) {
  // Subscribe to the prompted-tasks store so the panel reacts to
  // dismiss/create actions without needing local refresh logic.
  const state = usePromptedTasksState();
  // openForms tracks which prompts the clinician clicked "Yes" on
  // and is now editing. Keyed by kind.
  const [openForms, setOpenForms] = useState<Partial<Record<PotentialTaskKind, FormDraft>>>({});

  // When the rich prescription detector fires, we suppress the generic
  // 'prescription' kind from the heuristic detector (it produces a
  // weaker prompt without medication / patient / deadline context) and
  // render a dedicated prescription card instead.
  const prescription = classification?.prescriptionRequest ?? null;

  const detected = useMemo<PotentialTask[]>(() => {
    if (shouldSkip(classification)) return [];
    const all = detectPotentialTasks({ from: email.from, subject: email.subject, body: email.body });
    return prescription ? all.filter((p) => p.kind !== 'prescription') : all;
  }, [email.id, email.from, email.subject, email.body, classification, prescription]);

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

  // Prescription card visibility is independent of the generic prompts —
  // it shows even if every other prompt has been dismissed/created,
  // until the prescription task itself is created or dismissed.
  const prescriptionDismissed = prescription
    ? isPromptDismissed(email.id, 'prescription')
    : false;
  const prescriptionCreated = prescription
    ? hasPromptedTaskForKind(email.id, 'prescription')
    : false;
  const showPrescriptionPrompt = !!prescription && !prescriptionDismissed && !prescriptionCreated;
  void state; // pull in store reactivity for the two flags above

  if (
    pending.length === 0 &&
    created.length === 0 &&
    !showPrescriptionPrompt
  ) {
    return null;
  }

  const handleYes = (p: PotentialTask) => {
    setOpenForms((f) => ({ ...f, [p.kind]: buildInitialForm(p, classification, email) }));
  };

  const handlePrescriptionYes = () => {
    if (!prescription) return;
    setOpenForms((f) => ({ ...f, prescription: buildPrescriptionForm(prescription, email) }));
  };

  const handlePrescriptionNo = () => {
    dismissPrompt(email.id, 'prescription');
  };

  const handlePrescriptionSave = () => {
    if (!prescription) return;
    const f = openForms.prescription;
    if (!f || !f.title.trim()) return;
    addPromptedTask({
      emailId: email.id,
      kind: 'prescription',
      title: f.title.trim(),
      type: f.type.trim() || 'Prescription',
      estMin: Math.max(1, parseInt(f.estMin, 10) || prescriptionMinutes(prescription)),
      priority: f.priority,
      patientName: f.patientName.trim() || null,
      dueDays: f.dueDays.trim() === '' ? null : Math.max(0, parseInt(f.dueDays, 10) || 0),
      notes: f.notes.trim(),
      controlledDrug: prescription.controlledDrug,
      medicationName: prescription.medicationName,
      medicationDose: prescription.medicationDose,
      travelMentioned: prescription.travelMentioned,
    });
    setOpenForms((curr) => {
      const { prescription: _drop, ...rest } = curr;
      void _drop;
      return rest;
    });
  };

  const handlePrescriptionCancel = () => {
    setOpenForms((curr) => {
      const { prescription: _drop, ...rest } = curr;
      void _drop;
      return rest;
    });
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

      {showPrescriptionPrompt && prescription && (
        <PrescriptionPromptCard
          prescription={prescription}
          form={openForms.prescription}
          updateForm={(patch) =>
            setOpenForms((f) => {
              const curr = f.prescription;
              if (!curr) return f;
              return { ...f, prescription: { ...curr, ...patch } };
            })
          }
          onYes={handlePrescriptionYes}
          onNo={handlePrescriptionNo}
          onSave={handlePrescriptionSave}
          onCancel={handlePrescriptionCancel}
          emailSubject={email.subject}
        />
      )}

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
                <Field label="Notes (your own words — optional)">
                  <textarea
                    value={form.notes}
                    onChange={(e) => updateForm(p.kind, { notes: e.target.value })}
                    rows={2}
                    placeholder="Add any context that will help you remember what this task is for."
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 resize-y placeholder:text-slate-400 placeholder:italic"
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
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Prescription prompt card ----------------------------------------------
// Dedicated card for prescription/script requests detected by the
// deterministic prescriptionDetect module. Renders:
//   - the time-sensitive red banner (urgency='critical', ≤3 days)
//   - the controlled-drug warning chip (Ritalin/Concerta/etc)
//   - a spec-format prompt: "{patient} needs {flavour} {med} script before {deadline}"
//   - Yes / No buttons; Yes opens the same edit form used by the
//     generic prompts but pre-filled with rich data (due date one
//     day before the family's deadline).
function PrescriptionPromptCard({
  prescription,
  form,
  updateForm,
  onYes,
  onNo,
  onSave,
  onCancel,
  emailSubject,
}: {
  prescription: PrescriptionRequest;
  form: FormDraft | undefined;
  updateForm: (patch: Partial<FormDraft>) => void;
  onYes: () => void;
  onNo: () => void;
  onSave: () => void;
  onCancel: () => void;
  emailSubject: string;
}) {
  const urgency = prescriptionUrgency(prescription);
  const isCritical = urgency === 'critical';
  const med = [prescription.medicationName, prescription.medicationDose].filter(Boolean).join(' ');
  const patient = prescription.patientName ?? 'The patient';
  const flavourWord =
    prescription.flavour === 'early' ? 'an early'
    : prescription.flavour === 'lost' ? 'a replacement'
    : 'a repeat';
  const deadlinePhrase = prescription.deadlineLabel ? ` before ${prescription.deadlineLabel}` : '';
  // Avoid "script script" when no medication name was detected — fall
  // back to a single "script" instead of "{med} script".
  const subject = med ? `${med} script` : 'script';
  const promptLine = `${patient} needs ${flavourWord} ${subject}${deadlinePhrase}.`;

  return (
    <div
      className="bg-white border border-amber-200/70 rounded-xl p-3 mb-2"
      data-testid="prescription-prompt"
    >
      {isCritical && prescription.deadlineLabel && (
        <div
          className="flex items-start gap-2 mb-3 bg-red-50 border border-red-200 rounded-lg p-2.5"
          data-testid="prescription-time-sensitive-banner"
        >
          <Zap size={14} className="text-red-600 mt-0.5 flex-shrink-0" />
          <div className="text-[12px] leading-snug">
            <p className="font-bold text-red-800">Time sensitive</p>
            <p className="text-red-700">
              This family needs a script before {prescription.deadlineLabel}. Today is {todayLabel()}.
            </p>
          </div>
        </div>
      )}
      {prescription.controlledDrug && (
        <div
          className="flex items-start gap-2 mb-3 bg-orange-50 border border-orange-200 rounded-lg p-2.5"
          data-testid="prescription-controlled-drug-warning"
        >
          <AlertTriangle size={13} className="text-orange-600 mt-0.5 flex-shrink-0" />
          <p className="text-[12px] text-orange-800 leading-snug">
            <span className="font-bold">⚠️ Controlled drug</span> — check prescribing rules and patient record before issuing.
          </p>
        </div>
      )}

      {!form ? (
        <>
          <div className="flex items-center gap-2 mb-1">
            <Pill size={13} className="text-amber-700" />
            <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wide">
              Prescription task detected
            </p>
          </div>
          <p className="text-sm font-bold text-amber-900 mb-3">{promptLine}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onYes}
              className="text-xs font-bold bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-1.5"
              data-testid="prescription-yes"
            >
              <Check size={13} /> Yes — add task
            </button>
            <button
              type="button"
              onClick={onNo}
              className="text-xs font-bold bg-white border border-amber-300 text-amber-800 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-colors flex items-center gap-1.5"
              data-testid="prescription-no"
            >
              <X size={13} /> No — not needed
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest">
            New prescription task — review and edit before saving
          </p>
          <Field label="Task title">
            <input
              type="text"
              value={form.title}
              onChange={(e) => updateForm({ title: e.target.value })}
              className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
              data-testid="prescription-form-title"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type">
              <input
                type="text"
                value={form.type}
                onChange={(e) => updateForm({ type: e.target.value })}
                className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
            </Field>
            <Field label="Est. minutes">
              <input
                type="number"
                min={1}
                value={form.estMin}
                onChange={(e) => updateForm({ estMin: e.target.value })}
                className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                data-testid="prescription-form-estmin"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Priority">
              <select
                value={form.priority}
                onChange={(e) => updateForm({ priority: e.target.value as 'high' | 'medium' | 'low' })}
                className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
              >
                <option value="high">High / Urgent</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </Field>
            <Field label={`Due in days (one day before ${prescription.deadlineLabel ?? 'family deadline'})`}>
              <input
                type="number"
                min={0}
                value={form.dueDays}
                onChange={(e) => updateForm({ dueDays: e.target.value })}
                className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                data-testid="prescription-form-duedays"
              />
            </Field>
          </div>
          <Field label="Patient">
            <input
              type="text"
              value={form.patientName}
              onChange={(e) => updateForm({ patientName: e.target.value })}
              className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
            />
          </Field>
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => updateForm({ notes: e.target.value })}
              rows={3}
              className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 resize-y"
            />
          </Field>
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Link2 size={10} /> Linked to: <span className="font-semibold text-foreground">{emailSubject}</span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={onSave}
              disabled={!form.title.trim()}
              className={cn(
                'text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors',
                form.title.trim()
                  ? 'bg-amber-600 text-white hover:bg-amber-700'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed',
              )}
              data-testid="prescription-save"
            >
              <Plus size={13} /> Add to my tasks
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="text-xs font-bold bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
              data-testid="prescription-cancel"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
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
