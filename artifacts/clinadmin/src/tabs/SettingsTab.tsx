import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, User, Calendar, Bell, PenLine, Check } from 'lucide-react';
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
  type WeeklyDay,
  WEEKLY_DAYS,
  DEFAULT_APP_SETTINGS,
  useAppSettingsCache,
  setAppSettingsInternal,
  resetAppSettingsInternal,
} from '@/lib/clinicianSettingsStore';

// Profile, weekly defaults, and notifications now live in the
// shared clinician-settings store (Postgres-backed, hydrate-once
// + fire-and-forget). This tab is the editor; WeeklySetupModal is
// the other reader. Signatures use the same store via
// useSignatures().
const DAYS = WEEKLY_DAYS;

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
    </div>
  );
}

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
