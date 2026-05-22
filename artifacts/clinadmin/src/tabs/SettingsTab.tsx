import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, User, Calendar, Bell, PenLine, Check, Clock, RotateCcw, RefreshCcw, ChevronDown, ChevronUp, Trash2, AlertTriangle, CornerUpLeft } from 'lucide-react';
import {
  useDismissedBacklogItems,
  restoreBacklogItem,
  clearDismissedHistory,
  type DismissedBacklogItem,
} from '@/lib/backlogQueueStore';
import type { DismissReason } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import {
  RECIPIENT_TYPES,
  type RecipientType,
  useSignatures,
  setDefaultSignature,
  setRecipientSignature,
} from '@/lib/signatures';
import {
  type AppSettings,
  type SlaConfig,
  type WeeklyDay,
  WEEKLY_DAYS,
  DEFAULT_APP_SETTINGS,
  DEFAULT_SLA_CONFIG,
  useAppSettingsCache,
  setAppSettingsInternal,
  resetAppSettingsInternal,
} from '@/lib/clinicianSettingsStore';
import type { AiCategory } from '@/lib/types';

// Profile, weekly defaults, and notifications now live in the
// shared clinician-settings store (Postgres-backed, hydrate-once
// + fire-and-forget). This tab is the editor; WeeklySetupModal is
// the other reader. Signatures use the same store via
// useSignatures().
const DAYS = WEEKLY_DAYS;

const SLA_LABELS: Partial<Record<AiCategory, string>> = {
  SAFEGUARDING: 'Safeguarding',
  URGENT_CLINICAL: 'Urgent clinical',
  LEGAL: 'Legal / medico-legal',
  CLINICAL: 'Clinical (routine)',
  PROFESSIONAL: 'Professional',
  ADMIN: 'Admin',
  CPD: 'CPD / learning',
  NONE: 'Informational / no action',
  UNCLEAR: 'Unclear (auto-triage)',
};

const SLA_MIN: Partial<Record<AiCategory, number>> = {
  SAFEGUARDING: 1, URGENT_CLINICAL: 1, LEGAL: 1,
  CLINICAL: 1, PROFESSIONAL: 1,
  ADMIN: 1, CPD: 1, NONE: 1,
};

const SLA_MAX: Partial<Record<AiCategory, number>> = {
  SAFEGUARDING: 3, URGENT_CLINICAL: 7, LEGAL: 7,
  CLINICAL: 30, PROFESSIONAL: 30,
  ADMIN: 60, CPD: 60, NONE: 60,
};

const SLA_GROUPS: { label: string; categories: AiCategory[] }[] = [
  { label: 'Safety & urgent', categories: ['SAFEGUARDING', 'URGENT_CLINICAL', 'LEGAL'] },
  { label: 'Clinical & professional', categories: ['CLINICAL', 'PROFESSIONAL'] },
  { label: 'Admin & other', categories: ['ADMIN', 'CPD', 'NONE', 'UNCLEAR'] },
];

export default function SettingsTab() {
  // Subscribe to the live cache. Local state mirrors it so edits
  // feel instant even before the persist round-trip resolves.
  const liveSettings = useAppSettingsCache();
  const [settings, setSettings] = useState<AppSettings>(liveSettings);
  const [showSaved, setShowSaved] = useState(false);
  // Signatures live in the shared clinician-settings store so
  // draftPrompts.ts (and any other consumer) can read them
  // synchronously from the same in-memory cache.
  const signatureStore = useSignatures();

  useEffect(() => {
    setSettings(liveSettings);
  }, [liveSettings]);

  useEffect(() => {
    if (!showSaved) return;
    const t = setTimeout(() => setShowSaved(false), 2500);
    return () => clearTimeout(t);
  }, [showSaved]);

  const persist = (next: AppSettings) => {
    // Optimistic local update; setAppSettingsInternal updates the
    // shared cache and POSTs in the background.
    setSettings(next);
    setAppSettingsInternal(next);
    setShowSaved(true);
  };

  const flashSaved = () => setShowSaved(true);

  const updateProfile = <K extends keyof AppSettings['profile']>(key: K, value: AppSettings['profile'][K]) => {
    persist({ ...settings, profile: { ...settings.profile, [key]: value } });
  };

  const updateWeekly = <K extends keyof AppSettings['weeklyDefaults']>(key: K, value: AppSettings['weeklyDefaults'][K]) => {
    persist({ ...settings, weeklyDefaults: { ...settings.weeklyDefaults, [key]: value } });
  };

  const toggleDay = (day: WeeklyDay) => {
    const has = settings.weeklyDefaults.days.includes(day);
    const next = has
      ? settings.weeklyDefaults.days.filter(d => d !== day)
      : [...settings.weeklyDefaults.days, day].sort(
          (a, b) => DAYS.indexOf(a) - DAYS.indexOf(b),
        );
    updateWeekly('days', next);
  };

  const toggleNotification = (key: keyof AppSettings['notifications']) => {
    persist({
      ...settings,
      notifications: { ...settings.notifications, [key]: !settings.notifications[key] },
    });
  };

  const updateSignature = (value: string) => {
    setDefaultSignature(value);
    flashSaved();
  };

  const updateRecipientSignature = (recipient: RecipientType, value: string) => {
    setRecipientSignature(recipient, value);
    flashSaved();
  };

  const resetDefaults = () => {
    setSettings(DEFAULT_APP_SETTINGS);
    resetAppSettingsInternal();
    setShowSaved(true);
  };

  const effectiveSla = settings.slaConfig?.slaDaysByCategory ?? DEFAULT_SLA_CONFIG.slaDaysByCategory;
  const effectiveRunway = settings.slaConfig?.runwayDays ?? DEFAULT_SLA_CONFIG.runwayDays;

  const updateSla = (category: AiCategory, days: number) => {
    persist({
      ...settings,
      slaConfig: {
        slaDaysByCategory: { ...effectiveSla, [category]: days },
        runwayDays: effectiveRunway,
      },
    });
  };

  const updateRunwayDays = (days: number) => {
    persist({
      ...settings,
      slaConfig: { slaDaysByCategory: effectiveSla, runwayDays: days },
    });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <SettingsIcon size={22} className="text-primary" />
            Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your profile, weekly defaults, notifications, and the signature used in AI-drafted replies.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {showSaved && (
            <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
              <Check size={12} /> Saved
            </span>
          )}
          <button
            onClick={resetDefaults}
            className="text-xs font-bold px-3 py-1.5 rounded-lg border border-border bg-white text-slate-700 hover:border-primary/40 transition-colors"
            data-testid="button-reset-settings"
          >
            Reset to defaults
          </button>
        </div>
      </div>

      {/* Profile */}
      <section className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
        <header className="px-5 py-4 border-b border-border flex items-center gap-2.5">
          <User size={16} className="text-primary" />
          <h2 className="text-sm font-bold text-foreground">Profile</h2>
        </header>
        <div className="divide-y divide-border">
          <SettingRow label="Full name" hint="Shown on outgoing emails and reports.">
            <input
              type="text"
              value={settings.profile.fullName}
              onChange={e => updateProfile('fullName', e.target.value)}
              className="w-full sm:w-72 text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
              data-testid="input-profile-name"
            />
          </SettingRow>
          <SettingRow label="Role" hint="Job title used in your signature.">
            <input
              type="text"
              value={settings.profile.role}
              onChange={e => updateProfile('role', e.target.value)}
              className="w-full sm:w-72 text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
              data-testid="input-profile-role"
            />
          </SettingRow>
          <SettingRow label="Work email" hint="Where notifications and digests are sent.">
            <input
              type="email"
              value={settings.profile.email}
              onChange={e => updateProfile('email', e.target.value)}
              className="w-full sm:w-72 text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
              data-testid="input-profile-email"
            />
          </SettingRow>
          <SettingRow label="Service / Team" hint="Displayed on letters and forms.">
            <input
              type="text"
              value={settings.profile.serviceName}
              onChange={e => updateProfile('serviceName', e.target.value)}
              className="w-full sm:w-72 text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
              data-testid="input-profile-service"
            />
          </SettingRow>
        </div>
      </section>

      {/* Weekly defaults */}
      <section className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
        <header className="px-5 py-4 border-b border-border flex items-center gap-2.5">
          <Calendar size={16} className="text-primary" />
          <h2 className="text-sm font-bold text-foreground">Weekly defaults</h2>
        </header>
        <div className="divide-y divide-border">
          <SettingRow label="Admin hours per week" hint="Used to suggest a starting point for each weekly setup.">
            <div className="relative w-32">
              <input
                type="number"
                min={0}
                max={40}
                value={settings.weeklyDefaults.hoursPerWeek}
                onChange={e =>
                  updateWeekly('hoursPerWeek', Math.max(0, parseInt(e.target.value) || 0))
                }
                className="w-full text-sm bg-white border border-border rounded-lg pl-3 pr-12 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
                data-testid="input-weekly-hours"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">hrs</span>
            </div>
          </SettingRow>
          <SettingRow label="Default admin days" hint="Days you usually have protected admin time.">
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map(day => {
                const active = settings.weeklyDefaults.days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={cn(
                      'text-xs font-bold px-3 py-1.5 rounded-full border transition-colors',
                      active
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white text-slate-700 border-border hover:border-primary/40',
                    )}
                    data-testid={`day-${day.toLowerCase()}`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </SettingRow>
          <SettingRow label="Typical session length" hint="Used when blocking time on the planner.">
            <select
              value={settings.weeklyDefaults.sessionLengthMin}
              onChange={e => updateWeekly('sessionLengthMin', parseInt(e.target.value))}
              className="text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
              data-testid="select-session-length"
            >
              {[30, 45, 60, 90, 120].map(m => (
                <option key={m} value={m}>{m} minutes</option>
              ))}
            </select>
          </SettingRow>
        </div>
      </section>

      {/* Notifications */}
      <section className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
        <header className="px-5 py-4 border-b border-border flex items-center gap-2.5">
          <Bell size={16} className="text-primary" />
          <h2 className="text-sm font-bold text-foreground">Notifications</h2>
        </header>
        <div className="divide-y divide-border">
          <ToggleRow
            label="High-risk patient alerts"
            hint="Immediate alert when a patient is flagged high-risk."
            checked={settings.notifications.highRiskAlerts}
            onToggle={() => toggleNotification('highRiskAlerts')}
            testId="toggle-high-risk"
          />
          <ToggleRow
            label="Daily morning digest"
            hint="One email each morning with today's plan and emails to action."
            checked={settings.notifications.dailyDigest}
            onToggle={() => toggleNotification('dailyDigest')}
            testId="toggle-daily-digest"
          />
          <ToggleRow
            label="Weekly summary"
            hint="Friday recap of what was cleared and what's outstanding."
            checked={settings.notifications.weeklySummary}
            onToggle={() => toggleNotification('weeklySummary')}
            testId="toggle-weekly-summary"
          />
          <ToggleRow
            label="Draft ready to review"
            hint="Notify when AI has prepared a reply for you to approve."
            checked={settings.notifications.draftReady}
            onToggle={() => toggleNotification('draftReady')}
            testId="toggle-draft-ready"
          />
          <ToggleRow
            label="Play desktop sound"
            hint="Soft chime for high-priority notifications."
            checked={settings.notifications.desktopSound}
            onToggle={() => toggleNotification('desktopSound')}
            testId="toggle-desktop-sound"
          />
        </div>
      </section>

      {/* Signature */}
      <section className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
        <header className="px-5 py-4 border-b border-border flex items-center gap-2.5">
          <PenLine size={16} className="text-primary" />
          <h2 className="text-sm font-bold text-foreground">Email signatures</h2>
        </header>
        <div className="p-5 space-y-5">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Default signature</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Used for any AI-drafted reply when no recipient-specific signature is set. Plain text only.
              </p>
            </div>
            <textarea
              value={signatureStore.default}
              onChange={e => updateSignature(e.target.value)}
              rows={6}
              className="w-full text-sm bg-white border border-border rounded-lg px-3 py-2 font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
              data-testid="input-signature"
            />
            <div className="rounded-xl bg-slate-50 border border-border p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                Preview
              </p>
              <pre className="text-xs text-foreground whitespace-pre-wrap font-sans leading-relaxed">
                {signatureStore.default || '(no signature set)'}
              </pre>
            </div>
          </div>

          <div className="border-t border-border pt-5 space-y-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Per-recipient signatures</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Optional sign-offs tailored to each recipient type. Leave blank to fall back to the default above.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {RECIPIENT_TYPES.map(recipient => {
                const value = signatureStore.perRecipient[recipient] ?? '';
                const usingDefault = !value.trim();
                return (
                  <div key={recipient} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-bold text-foreground uppercase tracking-wider">
                        {recipient}
                      </label>
                      {usingDefault && (
                        <span className="text-[10px] font-semibold text-muted-foreground bg-slate-100 border border-border px-2 py-0.5 rounded-full">
                          Using default
                        </span>
                      )}
                    </div>
                    <textarea
                      value={value}
                      onChange={e => updateRecipientSignature(recipient, e.target.value)}
                      rows={5}
                      placeholder={`e.g. a warmer sign-off for ${recipient.toLowerCase()}…`}
                      className="w-full text-sm bg-white border border-border rounded-lg px-3 py-2 font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
                      data-testid={`input-signature-${recipient.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Response time targets */}
      <section className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
        <header className="px-5 py-4 border-b border-border flex items-center gap-2.5">
          <Clock size={16} className="text-primary" />
          <h2 className="text-sm font-bold text-foreground">Response time targets</h2>
        </header>
        <div className="p-5 space-y-5">
          <p className="text-xs text-muted-foreground">
            How many days from receipt before each item should be actioned. These drive urgency scores and runway warnings in the planner.
          </p>
          {SLA_GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">{group.label}</p>
              <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
                {group.categories.map(category => {
                  const current = effectiveSla[category] ?? DEFAULT_SLA_CONFIG.slaDaysByCategory[category];
                  const fixed = category === 'UNCLEAR';
                  const min = SLA_MIN[category] ?? 1;
                  const max = SLA_MAX[category] ?? 60;
                  return (
                    <div key={category} className="px-4 py-3 flex items-center justify-between gap-4 bg-white">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{SLA_LABELS[category]}</p>
                        {fixed && (
                          <p className="text-xs text-muted-foreground">Always triaged immediately — not configurable</p>
                        )}
                      </div>
                      {fixed ? (
                        <span className="text-xs font-semibold text-muted-foreground bg-slate-100 border border-border px-3 py-1 rounded-full">
                          {current}d (fixed)
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => updateSla(category, Math.max(min, current - 1))}
                            disabled={current <= min}
                            className="w-7 h-7 rounded-md border border-border bg-white text-slate-700 flex items-center justify-center text-base font-bold hover:border-primary/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >−</button>
                          <span className="w-16 text-center text-sm font-semibold text-foreground tabular-nums">
                            {current} {current === 1 ? 'day' : 'days'}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateSla(category, Math.min(max, current + 1))}
                            disabled={current >= max}
                            className="w-7 h-7 rounded-md border border-border bg-white text-slate-700 flex items-center justify-center text-base font-bold hover:border-primary/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >+</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="border-t border-border pt-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Planning horizon</p>
              <p className="text-xs text-muted-foreground mt-0.5">How many days ahead the runway shows (7–60 days).</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateRunwayDays(Math.max(7, effectiveRunway - 1))}
                disabled={effectiveRunway <= 7}
                className="w-7 h-7 rounded-md border border-border bg-white text-slate-700 flex items-center justify-center text-base font-bold hover:border-primary/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >−</button>
              <span className="w-16 text-center text-sm font-semibold text-foreground tabular-nums">
                {effectiveRunway} days
              </span>
              <button
                type="button"
                onClick={() => updateRunwayDays(Math.min(60, effectiveRunway + 1))}
                disabled={effectiveRunway >= 60}
                className="w-7 h-7 rounded-md border border-border bg-white text-slate-700 flex items-center justify-center text-base font-bold hover:border-primary/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >+</button>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <button
              type="button"
              onClick={() => persist({ ...settings, slaConfig: DEFAULT_SLA_CONFIG })}
              className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-reset-sla"
            >
              <RotateCcw size={12} />
              Reset response time targets to defaults
            </button>
          </div>
        </div>
      </section>

      {/* Dismissed catch-up items — audit log */}
      <DismissedBacklogSection />
    </div>
  );
}

// ============================================================================
// Dismissed backlog section
// ============================================================================

const PAGE_SIZE = 20;

type ReasonGroup = 'all' | 'rule' | 'ai' | 'manual';

const REASON_LABEL: Record<DismissReason, string> = {
  'rule:thread_replied':    'Already replied',
  'rule:calendar_expired':  'Calendar expired',
  'rule:bulk_mail':         'Bulk mail',
  'rule:auto_reply':        'Auto-reply',
  'rule:system_generated':  'System message',
  'rule:non_inbox_folder':  'Not in inbox',
  'ai:expired':             'AI: outdated',
  'ai:noise':               'AI: noise',
  'manual':                 'Manually dismissed',
};

const REASON_BADGE: Record<DismissReason, string> = {
  'rule:thread_replied':    'bg-teal-50 text-teal-700 border-teal-200',
  'rule:calendar_expired':  'bg-slate-100 text-slate-600 border-slate-200',
  'rule:bulk_mail':         'bg-orange-50 text-orange-700 border-orange-200',
  'rule:auto_reply':        'bg-slate-100 text-slate-600 border-slate-200',
  'rule:system_generated':  'bg-slate-100 text-slate-600 border-slate-200',
  'rule:non_inbox_folder':  'bg-slate-100 text-slate-600 border-slate-200',
  'ai:expired':             'bg-indigo-50 text-indigo-700 border-indigo-200',
  'ai:noise':               'bg-indigo-50 text-indigo-700 border-indigo-200',
  'manual':                 'bg-blue-50 text-blue-700 border-blue-200',
};

function reasonGroup(r: DismissReason): ReasonGroup {
  if (r.startsWith('rule:')) return 'rule';
  if (r.startsWith('ai:'))   return 'ai';
  return 'manual';
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function DismissedRow({ item, onRestore }: { item: DismissedBacklogItem; onRestore: () => void }) {
  const isRestored = Boolean(item.restoredAt);
  const receivedDate = fmtDate(item.receivedAt);
  const dismissedDate = fmtDate(item.dismissedAt);

  return (
    <div
      className={cn(
        'flex items-start gap-3 px-5 py-3 border-b border-border/40 last:border-0',
        isRestored && 'opacity-50',
      )}
      data-testid={`dismissed-row-${item.id}`}
    >
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className={cn('text-xs font-semibold leading-snug', isRestored && 'line-through')}>
          {item.subject}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {item.senderName}
          {item.senderAddress ? ` · ${item.senderAddress}` : ''}
        </p>
        <div className="flex items-center gap-2 pt-0.5 flex-wrap">
          <span
            className={cn(
              'text-[9px] font-bold px-1.5 py-0.5 rounded-full border uppercase tracking-wide',
              REASON_BADGE[item.dismissReason],
            )}
          >
            {REASON_LABEL[item.dismissReason]}
          </span>
          <span className="text-[10px] text-muted-foreground">
            Received {receivedDate} · Dismissed {dismissedDate}
          </span>
          {isRestored && (
            <span className="text-[10px] text-muted-foreground italic">
              Restored {fmtDate(item.restoredAt!)}
            </span>
          )}
        </div>
      </div>
      {!isRestored && (
        <button
          type="button"
          onClick={onRestore}
          className="flex-shrink-0 flex items-center gap-1 text-[10px] font-bold text-primary border border-primary/30 bg-white px-2.5 py-1.5 rounded-lg hover:bg-primary/8 transition-colors"
          data-testid={`button-restore-${item.id}`}
          title="Restore to catch-up queue"
        >
          <CornerUpLeft size={10} /> Restore
        </button>
      )}
    </div>
  );
}

function DismissedBacklogSection() {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<ReasonGroup>('all');
  const [page, setPage] = useState(0);
  const [confirmErase, setConfirmErase] = useState(false);

  // Lazy: useDismissedBacklogItems only hydrates when the first subscriber
  // mounts. Keeping this component inside the settings tab means it only
  // fetches when the clinician opens Settings.
  const dismissed = useDismissedBacklogItems();

  const filtered = dismissed.filter(
    (d) => group === 'all' || reasonGroup(d.dismissReason) === group,
  );
  const total = dismissed.length;
  const restoredCount = dismissed.filter((d) => d.restoredAt).length;
  const pageItems = filtered.slice(0, (page + 1) * PAGE_SIZE);
  const hasMore = pageItems.length < filtered.length;

  const groupCounts: Record<ReasonGroup, number> = {
    all:    dismissed.length,
    rule:   dismissed.filter((d) => reasonGroup(d.dismissReason) === 'rule').length,
    ai:     dismissed.filter((d) => reasonGroup(d.dismissReason) === 'ai').length,
    manual: dismissed.filter((d) => reasonGroup(d.dismissReason) === 'manual').length,
  };

  function handleErase() {
    clearDismissedHistory();
    setConfirmErase(false);
    setPage(0);
  }

  return (
    <section
      className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden"
      data-testid="section-dismissed-backlog"
    >
      {/* Collapsible header */}
      <button
        type="button"
        className="w-full px-5 py-4 flex items-center gap-3 hover:bg-slate-50/50 transition-colors text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="button-toggle-dismissed"
      >
        <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <RefreshCcw size={15} className="text-indigo-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground">
            Catch-up backlog — dismissed items
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {total === 0
              ? 'No dismissed items yet. Run a catch-up scan to populate this log.'
              : `${total} item${total !== 1 ? 's' : ''} dismissed${restoredCount > 0 ? `, ${restoredCount} restored` : ''} — audit trail of what was skipped and why.`}
          </p>
        </div>
        {open
          ? <ChevronUp size={16} className="text-muted-foreground flex-shrink-0" />
          : <ChevronDown size={16} className="text-muted-foreground flex-shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-border">
          {total === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              <RefreshCcw size={28} className="mx-auto mb-3 text-muted-foreground/30" />
              <p className="font-semibold">No dismissed items yet.</p>
              <p className="text-xs mt-1">
                After running a catch-up scan, emails filtered by rules or dismissed manually
                will appear here with their reason.
              </p>
            </div>
          ) : (
            <>
              {/* Toolbar — filter tabs + erase button */}
              <div className="px-5 py-3 flex items-center justify-between gap-3 border-b border-border/60 flex-wrap">
                <div className="flex items-center gap-1">
                  {((['all', 'rule', 'ai', 'manual'] as ReasonGroup[])).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => { setGroup(g); setPage(0); }}
                      className={cn(
                        'px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors capitalize',
                        group === g
                          ? 'bg-primary text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                      )}
                      data-testid={`filter-${g}`}
                    >
                      {g === 'all' ? 'All' : g === 'rule' ? 'Rule-based' : g === 'ai' ? 'AI' : 'Manual'}
                      {' '}
                      <span className="opacity-70">({groupCounts[g]})</span>
                    </button>
                  ))}
                </div>

                {confirmErase ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-red-700">
                      Delete all {total} records?
                    </span>
                    <button
                      type="button"
                      onClick={handleErase}
                      className="text-[10px] font-bold text-white bg-red-600 px-2.5 py-1 rounded-lg hover:bg-red-700 transition-colors"
                      data-testid="button-erase-confirm"
                    >
                      Yes, erase
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmErase(false)}
                      className="text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmErase(true)}
                    className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground hover:text-destructive transition-colors"
                    data-testid="button-erase-history"
                    title="Erase all dismissed item history (GDPR right to erase)"
                  >
                    <Trash2 size={11} />
                    Erase all history
                  </button>
                )}
              </div>

              {/* GDPR note */}
              <div className="px-5 py-2 flex items-start gap-1.5 bg-slate-50/60 border-b border-border/40">
                <AlertTriangle size={11} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-[10px] text-muted-foreground leading-snug">
                  This log records why each email was not surfaced to you.
                  No email body content is stored — only subject, sender, date, and dismiss reason.
                  Use "Erase all history" to exercise your right to erasure under UK GDPR.
                </p>
              </div>

              {/* List */}
              <div className="divide-y-0">
                {filtered.length === 0 ? (
                  <p className="px-5 py-6 text-xs text-muted-foreground text-center italic">
                    No items in this category.
                  </p>
                ) : (
                  pageItems.map((item) => (
                    <DismissedRow
                      key={item.id}
                      item={item}
                      onRestore={() => restoreBacklogItem(item.id)}
                    />
                  ))
                )}
              </div>

              {/* Pagination footer */}
              {(hasMore || filtered.length > PAGE_SIZE) && (
                <div className="px-5 py-3 border-t border-border/40 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    Showing {pageItems.length} of {filtered.length}
                  </span>
                  {hasMore && (
                    <button
                      type="button"
                      onClick={() => setPage((p) => p + 1)}
                      className="text-[10px] font-semibold text-primary hover:underline transition-colors"
                      data-testid="button-show-more-dismissed"
                    >
                      Show {Math.min(PAGE_SIZE, filtered.length - pageItems.length)} more
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// Shared sub-components
// ============================================================================

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="sm:max-w-sm">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <div className="sm:flex-shrink-0">{children}</div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onToggle,
  testId,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onToggle: () => void;
  testId?: string;
}) {
  return (
    <div className="px-5 py-4 flex items-center justify-between gap-4">
      <div className="max-w-md">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        data-testid={testId}
        className={cn(
          'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30',
          checked ? 'bg-primary' : 'bg-slate-300',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}
