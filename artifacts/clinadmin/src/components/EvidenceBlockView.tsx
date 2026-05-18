import { useState } from 'react';
import { AlertTriangle, BookOpen, ExternalLink, Lock } from 'lucide-react';
import type { Citation, EvidenceBlock } from '@/lib/evidence';
import { FLAG_ICON, FLAG_LABEL } from '@/lib/evidence';
import { cn } from '@/lib/utils';

interface Props {
  block: EvidenceBlock;
}

const TIER_LABEL: Record<number, string> = {
  1: 'Tier 1 — prescribing reference',
  2: 'Tier 2 — Australian college / hospital guideline',
  3: 'Tier 3 — Australian government source',
  4: 'Tier 4 — international guideline',
  5: 'Tier 5 — primary literature',
};

function CitationCard({ c }: { c: Citation }) {
  const hasFlag = c.flag !== null;
  const isConflict = c.flag === 'C' || c.flag === 'D';
  // publiclyAccessible defaults to true for safety on legacy callers;
  // the DB-backed store always sets an explicit value.
  const publiclyAccessible = c.publiclyAccessible !== false;
  return (
    <div
      className={cn(
        'border rounded-lg p-3 bg-white',
        isConflict ? 'border-red-300' : c.flag === 'B' ? 'border-amber-300' : 'border-slate-200',
      )}
      data-testid={`citation-tier-${c.tier}`}
    >
      <div className="flex items-start gap-2">
        <BookOpen size={13} className="flex-shrink-0 mt-0.5 text-slate-500" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            {TIER_LABEL[c.tier] ?? `Tier ${c.tier}`}
          </p>
          <p className="text-xs font-bold text-slate-800 mt-0.5">{c.sourceName}</p>
          <p className="text-xs text-slate-700 leading-snug mt-0.5">
            {c.title} <span className="text-slate-500">({c.year})</span>
          </p>
          {c.url && publiclyAccessible && (
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline mt-1"
              data-testid={`citation-link-${c.tier}`}
            >
              View source <ExternalLink size={10} />
            </a>
          )}
          {!publiclyAccessible && (
            <p
              className="inline-flex items-center gap-1 text-[11px] text-slate-600 mt-1 italic"
              data-testid={`citation-restricted-${c.tier}`}
            >
              <Lock size={10} />
              Not publicly accessible — refer to source directly
            </p>
          )}
        </div>
      </div>
      {hasFlag && c.flag && (
        <div
          className={cn(
            'mt-2 ml-5 text-[11px] rounded p-2 leading-snug',
            isConflict
              ? 'bg-red-50 border border-red-200 text-red-900'
              : c.flag === 'B'
              ? 'bg-amber-50 border border-amber-200 text-amber-900'
              : 'bg-slate-50 border border-slate-200 text-slate-700',
          )}
          data-testid={`citation-flag-${c.flag}`}
        >
          <p className="font-bold mb-0.5">
            <span className="mr-1">{FLAG_ICON[c.flag]}</span>
            {FLAG_LABEL[c.flag]}
          </p>
          {c.flagText && <p>{c.flagText}</p>}
        </div>
      )}
    </div>
  );
}

export function EvidenceBlockView({ block }: Props) {
  return (
    <div
      className="bg-slate-50/60 border border-slate-200 rounded-xl p-4 shadow-sm space-y-3"
      data-testid="evidence-block"
    >
      <div className="flex items-center gap-2">
        <BookOpen size={14} className="text-slate-700" />
        <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-widest">
          Evidence — sources this reply draws on
        </h4>
      </div>

      {/* Prescribing banner. When the matcher returned a drug-specific
          warning, surface it verbatim. Otherwise fall back to the
          blanket "verify dosing in eTG / AMH" reminder so every
          clinical reply carries a prescribing-safety prompt — the
          specific drug name is just a nice-to-have on top. */}
      <div
        className="bg-rose-50 border-2 border-rose-300 text-rose-900 text-xs p-3 rounded-lg flex items-start gap-2"
        data-testid="evidence-prescribing-warning"
      >
        <AlertTriangle size={14} className="text-rose-700 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-bold uppercase tracking-tight text-[11px] mb-0.5">
            Prescribing — verify in eTG / AMH
          </p>
          <p className="leading-relaxed">
            {block.prescribingWarning
              ?? 'Any dose, frequency, or interaction mentioned in your reply should be verified against eTG or AMH before sending.'}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {block.citations.map((c, i) => (
          <CitationCard key={i} c={c} />
        ))}
      </div>
    </div>
  );
}

export interface ClinicianIdeasPanelProps {
  // Current draft text in the ideas textarea (controlled by InboxTab so
  // it survives tab switches in the same session).
  value: string;
  onChange: (next: string) => void;
  // Fired when the clinician clicks "Draft from my ideas". Receives
  // the trimmed ideas text; parent decides whether to gate on length.
  onSubmit: (ideas: string) => void;
  // Disable submit while a draft request is in flight so the same
  // ideas can't be fired twice in quick succession.
  submitting?: boolean;
}

// Shown for CLINICAL emails when no entry in the approved source
// hierarchy could be linked to the question. Rather than refuse and
// leave the clinician with a blank panel, we ask them to type the
// main ideas they want the reply to make. The AI then wordsmiths
// those ideas into a polite reply using buildClinicalFromIdeasPrompt
// — it adds NO clinical content of its own.
export function NoEvidenceRefusal(props?: ClinicianIdeasPanelProps) {
  // Backwards-compatible: if called with no props, render a read-only
  // refusal (legacy callers). New callers pass props to enable input.
  if (!props) {
    return (
      <div
        className="bg-slate-50 border-2 border-dashed border-slate-300 text-slate-700 text-xs p-5 rounded-xl"
        data-testid="evidence-no-source"
      >
        <div className="flex items-start gap-3">
          <BookOpen size={18} className="text-slate-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold uppercase tracking-tight text-[11px] text-slate-700 mb-1">
              No relevant or safe guideline found
            </p>
            <p className="leading-relaxed text-slate-700/90">
              No entry in the approved source hierarchy (eTG, AMH, MIMS, RACGP, RCH, RANZCP,
              NHMRC, TGA, ACSQHC) covers this question. Please reply manually.
            </p>
          </div>
        </div>
      </div>
    );
  }
  return <ClinicianIdeasPanelImpl {...props} />;
}

function ClinicianIdeasPanelImpl({ value, onChange, onSubmit, submitting }: ClinicianIdeasPanelProps) {
  const [touched, setTouched] = useState(false);
  const trimmed = value.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < 5;
  const empty = trimmed.length === 0;
  const canSubmit = !empty && !tooShort && !submitting;
  return (
    <div
      className="bg-slate-50 border-2 border-dashed border-slate-300 text-slate-700 text-xs p-5 rounded-xl"
      data-testid="evidence-no-source"
    >
      <div className="flex items-start gap-3">
        <BookOpen size={18} className="text-slate-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-bold uppercase tracking-tight text-[11px] text-slate-700 mb-1">
            Nil relevant or safe guideline found
          </p>
          <p className="leading-relaxed text-slate-700/90 mb-3">
            No entry in the approved source hierarchy covers this question, so the AI
            won't draft a clinical reply on its own. Type the main ideas or messages you
            want the reply to make and the AI will wordsmith them into a polite reply —
            it won't add clinical content of its own.
          </p>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setTouched(true)}
            disabled={submitting}
            placeholder={
              "e.g.\n- Confirm the dose change is fine\n- Ask them to repeat bloods in 2 weeks\n- Offer a phone review if symptoms worsen"
            }
            rows={5}
            className="w-full text-xs text-slate-800 bg-white border border-slate-300 rounded-lg p-2.5 leading-relaxed focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-60 placeholder:text-slate-400"
            data-testid="input-clinician-ideas"
          />
          {touched && tooShort && (
            <p className="mt-1 text-[11px] text-amber-700">
              A few more words would help — the AI needs something to work with.
            </p>
          )}
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => onSubmit(trimmed)}
              className="text-[11px] font-bold bg-slate-800 text-white px-3 py-1.5 rounded shadow hover:bg-slate-900 transition-colors uppercase tracking-tight disabled:bg-slate-300 disabled:cursor-not-allowed"
              data-testid="button-draft-from-ideas"
            >
              {submitting ? "Drafting…" : "Draft from my ideas"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
