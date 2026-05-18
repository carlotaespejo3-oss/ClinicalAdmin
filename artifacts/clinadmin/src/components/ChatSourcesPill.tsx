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
  // IDs the server's tool-use loop SUCCESSFULLY fetched and read.
  ids: number[];
  sources: Map<number, SourceRecord>;
  // IDs the model tried to fetch but couldn't (URL unreachable, non-OK
  // status, timeout). Surfaced as a distinct amber warning state so
  // "we tried RCH but couldn't read it" isn't silently degraded to
  // "answered from general knowledge".
  failedIds?: number[];
  // 'answer' turns surface clinical content from the model and should
  // be flagged amber when nothing was consulted (the answer is then
  // training-data-only). 'draft' turns are usually style/tone edits
  // that legitimately need no sources, so a missing-source state for
  // those is silent rather than noisy.
  turnKind: 'draft' | 'answer';
  testIdSuffix: string;
}

export function ChatSourcesPill({
  ids,
  sources,
  failedIds = [],
  turnKind,
  testIdSuffix,
}: ChatSourcesPillProps) {
  const resolved = ids
    .map((id) => sources.get(id))
    .filter((s): s is SourceRecord => Boolean(s));
  const failed = failedIds
    .map((id) => sources.get(id))
    .filter((s): s is SourceRecord => Boolean(s));

  if (resolved.length === 0) {
    if (failed.length > 0) {
      // Failed fetches are always worth surfacing — the model TRIED to
      // ground the answer and couldn't, regardless of turn kind.
      const names = failed.map((s) => s.sourceName).join(', ');
      return (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full"
          data-testid={`chat-sources-failed-${testIdSuffix}`}
          title={`Tried to read ${names} but the fetch failed. This reply is NOT grounded in your registered sources — treat as unverified.`}
        >
          <AlertTriangle size={10} />
          Couldn't read: {names}
        </span>
      );
    }
    if (turnKind === 'draft') {
      // Pure draft/style edit with no source lookup — expected, no badge.
      return null;
    }
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full"
        data-testid={`chat-sources-none-${testIdSuffix}`}
        title="The AI did not consult any of your registered sources for this reply. It answered from its training data — treat as unverified clinical content."
      >
        <AlertTriangle size={10} />
        Not grounded in your sources
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
