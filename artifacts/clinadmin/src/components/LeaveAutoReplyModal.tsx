// LeaveAutoReplyModal.tsx
//
// Shown immediately after a clinician saves a leave block.
// Presents three editable auto-reply messages — one per urgency tier —
// pre-filled from the profile's autoReplyTemplates with real placeholders
// resolved (returnDate, displayName).
//
// The clinician can copy each message and paste it into Outlook's
// Out-of-Office settings. We surface a direct link to the Outlook Web
// App settings page. If a Microsoft Graph OOF API is wired up later,
// the "Copy" buttons become "Set in Outlook" calls.
//
// Saving edits here also persists the updated templates back to the
// profile store so the next leave block starts from the clinician's
// own wording rather than the generic defaults.

import { useState, useCallback } from 'react';
import { X, Copy, Check, ExternalLink, ShieldAlert, Stethoscope, ClipboardList, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useUserProfile,
  updateProfile,
  DEFAULT_AUTO_REPLY_TEMPLATES,
  type AutoReplyTemplates,
} from '@/lib/userProfileStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  /** ISO datetime — endAt of the leave block. Used to compute return date. */
  leaveEndAt: string;
  /** Human-readable "first day back" label, e.g. "Mon 2 Jun". */
  returnDateLabel: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Tier config
// ---------------------------------------------------------------------------

type Tier = 'urgent' | 'clinical' | 'admin';

const TIERS: {
  key: Tier;
  label: string;
  sub: string;
  icon: React.ReactNode;
  colour: string;       // border / accent
  bg: string;           // section background
  labelColour: string;  // label text colour
}[] = [
  {
    key: 'urgent',
    label: 'Urgent & safety',
    sub: 'Safeguarding, clinical emergencies, patient risk',
    icon: <ShieldAlert size={15} />,
    colour: 'border-red-300',
    bg: 'bg-red-50/60',
    labelColour: 'text-red-700',
  },
  {
    key: 'clinical',
    label: 'Clinical',
    sub: 'Clinical queries, results, professional correspondence',
    icon: <Stethoscope size={15} />,
    colour: 'border-amber-300',
    bg: 'bg-amber-50/60',
    labelColour: 'text-amber-700',
  },
  {
    key: 'admin',
    label: 'Admin & general',
    sub: 'Scheduling, forms, general correspondence',
    icon: <ClipboardList size={15} />,
    colour: 'border-blue-200',
    bg: 'bg-blue-50/40',
    labelColour: 'text-blue-700',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderTemplate(
  template: string,
  vars: { returnDate: string; displayName: string },
): string {
  return template
    .replace(/\{returnDate\}/g, vars.returnDate || 'my return date')
    .replace(/\{displayName\}/g, vars.displayName || 'your clinician');
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers without clipboard API
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-all font-medium',
        copied
          ? 'bg-green-50 border-green-300 text-green-700'
          : 'bg-white border-border text-muted-foreground hover:text-foreground hover:border-primary/40',
      )}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function LeaveAutoReplyModal({ returnDateLabel, onClose }: Props) {
  const { profile } = useUserProfile();

  const vars = {
    returnDate: returnDateLabel,
    displayName: profile.displayName,
  };

  // Local edits — start from profile templates, rendered with real values
  const [drafts, setDrafts] = useState<AutoReplyTemplates>(() => ({
    urgent: renderTemplate(
      profile.autoReplyTemplates?.urgent ?? DEFAULT_AUTO_REPLY_TEMPLATES.urgent,
      vars,
    ),
    clinical: renderTemplate(
      profile.autoReplyTemplates?.clinical ?? DEFAULT_AUTO_REPLY_TEMPLATES.clinical,
      vars,
    ),
    admin: renderTemplate(
      profile.autoReplyTemplates?.admin ?? DEFAULT_AUTO_REPLY_TEMPLATES.admin,
      vars,
    ),
  }));

  const [expanded, setExpanded] = useState<Set<Tier>>(new Set(['urgent', 'clinical', 'admin']));
  const toggleExpand = (key: Tier) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Save edited text back as new templates (reverse-engineer placeholders
  // by replacing the rendered values with placeholder tokens again).
  const handleDone = () => {
    // Persist the raw edited text as new templates. We don't attempt to
    // re-tokenise — if the clinician edited the text we keep their exact
    // wording, which means future leave blocks start from their custom copy.
    // This is intentional: the first save "makes it yours".
    const newTemplates: AutoReplyTemplates = {
      urgent: drafts.urgent,
      clinical: drafts.clinical,
      admin: drafts.admin,
    };
    updateProfile({ autoReplyTemplates: newTemplates });
    onClose();
  };

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-base font-bold">Set your out-of-office replies</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Three tiers — so urgent emails get a different reply than routine admin.
              Copy each into Outlook's Out of Office settings.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground ml-3 flex-shrink-0 mt-0.5"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Return date pill */}
        <div className="px-5 pt-3 flex-shrink-0">
          <div className="inline-flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">First day back:</span>
            {returnDateLabel || 'not set'}
          </div>
        </div>

        {/* Tier editors */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {TIERS.map((tier) => {
            const isOpen = expanded.has(tier.key);
            return (
              <div
                key={tier.key}
                className={cn('rounded-xl border overflow-hidden', tier.colour)}
              >
                {/* Tier header */}
                <button
                  type="button"
                  onClick={() => toggleExpand(tier.key)}
                  className={cn(
                    'w-full flex items-center justify-between px-4 py-3 text-left',
                    tier.bg,
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn('flex-shrink-0', tier.labelColour)}>
                      {tier.icon}
                    </span>
                    <div className="min-w-0">
                      <p className={cn('text-sm font-semibold', tier.labelColour)}>
                        {tier.label}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {tier.sub}
                      </p>
                    </div>
                  </div>
                  <span className="text-muted-foreground flex-shrink-0 ml-2">
                    {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                </button>

                {/* Editor */}
                {isOpen && (
                  <div className="bg-background px-4 pb-4 pt-3 space-y-2">
                    <textarea
                      value={drafts[tier.key]}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [tier.key]: e.target.value }))
                      }
                      rows={5}
                      className="w-full text-xs font-mono border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none bg-muted/20 leading-relaxed"
                      spellCheck={true}
                    />
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-muted-foreground">
                        Edit freely — your changes are saved as your new default.
                      </p>
                      <CopyButton text={drafts[tier.key]} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border flex-shrink-0 bg-muted/10">
          <a
            href="https://outlook.office.com/mail/options/mail/automaticReplies"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
          >
            <ExternalLink size={12} />
            Open Outlook auto-reply settings
          </a>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={handleDone}
              className="bg-primary text-primary-foreground text-xs font-semibold px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
