// Helpers for the mailto: handoff. We open the user's default mail
// client with To/Subject/Body pre-filled — they review and click Send
// in their own mail app, and the message goes out from their real
// mailbox. No OAuth, no API keys.
//
// Two practical caveats:
//   1. Our seed `from` field is often just a name like "Sasha Chenoweth
//      (parent)" with no actual email address. We do best-effort
//      extraction (look for `<addr@domain>` or a bare `addr@domain`)
//      and fall back to leaving To blank — most mail clients then
//      prompt the user.
//   2. mailto URLs have practical length limits (Outlook ~2000 chars).
//      Very long drafts may get truncated by the mail client. The Send
//      button always copies the body to the clipboard as a backstop so
//      the clinician can paste it manually if needed.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export function extractAddress(from: string): string {
  const m = from.match(EMAIL_RE);
  return m ? m[0] : '';
}

export function buildReplySubject(originalSubject: string): string {
  const trimmed = originalSubject.trim();
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

export interface MailtoArgs {
  to: string;
  subject: string;
  body: string;
}

export function buildMailtoUrl({ to, subject, body }: MailtoArgs): string {
  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  // URLSearchParams encodes spaces as '+', but mailto handlers expect
  // %20. Swap them so Outlook / Apple Mail render the body correctly.
  const qs = params.toString().replace(/\+/g, '%20');
  return `mailto:${encodeURIComponent(to)}${qs ? `?${qs}` : ''}`;
}
