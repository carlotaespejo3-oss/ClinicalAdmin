// Recipient-type vocabulary. Lives in its own module to break the
// signatures.ts <-> styleProfile.ts <-> clinicianSettingsStore.ts
// import cycle that would otherwise form.
export const RECIPIENT_TYPES = [
  'Admin Team',
  'Families',
  'Other Professionals',
  'Recurrent Families / Patients',
] as const;

export type RecipientType = typeof RECIPIENT_TYPES[number];
