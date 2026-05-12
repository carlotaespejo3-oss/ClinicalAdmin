import { X, FileText, Mail, MessageSquare } from 'lucide-react';
import {
  useCurrentLinkedTaskPrompt,
  dismissCurrentLinkedTaskPrompt,
  type LinkedTaskPromptMode,
} from '@/lib/linkedTaskPromptStore';

interface Props {
  // Mark the linked task as done (routes to the right store internally).
  onCompleteTask: (taskId: string, source: 'manual' | 'doc' | 'prompt', emailId: number) => void;
  // Keep the task open but attach a contextual note so the Tasks tab can
  // explain why it's still there.
  onKeepTaskOpenWithNote: (taskId: string, source: 'manual' | 'doc' | 'prompt', emailId: number, note: string) => void;
  // Mark the originating email as done (acknowledge + archive).
  onCompleteEmail: (emailId: number) => void;
}

const COPY: Record<LinkedTaskPromptMode, {
  title: string;
  body: (taskTitle: string, emailSubject: string) => string;
  yesLabel: string;
  noLabel: string;
  icon: typeof Mail;
  iconBg: string;
  iconColor: string;
}> = {
  'email-done': {
    title: "You've marked this email as done.",
    body: (taskTitle) => `Have you completed the linked document too?\n\n“${taskTitle}”`,
    yesLabel: 'Yes — complete task',
    noLabel: 'No — keep task open',
    icon: Mail,
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
  },
  'task-done': {
    title: "You've completed the document.",
    body: (_t, emailSubject) => `Do you also want to mark the original email as done?\n\n“${emailSubject}”`,
    yesLabel: 'Yes — mark email done',
    noLabel: 'No — leave email',
    icon: FileText,
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-600',
  },
  'reply-language': {
    title: 'It looks like you may have completed this document.',
    body: (taskTitle) => `Your reply mentions the document is attached, sent, or in the file. Do you want to mark the linked task as done?\n\n“${taskTitle}”`,
    yesLabel: 'Yes — mark task done',
    noLabel: 'No — keep task open',
    icon: MessageSquare,
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
};

const KEEP_OPEN_NOTE = 'Document still needed — email already replied to';

export default function LinkedTaskPromptModal({
  onCompleteTask,
  onKeepTaskOpenWithNote,
  onCompleteEmail,
}: Props) {
  const prompt = useCurrentLinkedTaskPrompt();
  if (!prompt) return null;

  const copy = COPY[prompt.mode];
  const Icon = copy.icon;

  const handleYes = () => {
    if (prompt.mode === 'email-done' || prompt.mode === 'reply-language') {
      onCompleteTask(prompt.taskId, prompt.taskSource, prompt.emailId);
    } else if (prompt.mode === 'task-done') {
      onCompleteEmail(prompt.emailId);
    }
    dismissCurrentLinkedTaskPrompt();
  };

  const handleNo = () => {
    if (prompt.mode === 'email-done') {
      // Spec: keep task open with a note explaining the email is already
      // replied to so the Tasks tab can surface it.
      onKeepTaskOpenWithNote(prompt.taskId, prompt.taskSource, prompt.emailId, KEEP_OPEN_NOTE);
    }
    // task-done / reply-language: "No" simply closes the prompt.
    dismissCurrentLinkedTaskPrompt();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      data-testid="linked-task-prompt-modal"
      onClick={(e) => {
        // Click outside dismisses without action — same as "No" for
        // task-done/reply-language; for email-done we still attach the
        // note so the user isn't left without a reminder.
        if (e.target === e.currentTarget) handleNo();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-6 pt-6 pb-2 flex items-start gap-4">
          <div className={`w-12 h-12 rounded-2xl ${copy.iconBg} flex items-center justify-center flex-shrink-0`}>
            <Icon size={22} className={copy.iconColor} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-foreground leading-tight">{copy.title}</h3>
            <p className="text-sm text-muted-foreground mt-2 whitespace-pre-line leading-relaxed">
              {copy.body(prompt.taskTitle, prompt.emailSubject)}
            </p>
          </div>
          <button
            onClick={handleNo}
            className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            aria-label="Dismiss"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 pb-6 pt-4 flex gap-2 justify-end">
          <button
            onClick={handleNo}
            className="px-4 py-2 rounded-lg border border-border bg-white text-sm font-bold text-foreground hover:bg-slate-50 transition-colors"
            data-testid="linked-prompt-no"
          >
            {copy.noLabel}
          </button>
          <button
            onClick={handleYes}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary/90 transition-colors"
            data-testid="linked-prompt-yes"
          >
            {copy.yesLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
