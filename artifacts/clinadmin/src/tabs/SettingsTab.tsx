import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, User, Calendar, Bell, PenLine, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'clinadmin-settings';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
type Day = typeof DAYS[number];

export interface ClinAdminSettings {
  profile: {
    fullName: string;
    role: string;
    email: string;
    serviceName: string;
  };
  weeklyDefaults: {
    hoursPerWeek: number;
    days: Day[];
    sessionLengthMin: number;
  };
  notifications: {
    highRiskAlerts: boolean;
    dailyDigest: boolean;
    weeklySummary: boolean;
    draftReady: boolean;
    desktopSound: boolean;
  };
  signature: string;
}

const DEFAULT_SETTINGS: ClinAdminSettings = {
  profile: {
    fullName: 'Dr. Sam Patel',
    role: 'Consultant Clinical Psychologist',
    email: 'sam.patel@nhs.example',
    serviceName: 'North CAMHS Team',
  },
  weeklyDefaults: {
    hoursPerWeek: 6,
    days: ['Tue', 'Thu'],
    sessionLengthMin: 90,
  },
  notifications: {
    highRiskAlerts: true,
    dailyDigest: true,
    weeklySummary: false,
    draftReady: true,
    desktopSound: false,
  },
  signature:
    'Kind regards,\nDr. Sam Patel\nConsultant Clinical Psychologist\nNorth CAMHS Team',
};

function loadSettings(): ClinAdminSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      profile: { ...DEFAULT_SETTINGS.profile, ...(parsed.profile ?? {}) },
      weeklyDefaults: { ...DEFAULT_SETTINGS.weeklyDefaults, ...(parsed.weeklyDefaults ?? {}) },
      notifications: { ...DEFAULT_SETTINGS.notifications, ...(parsed.notifications ?? {}) },
      signature: typeof parsed.signature === 'string' ? parsed.signature : DEFAULT_SETTINGS.signature,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function SettingsTab() {
  const [settings, setSettings] = useState<ClinAdminSettings>(DEFAULT_SETTINGS);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  useEffect(() => {
    if (!showSaved) return;
    const t = setTimeout(() => setShowSaved(false), 2500);
    return () => clearTimeout(t);
  }, [showSaved]);

  const persist = (next: ClinAdminSettings) => {
    setSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setShowSaved(true);
    } catch {
      // ignore
    }
  };

  const updateProfile = <K extends keyof ClinAdminSettings['profile']>(key: K, value: ClinAdminSettings['profile'][K]) => {
    persist({ ...settings, profile: { ...settings.profile, [key]: value } });
  };

  const updateWeekly = <K extends keyof ClinAdminSettings['weeklyDefaults']>(key: K, value: ClinAdminSettings['weeklyDefaults'][K]) => {
    persist({ ...settings, weeklyDefaults: { ...settings.weeklyDefaults, [key]: value } });
  };

  const toggleDay = (day: Day) => {
    const has = settings.weeklyDefaults.days.includes(day);
    const next = has
      ? settings.weeklyDefaults.days.filter(d => d !== day)
      : [...settings.weeklyDefaults.days, day].sort(
          (a, b) => DAYS.indexOf(a) - DAYS.indexOf(b),
        );
    updateWeekly('days', next);
  };

  const toggleNotification = (key: keyof ClinAdminSettings['notifications']) => {
    persist({
      ...settings,
      notifications: { ...settings.notifications, [key]: !settings.notifications[key] },
    });
  };

  const updateSignature = (value: string) => {
    persist({ ...settings, signature: value });
  };

  const resetDefaults = () => {
    persist(DEFAULT_SETTINGS);
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
          <h2 className="text-sm font-bold text-foreground">Email signature</h2>
        </header>
        <div className="p-5 space-y-3">
          <p className="text-xs text-muted-foreground">
            Appended to the bottom of every AI-drafted reply. Plain text only.
          </p>
          <textarea
            value={settings.signature}
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
              {settings.signature || '(no signature set)'}
            </pre>
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
