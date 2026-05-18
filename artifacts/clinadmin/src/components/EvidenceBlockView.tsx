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

      {block.prescribingWarning && (
        <div
          className="bg-rose-50 border-2 border-rose-300 text-rose-900 text-xs p-3 rounded-lg flex items-start gap-2"
          data-testid="evidence-prescribing-warning"
        >
          <AlertTriangle size={14} className="text-rose-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold uppercase tracking-tight text-[11px] mb-0.5">
              Prescribing — verify in eTG / AMH
            </p>
            <p className="leading-relaxed">{block.prescribingWarning}</p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {block.citations.map((c, i) => (
          <CitationCard key={i} c={c} />
        ))}
      </div>
    </div>
  );
}

export function NoEvidenceRefusal() {
  return (
    <div
      className="bg-slate-50 border-2 border-dashed border-slate-300 text-slate-700 text-xs p-5 rounded-xl"
      data-testid="evidence-no-source"
    >
      <div className="flex items-start gap-3">
        <BookOpen size={18} className="text-slate-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-bold uppercase tracking-tight text-[11px] text-slate-700 mb-1">
            No verified clinical source available
          </p>
          <p className="leading-relaxed text-slate-700/90">
            Auto-drafting is disabled for this email because no entry in the approved source
            hierarchy (eTG, AMH, MIMS, RACGP, RCH, RANZCP, NHMRC, TGA, ACSQHC) has been linked
            to the question yet. Please consult the relevant guideline or specialist directly,
            then reply manually.
          </p>
        </div>
      </div>
    </div>
  );
}
