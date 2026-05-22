// inboxPreFilter.ts
//
// Rule-based pre-filter for the start-mode inbox catch-up scan.
//
// When a new clinician connects Outlook with an existing inbox, we scan
// a configurable window (1-6 months, default 3) and run EVERY candidate
// email through this filter BEFORE sending anything to the AI. The goal
// is to eliminate obvious noise cheaply so the AI relevance pass only
// sees emails that could plausibly still be open.
//
// Design constraints:
//   · Pure function — no side effects, no network calls. Same input → same
//     output. Fully unit-testable without mocks.
//   · Header-based only — the filter works on metadata the Outlook Graph
//     API returns in a $select=... call (no body required, keeping the
//     initial fetch cheap and avoiding body content in the filter layer).
//   · Conservative — when in doubt, let the email through. A false
//     positive surfaced to the clinician is better than a false negative
//     that silently swallows a missed referral.
//
// Usage:
//   const decision = applyPreFilter(msg, new Date());
//   if (!decision.pass) {
//     recordDismissed(msg, decision.rule);
//   } else {
//     addToBacklogQueue(msg);
//   }

// ============================================================================
// Types
// ============================================================================

/** The metadata fields we request from Graph for each message.
 *  Using a separate type (not the app's internal Email) because this
 *  is raw Graph data before any normalisation. */
export interface OutlookMessageMeta {
  /** Graph message id — reference back to the original email. */
  id: string;
  subject: string;
  /** ISO datetime, e.g. "2026-02-14T10:30:00Z". */
  receivedAt: string;
  /** Thread / conversation id. Used to suppress duplicate thread entries. */
  conversationId: string;
  /** Which folder the message lives in. Coerced from Graph's parentFolderId
   *  by the caller using well-known folder names. */
  parentFolderKind: OutlookFolderKind;
  senderAddress: string;
  senderName: string;
  isRead: boolean;
  isDraft: boolean;
  /** True when the message is a calendar meeting request. */
  isMeetingRequest: boolean;
  /** ISO date of the calendar event, if isMeetingRequest. Null otherwise. */
  eventDate: string | null;
  // Thread-level info, resolved by the caller before calling the filter.
  // The caller walks the thread's sent-items to see if the clinician has
  // ever replied to a message in this thread after the last incoming message.
  /** True when the clinician has a sent-item in the thread after the most
   *  recent incoming message — the strongest "this is closed" signal. */
  threadHasClinicianReply: boolean;
  // Email headers. The Graph API returns these as internetMessageHeaders[].
  // The caller should normalise header names to lowercase and collapse
  // multi-value headers into a single string.
  /** Value of the List-ID header, or null if absent. Presence = mailing list. */
  listId: string | null;
  /** Value of the Precedence header. 'bulk' or 'list' = mass mailing. */
  precedence: string | null;
  /** True when any X-Mailchimp-*, X-CampaignMonitor-*, or similar mass-
   *  mailing tool header is present. */
  hasMailingListHeaders: boolean;
  /** Value of the Auto-Submitted header. Non-'no' value = auto-generated. */
  autoSubmitted: string | null;
  /** True when X-Autoreply, X-Auto-Response-Suppress, or similar is set. */
  hasAutoReplyHeaders: boolean;
}

export type OutlookFolderKind =
  | 'inbox'
  | 'sent'
  | 'deleted'
  | 'junk'
  | 'archive'
  | 'drafts'
  | 'other';

/** Why an email was filtered out. Maps 1:1 to DismissReason in the DB
 *  schema — the 'rule:' prefix distinguishes rule-based dismissals from
 *  AI-based ones recorded later by the relevance pass. */
export type PreFilterRule =
  | 'rule:thread_replied'       // clinician already replied in thread
  | 'rule:calendar_expired'     // meeting invite with a past event date
  | 'rule:bulk_mail'            // List-ID / Precedence / mailing-list headers
  | 'rule:auto_reply'           // Auto-Submitted / X-Autoreply headers
  | 'rule:system_generated'     // MAILER-DAEMON sender, delivery receipt subject
  | 'rule:non_inbox_folder';    // email is in Sent/Deleted/Junk/Archive/Drafts

export type PreFilterDecision =
  | { pass: true }
  | { pass: false; rule: PreFilterRule; reason: string };

// ============================================================================
// Rule implementations (each returns a PreFilterDecision)
// ============================================================================

/**
 * Rule 1 — clinician already replied in this thread.
 *
 * The strongest signal that an email is closed. We check thread-level
 * (not message-level) because what matters is whether the clinician
 * responded to ANYONE in the thread, not whether they replied to this
 * specific message. The caller resolves this by walking the thread's
 * sent folder before calling us.
 *
 * Note: this was previously combined with "read + 60 days" but that
 * heuristic was removed because clinicians frequently open emails
 * without replying. Thread reply is the only reliable signal here.
 */
function checkThreadReplied(msg: OutlookMessageMeta): PreFilterDecision {
  if (!msg.threadHasClinicianReply) return { pass: true };
  return {
    pass: false,
    rule: 'rule:thread_replied',
    reason: 'Clinician has already replied in this thread.',
  };
}

/**
 * Rule 2 — calendar invite with a past event date.
 *
 * Meeting requests / calendar invites for events that have already
 * happened are never actionable. We only apply this when isMeetingRequest
 * is true AND eventDate is in the past — we do NOT apply it to regular
 * emails that mention a date, because those might still be open.
 */
function checkCalendarExpired(
  msg: OutlookMessageMeta,
  today: Date,
): PreFilterDecision {
  if (!msg.isMeetingRequest || !msg.eventDate) return { pass: true };
  // Compare at day granularity (UTC midnight) so an event on today's date
  // is NOT treated as expired — it might still be happening.
  const eventDayMs = new Date(msg.eventDate.slice(0, 10) + 'T00:00:00Z').getTime();
  const todayDayMs = new Date(today.toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  if (eventDayMs >= todayDayMs) return { pass: true }; // today or future — keep
  return {
    pass: false,
    rule: 'rule:calendar_expired',
    reason: `Calendar invite for a past event (${msg.eventDate}).`,
  };
}

/**
 * Rule 3 — bulk mail / mailing list.
 *
 * RFC 2919 (List-ID) and RFC 2076 (Precedence) are the standards for
 * mailing lists. X-Mailchimp and similar are mass-mailing tool headers.
 * Any combination of these signals = bulk mail.
 */
function checkBulkMail(msg: OutlookMessageMeta): PreFilterDecision {
  if (msg.listId) {
    return {
      pass: false,
      rule: 'rule:bulk_mail',
      reason: `Mailing list email (List-ID: ${msg.listId}).`,
    };
  }
  const prec = (msg.precedence ?? '').toLowerCase().trim();
  if (prec === 'bulk' || prec === 'list') {
    return {
      pass: false,
      rule: 'rule:bulk_mail',
      reason: `Bulk mail (Precedence: ${msg.precedence}).`,
    };
  }
  if (msg.hasMailingListHeaders) {
    return {
      pass: false,
      rule: 'rule:bulk_mail',
      reason: 'Mailing-list tool headers detected (Mailchimp / Campaign Monitor / similar).',
    };
  }
  return { pass: true };
}

/**
 * Rule 4 — auto-reply / out-of-office.
 *
 * Auto-Submitted: auto-replied (RFC 3834) is the standard header.
 * X-Autoreply and X-Auto-Response-Suppress are common non-standard
 * variants. Subject-line patterns cover systems that don't set headers.
 */

// Common auto-reply subject patterns (case-insensitive prefix match).
const AUTO_REPLY_SUBJECT_PREFIXES: RegExp[] = [
  /^out of office/i,
  /^automatic reply/i,
  /^auto(matic)? response/i,
  /^autoreply/i,
  /^absence/i,
  /^away from the office/i,
];

function checkAutoReply(msg: OutlookMessageMeta): PreFilterDecision {
  // RFC 3834 Auto-Submitted header. Values other than 'no' indicate automation.
  const autoSubmitted = (msg.autoSubmitted ?? '').toLowerCase().trim();
  if (autoSubmitted && autoSubmitted !== 'no') {
    return {
      pass: false,
      rule: 'rule:auto_reply',
      reason: `Auto-generated message (Auto-Submitted: ${msg.autoSubmitted}).`,
    };
  }
  if (msg.hasAutoReplyHeaders) {
    return {
      pass: false,
      rule: 'rule:auto_reply',
      reason: 'Auto-reply headers detected (X-Autoreply / X-Auto-Response-Suppress).',
    };
  }
  // Subject-line fallback for systems that don't set headers.
  const subject = msg.subject.trim();
  for (const pattern of AUTO_REPLY_SUBJECT_PREFIXES) {
    if (pattern.test(subject)) {
      return {
        pass: false,
        rule: 'rule:auto_reply',
        reason: `Auto-reply detected via subject pattern ("${subject}").`,
      };
    }
  }
  return { pass: true };
}

/**
 * Rule 5 — system-generated email (MAILER-DAEMON, delivery receipts, NDRs).
 *
 * These are infrastructure messages that are never actionable for a
 * clinician. We detect them via sender address patterns and subject lines.
 */

// Sender addresses that are always system-generated.
const SYSTEM_SENDER_PATTERNS: RegExp[] = [
  /^mailer-daemon@/i,
  /^postmaster@/i,
  /^noreply@/i,
  /^no-reply@/i,
  /^donotreply@/i,
  /^do-not-reply@/i,
  /^mail-daemon@/i,
  /^bounce@/i,
  /^bounces@/i,
];

// Subject prefixes that indicate delivery infrastructure messages.
const SYSTEM_SUBJECT_PREFIXES: RegExp[] = [
  /^delivery status notification/i,
  /^undeliverable/i,
  /^mail delivery failed/i,
  /^failure notice/i,
  /^read receipt/i,
  /^delivery receipt/i,
  /^non-delivery report/i,
];

function checkSystemGenerated(msg: OutlookMessageMeta): PreFilterDecision {
  for (const pattern of SYSTEM_SENDER_PATTERNS) {
    if (pattern.test(msg.senderAddress)) {
      return {
        pass: false,
        rule: 'rule:system_generated',
        reason: `System sender address (${msg.senderAddress}).`,
      };
    }
  }
  const subject = msg.subject.trim();
  for (const pattern of SYSTEM_SUBJECT_PREFIXES) {
    if (pattern.test(subject)) {
      return {
        pass: false,
        rule: 'rule:system_generated',
        reason: `System message subject pattern ("${subject}").`,
      };
    }
  }
  return { pass: true };
}

/**
 * Rule 6 — email not in the Inbox.
 *
 * Emails in Sent, Deleted, Junk, Archive, or Drafts are already handled
 * by definition. Sent = the clinician wrote it. Deleted = consciously
 * removed. Junk = filtered as spam. Archive = explicitly put away.
 * Drafts = in progress or abandoned.
 *
 * We keep items in 'other' folders in scope — custom folders may be
 * legitimate clinical subfolders (e.g. "Referrals", "Urgent") that a
 * clinician has set up, and we don't want to silently drop those.
 */
function checkNonInboxFolder(msg: OutlookMessageMeta): PreFilterDecision {
  const NON_INBOX: OutlookFolderKind[] = ['sent', 'deleted', 'junk', 'archive', 'drafts'];
  if (NON_INBOX.includes(msg.parentFolderKind)) {
    return {
      pass: false,
      rule: 'rule:non_inbox_folder',
      reason: `Email is in the ${msg.parentFolderKind} folder.`,
    };
  }
  return { pass: true };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Apply all pre-filter rules to a single Outlook message.
 *
 * Rules are checked in priority order: the FIRST matching rule returns
 * immediately. This keeps the reason specific (thread replied is more
 * informative than bulk mail, even if both apply).
 *
 * Returns `{ pass: true }` if the email should proceed to the AI
 * relevance pass (or be added to the backlog directly if AI is skipped).
 * Returns `{ pass: false, rule, reason }` if the email should be
 * recorded in dismissed_backlog_items.
 *
 * @param msg   Normalised Outlook message metadata.
 * @param today The current date — used for calendar expiry checks.
 *              Passed in so tests are deterministic without clock mocking.
 */
export function applyPreFilter(
  msg: OutlookMessageMeta,
  today: Date,
): PreFilterDecision {
  // Drafts and sent items are handled in the folder check, but also skip
  // them early here in case the folder kind wasn't correctly resolved.
  if (msg.isDraft) {
    return {
      pass: false,
      rule: 'rule:non_inbox_folder',
      reason: 'Email is a draft.',
    };
  }

  const checks: Array<() => PreFilterDecision> = [
    () => checkNonInboxFolder(msg),         // cheapest structural check first
    () => checkThreadReplied(msg),           // strongest "closed" signal
    () => checkSystemGenerated(msg),         // MAILER-DAEMON, NDR
    () => checkAutoReply(msg),               // OOO, auto-replies
    () => checkBulkMail(msg),               // mailing lists
    () => checkCalendarExpired(msg, today),  // past calendar invites
  ];

  for (const check of checks) {
    const result = check();
    if (!result.pass) return result;
  }

  return { pass: true };
}

/**
 * Estimate a priority score (0–100) for a message that has passed
 * the pre-filter. Higher = surface earlier in the backlog queue.
 *
 * This is intentionally simple and deterministic — it runs before
 * the AI relevance pass. The AI pass can update the score later
 * based on clinical content.
 *
 * Scoring:
 *   · Recency: max 60 points. Emails < 30 days old get a linear
 *     decay from 60 → 0 over 30 days, so a 30-day-old email scores
 *     the same as a 90-day-old one (both get 0 recency points).
 *   · Unread: +20 points. Unread = clinician hasn't looked at it at all.
 *   · Has reply in thread (but not from clinician): +20 points. Someone
 *     else is waiting. This is different from threadHasClinicianReply —
 *     that flag would have caused a dismiss; this is for threads where
 *     another party replied but the clinician hasn't answered yet.
 *
 * @param msg     The message that passed the pre-filter.
 * @param today   Current date (passed in for testability).
 * @param threadHasOtherReply   True if anyone other than the clinician
 *                 replied after the initial email — signals urgency.
 */
export function estimatePriorityScore(
  msg: OutlookMessageMeta,
  today: Date,
  threadHasOtherReply: boolean,
): number {
  const MS_PER_DAY = 86_400_000;
  const RECENCY_WINDOW_DAYS = 30;
  const ageMs = today.getTime() - new Date(msg.receivedAt).getTime();
  const ageDays = Math.max(0, ageMs / MS_PER_DAY);
  const recencyScore = Math.max(
    0,
    Math.round(60 * (1 - ageDays / RECENCY_WINDOW_DAYS)),
  );
  const unreadScore = msg.isRead ? 0 : 20;
  const replyScore = threadHasOtherReply ? 20 : 0;
  return Math.min(100, recencyScore + unreadScore + replyScore);
}

/**
 * Coerce a Graph well-known folder name or display name to an
 * OutlookFolderKind. The caller should use this to normalise the
 * parentFolderDisplayName field before constructing OutlookMessageMeta.
 *
 * Graph well-known names: 'inbox', 'sentitems', 'deleteditems',
 * 'junkemail', 'archive', 'drafts'. Custom folders are 'other'.
 */
export function coerceFolderKind(
  displayNameOrWellKnown: string,
): OutlookFolderKind {
  const n = displayNameOrWellKnown.toLowerCase().replace(/\s+/g, '');
  if (n === 'inbox') return 'inbox';
  if (n === 'sentitems' || n === 'sent') return 'sent';
  if (n === 'deleteditems' || n === 'deleted') return 'deleted';
  if (n === 'junkemail' || n === 'junk' || n === 'spam') return 'junk';
  if (n === 'archive' || n === 'archiveditems') return 'archive';
  if (n === 'drafts') return 'drafts';
  return 'other';
}
