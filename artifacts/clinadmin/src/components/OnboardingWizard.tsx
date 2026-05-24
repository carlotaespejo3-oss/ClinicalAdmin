// OnboardingWizard.tsx
//
// Full-screen modal wizard shown to clinicians on first launch.
// Collects: name · role/specialty/setting · critical keywords · deadline
// expectations · admin time blocks · reply tone · email signatures · cover contact.
//
// Persistence: every Back/Next/Skip saves the current draft to userProfileStore
// (localStorage), so "Save & exit" can be resumed at the exact step where the
// clinician left off.

import { useState } from 'react';
import {
  Sparkles,
  ChevronRight,
  ChevronLeft,
  X,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useUserProfile,
  updateProfile,
  completeOnboarding,
  type ClinRole,
  type ClinSetting,
  type ReplyTone,
  type WeekDay,
  type AdminTimeBlock,
  type EmailSignature,
} from '@/lib/userProfileStore';
import {
  getAppSettings,
  setAppSettingsInternal,
  setSignaturesSettingsInternal,
} from '@/lib/clinicianSettingsStore';
import type { SignaturesSettings } from '@/lib/clinicianSettingsStore';

// ============================================================================
// Sync wizard data into the rest of the app on completion
// ============================================================================

const ROLE_DISPLAY: Record<ClinRole, string> = {
  doctor:       'Doctor',
  psychologist: 'Psychologist',
  nurse:        'Nurse Practitioner',
  social_worker:'Social Worker',
  therapist:    'Therapist',
  admin_staff:  'Admin Staff',
  other:        'Clinician',
};

/**
 * Called when the wizard completes. Copies the wizard-collected fields
 * into the stores that the rest of the app already reads from, so the
 * new name/role/signatures/tone all take effect immediately.
 */
function applyWizardToApp(params: {
  displayName: string;
  role: ClinRole;
  roleOther: string;
  specialty: string;
  signatures: EmailSignature[];
}) {
  const { displayName, role, roleOther, specialty, signatures } = params;

  // ── Name + role → clinicianSettingsStore (drives sidebar, header,
  //    draft prompts, and the default email sign-off)
  const roleLabel =
    role === 'other' && roleOther.trim()
      ? roleOther.trim()
      : specialty.trim()
      ? `${ROLE_DISPLAY[role]}, ${specialty.trim()}`
      : ROLE_DISPLAY[role];

  const current = getAppSettings();
  setAppSettingsInternal({
    ...current,
    profile: {
      ...current.profile,
      fullName: displayName.trim() || current.profile.fullName,
      role:     roleLabel,
    },
  });

  // ── Signatures → clinicianSettingsStore (used by draft prompt builder)
  // Map wizard slots to recipient types:
  //   formal   → default + Other Professionals
  //   informal → Families + Recurrent Families / Patients
  //   admin    → Admin Team
  const get = (id: string) => signatures.find((s) => s.id === id)?.body.trim() ?? '';
  const formal   = get('formal');
  const informal = get('informal');
  const admin    = get('admin');

  const currentSigs = { default: '', perRecipient: {} } as SignaturesSettings;
  const newSigs: SignaturesSettings = {
    default: formal || currentSigs.default,
    perRecipient: {
      ...currentSigs.perRecipient,
      ...(formal   ? { 'Other Professionals': formal } : {}),
      ...(informal ? { 'Families': informal, 'Recurrent Families / Patients': informal } : {}),
      ...(admin    ? { 'Admin Team': admin } : {}),
    },
  };
  if (formal || informal || admin) {
    setSignaturesSettingsInternal(newSigs);
  }
}

// ============================================================================
// Step definitions
// ============================================================================

const STEPS = [
  'welcome',
  'name',
  'role',
  'keywords',
  'deadlines',
  'admin-time',
  'tone',
  'signatures',
  'cover',
  'done',
] as const;
type StepId = (typeof STEPS)[number];
const TOTAL_DATA_STEPS = 8; // steps 1–8 (name → cover)

const STEP_META: Partial<Record<StepId, { title: string; subtitle?: string }>> = {
  name:         { title: 'What should we call you?' },
  role:         { title: 'Your role & setting',        subtitle: 'Helps ClinAdmin tailor labels and AI suggestions.' },
  keywords:     { title: 'Always-urgent topics',        subtitle: 'Describe concerns, not just words — ClinAdmin reads for meaning.' },
  deadlines:    { title: 'Response time expectations', subtitle: 'ClinAdmin will show countdown badges on flagged emails.' },
  'admin-time': { title: 'Admin time blocks',          subtitle: 'When do you usually tackle your inbox?' },
  tone:         { title: 'Your reply style',           subtitle: 'Used as the baseline for AI-drafted replies.' },
  signatures:   { title: 'Email signatures',           subtitle: 'Appended automatically based on email type.' },
  cover:        { title: 'Cover clinician',            subtitle: 'Who handles your patients when you\'re on leave?' },
};

// ============================================================================
// Constants
// ============================================================================

const ROLES: { value: ClinRole; label: string }[] = [
  { value: 'doctor',       label: 'Doctor / Consultant' },
  { value: 'psychologist', label: 'Psychologist' },
  { value: 'nurse',        label: 'Nurse / NP' },
  { value: 'social_worker',label: 'Social Worker' },
  { value: 'therapist',    label: 'Therapist / OT' },
  { value: 'other',        label: 'Other' },
];

const SETTINGS: { value: ClinSetting; label: string; desc: string }[] = [
  { value: 'outpatient', label: 'Outpatient',      desc: 'Regular clinic appointments' },
  { value: 'inpatient',  label: 'Inpatient',       desc: 'Ward / admitted patients' },
  { value: 'mixed',      label: 'Mixed',           desc: 'Both inpatient & outpatient' },
  { value: 'acute',      label: 'Acute / Crisis',  desc: 'Emergency & crisis work' },
  { value: 'community',  label: 'Community',       desc: 'Home visits / community care' },
];

// These are topic/concept descriptors, not single words.
// They feed the AI as semantic concepts — so "self-harm or thoughts of hurting oneself"
// catches "not feeling herself", "hurting himself", "can't stop cutting" etc.
const SUGGESTED_TOPICS = [
  'self-harm or thoughts of hurting oneself',
  'suicidal thoughts or intent',
  'clinical deterioration',
  'dialysis or kidney-related crisis',
  'overdose or poisoning',
  'safeguarding or risk to a child',
  'acute infection or sepsis',
  'psychosis or loss of reality',
  'collapse or loss of consciousness',
  'abscess, wound infection or signs of pus',
];

// Values in hours (stored as-is; planner converts via Math.ceil(h/24)).
// Kept day/week-granular — nobody realistically responds in under a day
// during scheduled admin time.
const DEADLINE_OPTIONS_URGENT = [
  { value: 24,  label: '1 day' },
  { value: 48,  label: '2 days' },
  { value: 72,  label: '3 days' },
  { value: 120, label: '5 days' },
];
const DEADLINE_OPTIONS_CLINICAL = [
  { value: 48,  label: '2 days' },
  { value: 72,  label: '3 days' },
  { value: 120, label: '5 days' },
  { value: 168, label: '1 week' },
  { value: 336, label: '2 weeks' },
];
const DEADLINE_OPTIONS_ADMIN = [
  { value: 72,  label: '3 days' },
  { value: 120, label: '5 days' },
  { value: 168, label: '1 week' },
  { value: 336, label: '2 weeks' },
];

const DAYS: WeekDay[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const DAY_LABELS: Record<WeekDay, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri' };

// ============================================================================
// TagInput
// ============================================================================

function TagInput({
  tags,
  onChange,
  placeholder = 'Type and press Enter…',
  suggestions = [],
}: {
  tags: string[];
  onChange: (t: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}) {
  const [input, setInput] = useState('');

  const add = (raw: string) => {
    const v = raw.trim().toLowerCase();
    if (!v || tags.includes(v)) return;
    onChange([...tags, v]);
  };

  const remove = (t: string) => onChange(tags.filter((x) => x !== t));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input); setInput(''); }
    if (e.key === 'Backspace' && !input && tags.length > 0) onChange(tags.slice(0, -1));
  };

  const unused = suggestions.filter((s) => !tags.includes(s));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 p-3 border border-border rounded-xl bg-background min-h-[56px] cursor-text">
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-1 bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 rounded-full text-xs font-semibold">
            {t}
            <button type="button" onClick={() => remove(t)} className="hover:text-red-900 ml-0.5">
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={tags.length === 0 ? placeholder : 'Add another…'}
          className="flex-1 min-w-[140px] text-sm bg-transparent outline-none"
        />
      </div>
      {unused.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Quick add</p>
          <div className="flex flex-wrap gap-1.5">
            {unused.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => add(s)}
                className="text-xs px-2.5 py-1 rounded-full border border-dashed border-slate-300 text-slate-500 hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors"
              >
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Step content
// ============================================================================

function StepWelcome() {
  return (
    <div className="flex flex-col items-center text-center py-4 space-y-5">
      <div className="w-20 h-20 rounded-full bg-indigo-100 flex items-center justify-center">
        <Sparkles size={36} className="text-indigo-600" />
      </div>
      <div>
        <h1 className="text-3xl font-bold text-foreground">Welcome to ClinAdmin</h1>
        <p className="mt-3 text-muted-foreground text-base max-w-sm mx-auto leading-relaxed">
          Great to have you here. Let's spend 3 minutes making ClinAdmin work
          exactly the way <em>you</em> work — not the other way around.
        </p>
      </div>
      <p className="text-xs text-muted-foreground/60">
        You can skip any step and come back to it later in Settings.
      </p>
    </div>
  );
}

function StepName({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        This appears across the app and in AI-generated drafts.
      </p>
      <input
        autoFocus
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Dr. Patterson  or  Alex"
        className="w-full border border-border rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </div>
  );
}

function StepRole({
  role, roleOther, specialty, setting,
  onChange,
}: {
  role: ClinRole; roleOther: string; specialty: string; setting: ClinSetting;
  onChange: (p: Partial<{ role: ClinRole; roleOther: string; specialty: string; setting: ClinSetting }>) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Role pills */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Your role</p>
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => onChange({ role: r.value })}
              className={cn(
                'px-3 py-1.5 rounded-full border text-sm font-medium transition-colors',
                role === r.value ? 'bg-primary text-white border-primary' : 'border-border hover:border-primary hover:text-primary',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        {role === 'other' && (
          <input
            autoFocus
            className="mt-2 w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="Describe your role…"
            value={roleOther}
            onChange={(e) => onChange({ roleOther: e.target.value })}
          />
        )}
      </div>

      {/* Specialty */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Specialty / service</p>
        <input
          type="text"
          value={specialty}
          onChange={(e) => onChange({ specialty: e.target.value })}
          placeholder="e.g. Child & Adolescent Psychiatry, Nephrology, Oncology…"
          className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* Setting */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Care setting</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {SETTINGS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => onChange({ setting: s.value })}
              className={cn(
                'p-3 rounded-xl border text-left transition-colors',
                setting === s.value ? 'bg-primary/5 border-primary' : 'border-border hover:border-primary/40',
              )}
            >
              <p className={cn('text-xs font-bold', setting === s.value ? 'text-primary' : 'text-foreground')}>{s.label}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{s.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepKeywords({ keywords, onChange }: { keywords: string[]; onChange: (k: string[]) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Are there <strong>topics or clinical concerns</strong> that should always trigger an urgent flag,
        no matter how the email is worded? Describe the concept — not just one word.
      </p>
      <p className="text-sm text-muted-foreground leading-relaxed">
        For example: <em>"self-harm or thoughts of hurting oneself"</em> will also catch
        "not feeling herself", "can't stop hurting himself", "been cutting again" — because
        ClinAdmin reads for meaning, not just exact matches.
      </p>
      <TagInput
        tags={keywords}
        onChange={onChange}
        placeholder="Describe a concern and press Enter…"
        suggestions={SUGGESTED_TOPICS}
      />
      <p className="text-xs text-muted-foreground/60 italic">
        Leave empty to rely on ClinAdmin's AI classifier. You can edit these at any time in Settings.
      </p>
    </div>
  );
}

function StepDeadlines({
  deadlines,
  onChange,
}: {
  deadlines: { urgent: number; clinical: number; admin: number };
  onChange: (d: { urgent: number; clinical: number; admin: number }) => void;
}) {
  const rows = [
    {
      key: 'urgent'   as const,
      label: 'Urgent / safety',
      desc: 'Patient risk, immediate clinical need',
      color: 'text-red-600',
      bg: 'bg-red-50 border-red-200',
      options: DEADLINE_OPTIONS_URGENT,
    },
    {
      key: 'clinical' as const,
      label: 'Clinical question',
      desc: 'Non-urgent queries, results, referrals',
      color: 'text-amber-600',
      bg: 'bg-amber-50 border-amber-200',
      options: DEADLINE_OPTIONS_CLINICAL,
    },
    {
      key: 'admin'    as const,
      label: 'Admin / general',
      desc: 'Scheduling, forms, general correspondence',
      color: 'text-slate-600',
      bg: 'bg-slate-50 border-slate-200',
      options: DEADLINE_OPTIONS_ADMIN,
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        How long do you aim to take responding to each type of email?
        ClinAdmin uses these to prioritise your plan and show you when something
        is approaching its window.
      </p>
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.key} className={cn('flex items-center gap-4 p-3 rounded-xl border', row.bg)}>
            <div className="flex-1 min-w-0">
              <p className={cn('text-xs font-bold', row.color)}>{row.label}</p>
              <p className="text-[10px] text-muted-foreground">{row.desc}</p>
            </div>
            <select
              value={deadlines[row.key]}
              onChange={(e) => onChange({ ...deadlines, [row.key]: Number(e.target.value) })}
              className="text-xs border border-border rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 min-w-[110px]"
            >
              {row.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepAdminTime({ blocks, onChange }: { blocks: AdminTimeBlock[]; onChange: (b: AdminTimeBlock[]) => void }) {
  const addBlock = () => onChange([...blocks, { days: ['mon'], startTime: '09:00', endTime: '10:00' }]);
  const remove = (i: number) => onChange(blocks.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<AdminTimeBlock>) => {
    const next = [...blocks];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const toggleDay = (i: number, day: WeekDay) => {
    const days = blocks[i].days.includes(day)
      ? blocks[i].days.filter((d) => d !== day)
      : [...blocks[i].days, day];
    update(i, { days });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Do you have regular times set aside for email & admin? ClinAdmin will use these to
        schedule your catch-up queue and avoid nudging you during patient time.
        You can always adjust in Settings.
      </p>
      {blocks.length === 0 && (
        <p className="text-sm text-muted-foreground/60 italic">No blocks added yet — that's absolutely fine.</p>
      )}
      <div className="space-y-3">
        {blocks.map((block, i) => (
          <div key={i} className="p-3 border border-border rounded-xl bg-muted/20 space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold">Block {i + 1}</p>
              <button type="button" onClick={() => remove(i)} className="text-muted-foreground hover:text-red-500 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(i, d)}
                  className={cn(
                    'px-2 py-1 rounded text-[10px] font-bold border transition-colors',
                    block.days.includes(d) ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:border-primary hover:text-primary',
                  )}
                >
                  {DAY_LABELS[d]}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={block.startTime}
                onChange={(e) => update(i, { startTime: e.target.value })}
                className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="time"
                value={block.endTime}
                onChange={(e) => update(i, { endTime: e.target.value })}
                className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addBlock}
        className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
      >
        <Plus size={13} /> Add admin block
      </button>
    </div>
  );
}

function StepTone({ tone, onChange }: { tone: ReplyTone; onChange: (t: ReplyTone) => void }) {
  const options: { value: ReplyTone; label: string; desc: string; example: string }[] = [
    {
      value: 'formal',
      label: 'Formal',
      desc: 'Professional & traditional',
      example: '"Thank you for your correspondence. I will review the referral and revert by end of week."',
    },
    {
      value: 'semi-formal',
      label: 'Semi-formal',
      desc: 'Warm but professional',
      example: '"Thanks for getting in touch. I\'ll take a look and come back to you shortly."',
    },
    {
      value: 'informal',
      label: 'Informal',
      desc: 'Relaxed & conversational',
      example: '"Hi — thanks for flagging this. I\'ll check and get back to you today."',
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        What's your natural email style? The AI will use this as a starting point when
        drafting replies — but you can always override it per email.
      </p>
      <div className="space-y-2.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'w-full text-left p-4 rounded-xl border transition-colors',
              tone === opt.value ? 'bg-primary/5 border-primary' : 'border-border hover:border-primary/40',
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <p className={cn('text-sm font-bold', tone === opt.value ? 'text-primary' : 'text-foreground')}>{opt.label}</p>
              <span className="text-[10px] text-muted-foreground">{opt.desc}</span>
            </div>
            <p className="text-xs text-muted-foreground italic">{opt.example}</p>
          </button>
        ))}
      </div>
      {/* AI learning note */}
      <div className="flex items-start gap-2.5 bg-indigo-50 border border-indigo-200 rounded-xl p-3">
        <Sparkles size={14} className="text-indigo-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-indigo-700 leading-relaxed">
          <strong>The AI assistant will go learning.</strong> Over time it will analyse
          patterns in your existing emails and naturally adapt to match your voice — so
          drafts sound more like you, not like a template. This feature is coming soon.
        </p>
      </div>
    </div>
  );
}

function StepSignatures({
  signatures,
  onChange,
}: {
  signatures: EmailSignature[];
  onChange: (s: EmailSignature[]) => void;
}) {
  const defaultIds = ['formal', 'informal', 'admin'];
  const allSigs = signatures;
  const [activeId, setActiveId] = useState(allSigs[0]?.id ?? 'formal');

  const active = allSigs.find((s) => s.id === activeId) ?? allSigs[0];
  const isCustom = active ? !defaultIds.includes(active.id) : false;

  const updateSig = (id: string, patch: Partial<EmailSignature>) =>
    onChange(allSigs.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const addCustom = () => {
    const id = `custom_${Date.now()}`;
    const next = [...allSigs, { id, label: 'Custom', body: '' }];
    onChange(next);
    setActiveId(id);
  };

  const removeCustom = (id: string) => {
    const next = allSigs.filter((s) => s.id !== id);
    onChange(next);
    setActiveId(next[0]?.id ?? 'formal');
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Add signatures for different email types. ClinAdmin will append the right one
        automatically based on the email category.
      </p>
      {/* Outlook import note */}
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
        <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
        <span>
          <strong>Outlook import:</strong> Outlook signatures live in the local desktop
          app and can't be fetched via API. Paste your existing text below, or leave it
          for now and add it later in Settings → Signatures.
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-border flex-wrap">
        {allSigs.map((sig) => (
          <button
            key={sig.id}
            type="button"
            onClick={() => setActiveId(sig.id)}
            className={cn(
              'px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap',
              activeId === sig.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {sig.label}
          </button>
        ))}
        <button
          type="button"
          onClick={addCustom}
          className="px-2 py-2 text-xs text-primary hover:text-primary/80 flex items-center gap-1"
        >
          <Plus size={11} /> Custom
        </button>
      </div>

      {/* Editor */}
      {active && (
        <div className="space-y-2">
          {isCustom && (
            <div className="flex items-center gap-2">
              <input
                value={active.label}
                onChange={(e) => updateSig(active.id, { label: e.target.value })}
                className="flex-1 border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="Signature name"
              />
              <button type="button" onClick={() => removeCustom(active.id)} className="text-muted-foreground hover:text-red-500 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
          )}
          <textarea
            value={active.body}
            onChange={(e) => updateSig(active.id, { body: e.target.value })}
            rows={6}
            placeholder={`Paste or type your ${active.label.toLowerCase()} signature here…`}
            className="w-full border border-border rounded-xl px-4 py-3 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      )}
      <p className="text-xs text-muted-foreground/60">
        All signatures can be edited at any time in Settings → Signatures.
      </p>
    </div>
  );
}

function StepCover({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Who covers your patients when you're on leave? ClinAdmin can remind you to notify
        them when you log an absence block.
      </p>
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Cover clinician (name or email)
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Dr. Sarah Okonkwo  or  s.okonkwo@nhs.net"
          className="w-full border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
      <p className="text-xs text-muted-foreground/60 italic">
        Optional — you can add or change this later in Settings.
      </p>
    </div>
  );
}

function StepDone({ name }: { name: string }) {
  const first = name.split(/\s+/)[0];
  return (
    <div className="flex flex-col items-center text-center py-4 space-y-5">
      <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
        <CheckCircle2 size={40} className="text-emerald-600" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-foreground">
          You're all set{first ? `, ${first}` : ''}!
        </h2>
        <p className="mt-2 text-muted-foreground max-w-sm mx-auto leading-relaxed">
          ClinAdmin is personalised and ready. Head to your inbox whenever you like.
        </p>
      </div>
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left w-full text-xs text-muted-foreground space-y-1.5">
        <p className="font-bold text-foreground mb-2">Change any of this later in Settings →</p>
        <p>· Critical keywords & priority rules</p>
        <p>· Response deadlines</p>
        <p>· Admin time blocks</p>
        <p>· Email signatures</p>
        <p>· Reply tone</p>
        <p>· Cover clinician</p>
      </div>
    </div>
  );
}

// ============================================================================
// Wizard shell
// ============================================================================

interface Props {
  /** Called on "Save & exit" (resume later) and on "Head to inbox" (complete). */
  onDismiss: () => void;
}

export default function OnboardingWizard({ onDismiss }: Props) {
  const { profile } = useUserProfile();

  // Local draft state — written to store on every navigation
  const [step, setStep] = useState<number>(
    // Resume at the saved step, but clamp so we never land on 'done'
    Math.min(profile.onboardingStep, STEPS.indexOf('cover')),
  );
  const [name,         setName]         = useState(profile.displayName);
  const [role,         setRole]         = useState(profile.role);
  const [roleOther,    setRoleOther]    = useState(profile.roleOther);
  const [specialty,    setSpecialty]    = useState(profile.specialty);
  const [setting,      setSetting]      = useState(profile.setting);
  const [keywords,     setKeywords]     = useState(profile.criticalKeywords);
  const [deadlines,    setDeadlines]    = useState(profile.deadlines);
  const [adminBlocks,  setAdminBlocks]  = useState<AdminTimeBlock[]>(profile.adminTimeBlocks);
  const [tone,         setTone]         = useState<ReplyTone>(profile.defaultReplyTone);
  const [signatures,   setSignatures]   = useState<EmailSignature[]>(profile.signatures);
  const [coverContact, setCoverContact] = useState(profile.coverContact);

  const stepId   = STEPS[step];
  const isWelcome = stepId === 'welcome';
  const isDone    = stepId === 'done';
  const dataStep  = step - 1; // 0-based within data steps

  // Persist current form state to store
  const save = (nextStep: number) => {
    updateProfile({
      displayName:      name,
      role,
      roleOther,
      specialty,
      setting,
      criticalKeywords: keywords,
      deadlines,
      adminTimeBlocks:  adminBlocks,
      defaultReplyTone: tone,
      signatures,
      coverContact,
      onboardingStep:   nextStep,
    });
  };

  const goNext = () => {
    const next = step + 1;
    save(next);
    if (STEPS[next] === 'done') {
      completeOnboarding();
      applyWizardToApp({ displayName: name, role, roleOther, specialty, signatures });
    }
    setStep(next);
  };

  const goBack = () => {
    const prev = step - 1;
    save(prev);
    setStep(prev);
  };

  const handleDismiss = () => {
    save(step);
    onDismiss();
  };

  const handleFinish = () => {
    // applyWizardToApp was already called on goNext() into 'done',
    // but call again defensively in case the user landed on done via
    // a direct resume from a saved step.
    applyWizardToApp({ displayName: name, role, roleOther, specialty, signatures });
    completeOnboarding();
    onDismiss();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="relative bg-background rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[92vh]">

        {/* ── Top bar: progress + exit ── */}
        <div className="flex items-center gap-4 px-6 pt-5 pb-0 flex-shrink-0">
          {!isWelcome && !isDone ? (
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] text-muted-foreground font-medium">
                  Step {dataStep + 1} of {TOTAL_DATA_STEPS}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {Math.round(((dataStep + 1) / TOTAL_DATA_STEPS) * 100)}%
                </p>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${((dataStep + 1) / TOTAL_DATA_STEPS) * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1" />
          )}

          {!isDone && (
            <button
              type="button"
              onClick={handleDismiss}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 flex-shrink-0 transition-colors"
              title="Save progress and exit — you can resume later"
            >
              Save & exit <X size={12} />
            </button>
          )}
        </div>

        {/* ── Step title ── */}
        {!isWelcome && !isDone && (
          <div className="px-6 pt-5 pb-1 flex-shrink-0">
            <h2 className="text-lg font-bold text-foreground">{STEP_META[stepId]?.title}</h2>
            {STEP_META[stepId]?.subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{STEP_META[stepId]!.subtitle}</p>
            )}
          </div>
        )}

        {/* ── Scrollable content ── */}
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
          {stepId === 'welcome'    && <StepWelcome />}
          {stepId === 'name'       && <StepName value={name} onChange={setName} />}
          {stepId === 'role'       && (
            <StepRole
              role={role} roleOther={roleOther} specialty={specialty} setting={setting}
              onChange={(p) => {
                if (p.role      !== undefined) setRole(p.role);
                if (p.roleOther !== undefined) setRoleOther(p.roleOther);
                if (p.specialty !== undefined) setSpecialty(p.specialty);
                if (p.setting   !== undefined) setSetting(p.setting);
              }}
            />
          )}
          {stepId === 'keywords'   && <StepKeywords keywords={keywords} onChange={setKeywords} />}
          {stepId === 'deadlines'  && <StepDeadlines deadlines={deadlines} onChange={setDeadlines} />}
          {stepId === 'admin-time' && <StepAdminTime blocks={adminBlocks} onChange={setAdminBlocks} />}
          {stepId === 'tone'       && <StepTone tone={tone} onChange={setTone} />}
          {stepId === 'signatures' && <StepSignatures signatures={signatures} onChange={setSignatures} />}
          {stepId === 'cover'      && <StepCover value={coverContact} onChange={setCoverContact} />}
          {stepId === 'done'       && <StepDone name={name} />}
        </div>

        {/* ── Bottom nav ── */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between flex-shrink-0">
          {/* Back */}
          {!isWelcome && !isDone ? (
            <button
              type="button"
              onClick={goBack}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft size={16} /> Back
            </button>
          ) : (
            <div />
          )}

          {/* Right side */}
          {isDone ? (
            <button
              type="button"
              onClick={handleFinish}
              className="flex items-center gap-2 bg-primary text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-primary/90 transition-colors"
            >
              Head to my inbox <ChevronRight size={16} />
            </button>
          ) : isWelcome ? (
            <button
              type="button"
              onClick={goNext}
              className="flex items-center gap-2 bg-primary text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-primary/90 transition-colors"
            >
              Let's start <ChevronRight size={16} />
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={goNext}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={goNext}
                className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-primary/90 transition-colors"
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
