import type { ManualTask } from './types';
import type { LinkedDocTask } from './linkedDocTasksStore';

export interface LinkedTaskRef {
  id: string;
  title: string;
  source: 'manual' | 'doc';
  done: boolean;
}

// Find the single linked task associated with an email — either an
// auto-created document task (Step 4) or a hand-authored manual task that
// the seed data linked via linkedTaskId. Doc tasks take precedence because
// they're the more recent, AI-driven signal.
export function findLinkedTaskForEmail(
  emailId: number,
  manualTasks: readonly ManualTask[],
  linkedDocTasks: ReadonlyMap<number, LinkedDocTask>,
): LinkedTaskRef | null {
  const doc = linkedDocTasks.get(emailId);
  if (doc) {
    return { id: doc.id, title: doc.title, source: 'doc', done: !!doc.done };
  }
  const m = manualTasks.find((t) => t.linkedEmailId === emailId);
  if (m) {
    return { id: m.id, title: m.title, source: 'manual', done: !!m.done };
  }
  return null;
}

export function findEmailIdForTask(
  taskId: string,
  manualTasks: readonly ManualTask[],
  linkedDocTasks: ReadonlyMap<number, LinkedDocTask>,
): { emailId: number; source: 'manual' | 'doc' } | null {
  for (const t of linkedDocTasks.values()) {
    if (t.id === taskId) return { emailId: t.linkedEmailId, source: 'doc' };
  }
  const m = manualTasks.find((t) => t.id === taskId);
  if (m && m.linkedEmailId != null) return { emailId: m.linkedEmailId, source: 'manual' };
  return null;
}

// Heuristic: is the clinician's reply text saying "the document is done /
// attached / sent / in the file"? Used to prompt them to also tick the
// linked task. Conservative — only matches phrases that strongly imply
// completion, never the bare word "attached" alone.
const COMPLETION_PATTERNS: RegExp[] = [
  /\bplease\s+find\s+(the\s+)?(report|letter|certificate|form|document)?\s*attached\b/i,
  /\bplease\s+find\s+attached\b/i,
  /\b(I\s+have|I've)\s+(completed|written|drafted|prepared|finished|finalised|finalized)\b/i,
  /\bthe\s+(report|letter|certificate|form|document)\s+is\s+(in\s+the\s+(file|notes|chart)|attached|complete(d)?|ready|done)\b/i,
  /\bI\s+have\s+(sent|emailed|forwarded|uploaded)\s+the\s+(report|letter|certificate|form|document)\b/i,
  /\b(report|letter|certificate|form|document)\s+(is|has\s+been)\s+(attached|sent|completed|filed|uploaded)\b/i,
  /\battached\s+is\s+(the\s+|my\s+|a\s+)?(report|letter|certificate|form|document)\b/i,
];

export function detectCompletionLanguage(text: string | undefined | null): boolean {
  if (!text) return false;
  for (const re of COMPLETION_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}
