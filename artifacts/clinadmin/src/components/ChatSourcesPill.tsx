import { BookOpen, AlertTriangle } from 'lucide-react';
import type { SourceRecord } from '@/lib/evidenceStore';

// Click-to-expand pill that sits under an assistant chat turn and shows
// the registered evidence sources the AI said it consulted for that
// turn. Source IDs are resolved against the live registry at render
// time so links always point at the currently registered URL — never a
// stale snapshot.
//
// Honesty rule: an empty `ids` list means the AI answered from general
// clinical knowledge, not from anything in the registry. We show that
// explicitly rather than hiding the pill, so the clinician can tell at
// a glance "this answer is unsourced".
//
// Uses native <details>/<summary> so each turn manages its own expand
// state without forcing an extra useState into InboxTab.

export interface ChatSourcesPillProps {
  ids: number[];
  sources: Map<number, SourceRecord>;
  // True if the AI returned source IDs the registry doesn't recognise.
  // Surfaced as a distinct warning state so an empty list isn't
  // mistaken for "answered from general knowledge" when in fact the
  // AI named sources we couldn't verify.
  hadInvalidIds: boolean;
  testIdSuffix: string;
}

export function ChatSourcesPill({ ids, sources, hadInvalidIds, testIdSuffix }: ChatSourcesPillProps) {
  const resolved = ids
    .map((id) => sources.get(id))
    .filter((s): s is SourceRecord => Boolean(s));

  if (resolved.length === 0) {
    if (hadInvalidIds) {
      return (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full"
          data-testid={`chat-sources-invalid-${testIdSuffix}`}
          title="The AI named sources that are not in your registered evidence list. Treat this answer as unverified."
        >
          <AlertTriangle size={10} />
          Sources named but not verified
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 italic"
        data-testid={`chat-sources-none-${testIdSuffix}`}
        title="The AI answered from general clinical knowledge, not from a registered source."
      >
        <BookOpen size={10} />
        Sources: general clinical knowledge
      </span>
    );
  }

  return (
    <details className="group inline-block" data-testid={`chat-sources-${testIdSuffix}`}>
      <summary
        className="list-none cursor-pointer inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-100 hover:bg-blue-200 px-2 py-0.5 rounded-full uppercase tracking-tight transition-colors"
        data-testid={`chat-sources-toggle-${testIdSuffix}`}
      >
        <BookOpen size={10} />
        Sources ({resolved.length})
        <span className="text-blue-500 group-open:rotate-90 transition-transform">›</span>
      </summary>
      <ul className="mt-1.5 ml-1 space-y-1" data-testid={`chat-sources-list-${testIdSuffix}`}>
        {resolved.map((s) => (
          <li key={s.id} className="text-[11px] leading-snug">
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:text-blue-900 hover:underline"
              data-testid={`chat-source-link-${testIdSuffix}-${s.id}`}
            >
              <span className="font-semibold">{s.sourceName}</span>
              <span className="text-slate-500"> ({s.year})</span>
              <span className="text-slate-700"> — {s.title}</span>
            </a>
            <span className="ml-1 text-[9px] font-bold text-slate-400 uppercase tracking-wider">
              tier {s.tier}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
