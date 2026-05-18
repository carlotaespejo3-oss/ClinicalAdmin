import { useEffect, useMemo } from 'react';
import { X, Mail, Clock, ExternalLink } from 'lucide-react';
import { emails as seedEmails } from '@/lib/data';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  emailId: number | null;
  onClose: () => void;
  // Optional: takes the clinician straight to this email in the
  // full Inbox view (where reply, draft, archive, defer, etc. live).
  onOpenInInbox?: (emailId: number) => void;
}

// Quick-look modal for an email surfaced from My tasks. Shows the
// subject, sender, received date and body so the clinician can
// remember context without leaving Home. Reply / archive / defer
// stay in the Inbox — the "Open in Inbox" footer button gets them
// there in one tap.
//
// THREE-BUCKET RULE: the body is rendered at display time from the
// seed email list (today's stand-in for Microsoft Graph). Nothing
// here writes email content back to our DB; the modal is purely a
// read-through into the Outlook bucket. When this swaps to Graph,
// the lookup becomes a `getEmailById(id)` fetch and the rest of
// the modal is unchanged.
export default function EmailPreviewModal({
  open,
  emailId,
  onClose,
  onOpenInInbox,
}: Props) {
  const email = useMemo(() => {
    if (emailId === null) return null;
    return seedEmails.find((e) => e.id === emailId) ?? null;
  }, [emailId]);

  // Close on Escape — standard modal behaviour.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !email) return null;

  const fromLabel = email.from.split('<')[0]?.trim() || email.from;
  const fromAddress = (email.from.match(/<([^>]+)>/)?.[1] ?? '').trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-preview-title"
      data-testid="email-preview-modal"
    >
      <div
        className={cn(
          'bg-white rounded-2xl shadow-xl border border-border',
          'w-full max-w-[680px] max-h-full overflow-hidden flex flex-col',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---- Header ---- */}
        <div className="flex items-start gap-3 px-6 pt-5 pb-4 border-b border-border">
          <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
            <Mail size={16} className="text-blue-700" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              From {fromLabel}
              {fromAddress && (
                <span className="font-normal normal-case tracking-normal text-muted-foreground/80">
                  {' · '}
                  {fromAddress}
                </span>
              )}
            </p>
            <h2
              id="email-preview-title"
              className="text-base font-semibold text-foreground mt-1"
            >
              {email.subject}
            </h2>
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1">
              <Clock size={11} />
              <span>Received {email.date}</span>
              {email.cat && (
                <>
                  <span className="mx-1.5 text-border">·</span>
                  <span className="uppercase tracking-wider font-semibold">
                    {email.cat}
                  </span>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 rounded-md border border-border hover:bg-slate-50 flex items-center justify-center text-muted-foreground"
            aria-label="Close"
            data-testid="email-preview-close"
          >
            <X size={16} />
          </button>
        </div>

        {/* ---- Body (scrollable) ---- */}
        <div className="px-6 py-5 overflow-y-auto flex-1">
          <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
            {email.body}
          </div>
        </div>

        {/* ---- Footer ---- */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-slate-50/40">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm font-semibold rounded-md border border-border bg-white text-foreground hover:bg-slate-100"
            data-testid="email-preview-cancel"
          >
            Close
          </button>
          {onOpenInInbox && (
            <button
              type="button"
              onClick={() => {
                onOpenInInbox(email.id);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-md bg-primary text-primary-foreground hover:opacity-90"
              data-testid="email-preview-open-inbox"
            >
              Open in Inbox <ExternalLink size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
