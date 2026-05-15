import { useSyncExternalStore } from 'react';
import {
  getClinicianSettings,
  upsertClinicianSettings,
} from '@workspace/api-client-react';
import {
  DEFAULT_ARRIVAL_CONFIG,
  type ArrivalConfig,
} from './planner';
import {
  RECIPIENT_TYPES,
  type RecipientType,
} from './recipientTypes';
import {
  type StyleProfile,
  type StyleProfileSection,
  DEFAULT_TONE_PROFILES,
  DEFAULT_OVERALL,
} from './styleProfileTypes';

// Single hydration point for the three clinician-wide settings
// (arrivals planner inputs, writing-style profile, AI-reply
// signatures). They share one Postgres row and one GET, so it's
// wasteful to hydrate three independent caches.
//
// Storage rule: every value here is the clinician's own
// organisational layer (planner thresholds, prompt-tuning text,
// sign-offs they author). No correspondence is stored.
//
// Hydration model is hydrate-once + fire-and-forget, mirroring the
// other stores. The first subscriber (or first synchronous reader)
// triggers the GET; in-memory writes are reflected immediately and
// the POST runs in the background. Failures are logged, not
// surfaced — these are advisory features, not safety-critical.

export interface SignaturesSettings {
  default: string;
  perRecipient: Partial<Record<RecipientType, string>>;
}

// AppSettings — profile/identity, weekly planner defaults, and
// notification preferences. Bundled because they're all written
// together from the Settings page and previously shared one
// localStorage key. Storage rule: identity strings the clinician
// types about themselves and their preferences; nothing about
// patients or their messages.
export type WeeklyDay = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
export const WEEKLY_DAYS: readonly WeeklyDay[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export interface AppSettings {
  profile: {
    fullName: string;
    role: string;
    email: string;
    serviceName: string;
  };
  weeklyDefaults: {
    hoursPerWeek: number;
    days: WeeklyDay[];
    sessionLengthMin: number;
  };
  notifications: {
    highRiskAlerts: boolean;
    dailyDigest: boolean;
    weeklySummary: boolean;
    draftReady: boolean;
    desktopSound: boolean;
  };
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
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
};

interface Cache {
  arrivalsConfig: ArrivalConfig | null;
  styleProfile: StyleProfile | null;
  signaturesSettings: SignaturesSettings | null;
  appSettings: AppSettings | null;
}

const DEFAULT_SIGNATURE =
  'Kind regards,\nDr. Sam Patel\nConsultant Clinical Psychologist\nNorth CAMHS Team';

// Back-fill missing sub-sections so consumers can read any field
// directly without null-checking. Mirrors how the old localStorage
// loader spread DEFAULT_SETTINGS.* over the parsed value.
function normaliseAppSettings(s: Partial<AppSettings>): AppSettings {
  return {
    profile: { ...DEFAULT_APP_SETTINGS.profile, ...(s.profile ?? {}) },
    weeklyDefaults: {
      ...DEFAULT_APP_SETTINGS.weeklyDefaults,
      ...(s.weeklyDefaults ?? {}),
    },
    notifications: {
      ...DEFAULT_APP_SETTINGS.notifications,
      ...(s.notifications ?? {}),
    },
  };
}

function buildDefaultStyleProfile(): StyleProfile {
  const sections: Partial<Record<RecipientType, StyleProfileSection>> = {};
  for (const type of RECIPIENT_TYPES) {
    sections[type] = { ...DEFAULT_TONE_PROFILES[type] };
  }
  return { overall: DEFAULT_OVERALL, sections, builtAt: 0 };
}

const listeners = new Set<() => void>();
let cache: Cache = {
  arrivalsConfig: null,
  styleProfile: null,
  signaturesSettings: null,
  appSettings: null,
};
let hydrationStarted = false;
let hydrationDone = false;

function emit() {
  // Replace the cache object so useSyncExternalStore's referential
  // equality check fires for any selector consumers.
  cache = { ...cache };
  listeners.forEach((l) => l());
}

// One-time migration: if the server has no row yet and the old
// localStorage key from before this column existed is present,
// import it, persist it, and clear the legacy key. Runs at most
// once per browser. Pure best-effort — failures are silent so a
// fresh user never sees an error from a key that wasn't there.
function migrateLegacyAppSettings(): AppSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('clinadmin-settings');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const migrated = normaliseAppSettings(parsed as Partial<AppSettings>);
    localStorage.removeItem('clinadmin-settings');
    return migrated;
  } catch {
    return null;
  }
}

async function hydrate(): Promise<void> {
  if (hydrationStarted) return;
  hydrationStarted = true;
  try {
    const remote = await getClinicianSettings();
    // Local writes that happened before hydration completed take
    // priority — the user's clicks are more recent than whatever
    // the GET returned. Same merge rule as the other stores.
    // Generated types are open `{[k]:unknown}` (additionalProperties:true);
    // the inner shape is owned by the client so cast through unknown.
    if (cache.arrivalsConfig === null && remote.arrivalsConfig) {
      cache.arrivalsConfig = remote.arrivalsConfig as unknown as ArrivalConfig;
    }
    if (cache.styleProfile === null && remote.styleProfile) {
      cache.styleProfile = normaliseStyleProfile(
        remote.styleProfile as unknown as StyleProfile,
      );
    }
    if (cache.signaturesSettings === null && remote.signaturesSettings) {
      cache.signaturesSettings =
        remote.signaturesSettings as unknown as SignaturesSettings;
    }
    if (cache.appSettings === null && remote.appSettings) {
      cache.appSettings = normaliseAppSettings(
        remote.appSettings as unknown as Partial<AppSettings>,
      );
    } else if (cache.appSettings === null && !remote.appSettings) {
      // Server has nothing for this clinician yet — try to recover
      // settings from the pre-migration localStorage key so users
      // who configured the app before this column existed don't
      // see their preferences silently reset.
      const legacy = migrateLegacyAppSettings();
      if (legacy) {
        cache.appSettings = legacy;
        persist({ appSettings: legacy });
      }
    }
    hydrationDone = true;
    emit();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[clinicianSettings] failed to hydrate from server', err);
    hydrationDone = true;
  }
}

// Back-fill any missing per-recipient sections with the built-in
// defaults so consumers never have to null-check section access.
// Same shape the old localStorage loader produced.
function normaliseStyleProfile(profile: StyleProfile): StyleProfile {
  const sections: Partial<Record<RecipientType, StyleProfileSection>> = {
    ...profile.sections,
  };
  for (const type of RECIPIENT_TYPES) {
    if (!sections[type]) sections[type] = { ...DEFAULT_TONE_PROFILES[type] };
  }
  return { ...profile, sections };
}

// Synchronous-read entry point: fires hydration on first call but
// never blocks. Callers (draftPrompts, etc.) get the default until
// hydration finishes; this matches the previous localStorage
// behaviour where a fresh browser also returned defaults.
function ensureHydrationStarted() {
  if (!hydrationStarted) void hydrate();
}

// Serialise outgoing writes so the server sees them in the same
// order the user made them. Without this, two POSTs fired close
// together can arrive out of order at Postgres (because each is
// an independent HTTP round-trip), and a stale earlier patch can
// overwrite a newer one. We keep one promise tail and chain every
// new write onto it; failures don't break the chain.
let writeChain: Promise<unknown> = Promise.resolve();

function persist(patch: {
  arrivalsConfig?: ArrivalConfig | null;
  styleProfile?: StyleProfile | null;
  signaturesSettings?: SignaturesSettings | null;
  appSettings?: AppSettings | null;
}) {
  // Same cast through unknown as on the way in: generated input
  // type is open `{[k]:unknown}` and our typed values satisfy it.
  writeChain = writeChain.then(() =>
    upsertClinicianSettings(patch as unknown as Parameters<typeof upsertClinicianSettings>[0]).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[clinicianSettings] failed to persist patch', err);
    }),
  );
}

// ---- Arrivals ----------------------------------------------------------

export function getArrivalsConfig(): ArrivalConfig {
  ensureHydrationStarted();
  return cache.arrivalsConfig ?? { ...DEFAULT_ARRIVAL_CONFIG };
}

export function setArrivalsConfigInternal(next: ArrivalConfig) {
  cache.arrivalsConfig = { ...next };
  emit();
  persist({ arrivalsConfig: cache.arrivalsConfig });
}

export function resetArrivalsConfigInternal() {
  cache.arrivalsConfig = { ...DEFAULT_ARRIVAL_CONFIG };
  emit();
  persist({ arrivalsConfig: cache.arrivalsConfig });
}

// ---- Style profile -----------------------------------------------------

export function getStyleProfile(): StyleProfile {
  ensureHydrationStarted();
  return cache.styleProfile ?? buildDefaultStyleProfile();
}

export function setStyleProfileInternal(next: StyleProfile) {
  cache.styleProfile = normaliseStyleProfile(next);
  emit();
  persist({ styleProfile: cache.styleProfile });
}

export function clearStyleProfileInternal() {
  cache.styleProfile = null;
  emit();
  persist({ styleProfile: null });
}

// ---- Signatures --------------------------------------------------------

export function getSignaturesSettings(): SignaturesSettings {
  ensureHydrationStarted();
  return cache.signaturesSettings ?? { default: DEFAULT_SIGNATURE, perRecipient: {} };
}

export function setSignaturesSettingsInternal(next: SignaturesSettings) {
  cache.signaturesSettings = { ...next, perRecipient: { ...next.perRecipient } };
  emit();
  persist({ signaturesSettings: cache.signaturesSettings });
}

// ---- App settings (profile / weeklyDefaults / notifications) -----------

export function getAppSettings(): AppSettings {
  ensureHydrationStarted();
  return cache.appSettings ?? DEFAULT_APP_SETTINGS;
}

export function setAppSettingsInternal(next: AppSettings) {
  cache.appSettings = normaliseAppSettings(next);
  emit();
  persist({ appSettings: cache.appSettings });
}

export function resetAppSettingsInternal() {
  cache.appSettings = DEFAULT_APP_SETTINGS;
  emit();
  persist({ appSettings: cache.appSettings });
}

// ---- React glue --------------------------------------------------------

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (!hydrationStarted) void hydrate();
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => cache;
const getServerSnapshot = () => cache;

// Fires hydration on first mount in the React tree. Place once in
// the app root so synchronous prompt builders see hydrated data
// well before the user clicks "Generate".
export function useClinicianSettingsHydration(): void {
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useArrivalsConfigCache(): ArrivalConfig {
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return getArrivalsConfig();
}

export function useStyleProfileCache(): StyleProfile {
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return getStyleProfile();
}

export function useSignaturesSettingsCache(): SignaturesSettings {
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return getSignaturesSettings();
}

export function useAppSettingsCache(): AppSettings {
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return getAppSettings();
}

export function isHydrated(): boolean {
  return hydrationDone;
}

// Test-only: wipe the cache and reset hydration so the next mount
// re-fetches. Does NOT touch the server.
export function _resetForTests() {
  cache = {
    arrivalsConfig: null,
    styleProfile: null,
    signaturesSettings: null,
    appSettings: null,
  };
  hydrationStarted = false;
  hydrationDone = false;
  listeners.forEach((l) => l());
}
