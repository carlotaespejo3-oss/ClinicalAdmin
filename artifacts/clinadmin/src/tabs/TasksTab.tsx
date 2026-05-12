import { useState, useMemo } from 'react';
import {
  CheckSquare,
  Plus,
  X,
  Clock,
  AlertCircle,
  Mail,
  Link2,
  ListChecks,
  Filter,
  Calendar,
  CheckCircle2,
  Circle,
  Timer,
  Flag,
  Trash2,
} from 'lucide-react';
import { ManualTask, SidebarTask, TabType } from '@/lib/types';
import { emails } from '@/lib/data';
import { cn } from '@/lib/utils';
import { useLinkedDocTasks, toggleLinkedDocTaskDone } from '@/lib/linkedDocTasksStore';
import { useAcknowledgedEmails } from '@/lib/acknowledgedStore';
import { useArchivedEmails } from '@/lib/archivedStore';
import { requestLinkedTaskPrompt } from '@/lib/linkedTaskPromptStore';

type UnifiedTask = {
  id: string;
  source: 'manual' | 'sidebar';
  title: string;
  estMin: number;
  done: boolean;
  deadline: number | null;
  type?: string;
  risk?: 'high' | 'medium' | 'low' | 'none';
  priority?: 'high' | 'normal';
  linkedEmailId?: number;
  autoCompleteOnReply?: boolean;
  // Routing hint: 'doc' tasks live in linkedDocTasksStore, 'manual' come from
  // the seed/manualTaskList state owned by ClinAdmin. Used by the toggle
  // handler to push the right kind of task-done prompt.
  taskSource?: 'manual' | 'doc';
  // Surfaced when the clinician archived the linked email but kept this
  // task open via the 'No' button on the email-done prompt.
  noteAfterEmailDone?: string;
};

type Filter = 'all' | 'due-soon' | 'linked' | 'manual' | 'done';

interface TasksTabProps {
  manualTasks: ManualTask[];
  sidebarTasks: SidebarTask[];
  onToggleManualTask: (id: string) => void;
  onToggleSidebarTask: (id: string) => void;
  onRemoveSidebarTask: (id: string) => void;
  onAddSidebarTask: (title: string, mins: number, priority: 'high' | 'normal') => void;
  onNavigate: (tab: TabType) => void;
  onOpenEmail: (emailId: number) => void;
}

const TYPE_COLOUR: Record<string, string> = {
  Report: 'bg-purple-50 text-purple-700 border-purple-200',
  'Phone call': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Letter: 'bg-blue-50 text-blue-700 border-blue-200',
  Meeting: 'bg-amber-50 text-amber-700 border-amber-200',
  Form: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  Manual: 'bg-slate-50 text-slate-700 border-slate-200',
};

function deadlineLabel(d: number | null): string {
  if (d === null) return '—';
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d <= 7) return `${d}d`;
  return `${d}d`;
}

function deadlineColour(d: number | null): string {
  if (d === null) return 'bg-slate-50 text-slate-600 border-slate-200';
  if (d < 0) return 'bg-red-100 text-red-800 border-red-300';
  if (d <= 1) return 'bg-red-50 text-red-700 border-red-200';
  if (d <= 3) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (d <= 7) return 'bg-blue-50 text-blue-700 border-blue-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

function bucketOf(d: number | null): 'overdue' | 'today' | 'week' | 'later' {
  if (d === null) return 'later';
  if (d < 0) return 'overdue';
  if (d <= 1) return 'today';
  if (d <= 7) return 'week';
  return 'later';
}

const BUCKET_META: Record<string, { label: string; icon: any; colour: string }> = {
  overdue: { label: 'Overdue', icon: AlertCircle, colour: 'text-red-700' },
  today: { label: 'Due today / tomorrow', icon: Flag, colour: 'text-amber-700' },
  week: { label: 'This week', icon: Calendar, colour: 'text-blue-700' },
  later: { label: 'Later', icon: Clock, colour: 'text-slate-600' },
};

export default function TasksTab({
  manualTasks,
  sidebarTasks,
  onToggleManualTask,
  onToggleSidebarTask,
  onRemoveSidebarTask,
  onAddSidebarTask,
  onNavigate,
  onOpenEmail,
}: TasksTabProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newMins, setNewMins] = useState('15');
  const [newPriority, setNewPriority] = useState<'high' | 'normal'>('normal');
  const linkedDocTasks = useLinkedDocTasks();
  const acknowledged = useAcknowledgedEmails();
  const archived = useArchivedEmails();
  const isEmailOpen = (id: number | undefined) =>
    id != null && !acknowledged.has(id) && !archived.has(id);

  const all: UnifiedTask[] = useMemo(() => {
    const m: UnifiedTask[] = manualTasks.map(t => ({
      id: t.id,
      source: 'manual',
      title: t.title,
      estMin: t.estMin,
      done: t.done ?? false,
      deadline: t.deadline,
      type: t.type,
      risk: t.risk,
      linkedEmailId: t.linkedEmailId,
      autoCompleteOnReply: t.autoCompleteOnReply,
      taskSource: 'manual',
      noteAfterEmailDone: t.noteAfterEmailDone,
    }));
    const s: UnifiedTask[] = sidebarTasks.map(t => ({
      id: t.id,
      source: 'sidebar',
      title: t.title,
      estMin: t.estMin,
      done: t.done,
      deadline: null,
      type: 'Manual',
      priority: t.priority,
    }));
    // Auto-created document tasks live in their own runtime store so they
    // can be paired with the originating email. Surface them here so the
    // clinician can see the full task list in one place.
    const d: UnifiedTask[] = Array.from(linkedDocTasks.values()).map(t => ({
      id: t.id,
      source: 'manual',
      title: t.title,
      estMin: t.estMin,
      done: t.done ?? false,
      deadline: t.deadline,
      type: t.type,
      risk: t.risk,
      linkedEmailId: t.linkedEmailId,
      autoCompleteOnReply: t.autoCompleteOnReply,
      taskSource: 'doc',
      noteAfterEmailDone: t.noteAfterEmailDone,
    }));
    return [...d, ...m, ...s];
  }, [manualTasks, sidebarTasks, linkedDocTasks]);

  const filtered = useMemo(() => {
    return all.filter(t => {
      switch (filter) {
        case 'due-soon': return !t.done && t.deadline !== null && t.deadline >= 0 && t.deadline <= 3;
        case 'linked': return !t.done && !!t.linkedEmailId;
        case 'manual': return !t.done && t.source === 'sidebar';
        case 'done': return t.done;
        default: return !t.done;
      }
    });
  }, [all, filter]);

  const grouped = useMemo(() => {
    const buckets: Record<string, UnifiedTask[]> = { overdue: [], today: [], week: [], later: [] };
    filtered.forEach(t => buckets[bucketOf(t.deadline)].push(t));
    Object.values(buckets).forEach(b => b.sort((a, b) => (a.deadline ?? 999) - (b.deadline ?? 999)));
    return buckets;
  }, [filtered]);

  const stats = useMemo(() => {
    const open = all.filter(t => !t.done);
    const overdue = open.filter(t => t.deadline !== null && t.deadline < 0).length;
    const dueSoon = open.filter(t => t.deadline !== null && t.deadline >= 0 && t.deadline <= 3).length;
    const totalMin = open.reduce((sum, t) => sum + t.estMin, 0);
    return { openCount: open.length, overdue, dueSoon, totalMin };
  }, [all]);

  const handleToggle = (t: UnifiedTask) => {
    // Capture pre-toggle state — we only prompt when the task is becoming
    // done, never when un-ticking it.
    const wasDone = t.done;

    if (t.source === 'manual') {
      // Auto-created document tasks live in their own store and are keyed
      // by linkedEmailId — route the toggle there.
      if (t.linkedEmailId && linkedDocTasks.has(t.linkedEmailId)) {
        toggleLinkedDocTaskDone(t.linkedEmailId);
      } else {
        onToggleManualTask(t.id);
      }
    } else {
      onToggleSidebarTask(t.id);
    }

    // After marking a linked task done, ask whether to also close out the
    // originating email — but only if the email is still open.
    if (!wasDone && t.linkedEmailId && isEmailOpen(t.linkedEmailId)) {
      const linkedEmail = emails.find(e => e.id === t.linkedEmailId);
      if (linkedEmail && t.taskSource) {
        requestLinkedTaskPrompt({
          mode: 'task-done',
          emailId: t.linkedEmailId,
          emailSubject: linkedEmail.subject,
          taskId: t.id,
          taskTitle: t.title,
          taskSource: t.taskSource,
        });
      }
    }
  };

  const handleAdd = () => {
    const title = newTitle.trim();
    if (!title) return;
    onAddSidebarTask(title, parseInt(newMins) || 15, newPriority);
    setNewTitle(''); setNewMins('15'); setNewPriority('normal'); setAdding(false);
  };

  const filterCounts = useMemo(() => ({
    all: all.filter(t => !t.done).length,
    'due-soon': all.filter(t => !t.done && t.deadline !== null && t.deadline >= 0 && t.deadline <= 3).length,
    linked: all.filter(t => !t.done && !!t.linkedEmailId).length,
    manual: all.filter(t => !t.done && t.source === 'sidebar').length,
    done: all.filter(t => t.done).length,
  }), [all]);

  const totalHrs = Math.floor(stats.totalMin / 60);
  const totalRemMin = stats.totalMin % 60;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <CheckSquare size={22} className="text-primary" />
            Tasks
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Everything that isn't an email — reports, phone calls, paperwork, and follow-ups.
          </p>
        </div>
        <button
          onClick={() => setAdding(v => !v)}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors",
            adding ? "bg-slate-200 text-slate-700" : "bg-primary text-white hover:bg-primary/90"
          )}
          data-testid="button-add-task"
        >
          {adding ? <X size={15} /> : <Plus size={15} />}
          {adding ? 'Cancel' : 'Add task'}
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <div className="bg-white border border-border rounded-2xl p-4 shadow-sm">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">
                Task description
              </label>
              <input
                autoFocus
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
                placeholder="e.g. Phone Mrs. Davies about Lucas EHCP"
                className="w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
                data-testid="input-new-task-title"
              />
            </div>
            <div className="w-24">
              <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Time</label>
              <div className="relative">
                <input
                  type="number"
                  value={newMins}
                  onChange={e => setNewMins(e.target.value)}
                  className="w-full text-sm bg-white border border-border rounded-lg pl-3 pr-9 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  data-testid="input-new-task-mins"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">min</span>
              </div>
            </div>
            <div className="w-28">
              <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Priority</label>
              <select
                value={newPriority}
                onChange={e => setNewPriority(e.target.value as 'high' | 'normal')}
                className="w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
                data-testid="select-new-task-priority"
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
            <button
              onClick={handleAdd}
              disabled={!newTitle.trim()}
              className="bg-primary text-white text-sm font-bold px-5 py-2 rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
              data-testid="button-confirm-add-task"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <ListChecks size={13} className="text-slate-500" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Open</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{stats.openCount}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">tasks remaining</p>
        </div>
        <div className={cn(
          "bg-white border rounded-2xl p-4",
          stats.overdue > 0 ? "border-red-200 bg-red-50/30" : "border-border"
        )}>
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle size={13} className={stats.overdue > 0 ? "text-red-600" : "text-slate-500"} />
            <span className={cn(
              "text-[10px] font-bold uppercase tracking-widest",
              stats.overdue > 0 ? "text-red-700" : "text-muted-foreground"
            )}>Overdue</span>
          </div>
          <p className={cn("text-2xl font-bold", stats.overdue > 0 ? "text-red-700" : "text-foreground")}>{stats.overdue}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">past deadline</p>
        </div>
        <div className={cn(
          "bg-white border rounded-2xl p-4",
          stats.dueSoon > 0 ? "border-amber-200 bg-amber-50/30" : "border-border"
        )}>
          <div className="flex items-center gap-2 mb-1">
            <Flag size={13} className={stats.dueSoon > 0 ? "text-amber-600" : "text-slate-500"} />
            <span className={cn(
              "text-[10px] font-bold uppercase tracking-widest",
              stats.dueSoon > 0 ? "text-amber-700" : "text-muted-foreground"
            )}>Due soon</span>
          </div>
          <p className={cn("text-2xl font-bold", stats.dueSoon > 0 ? "text-amber-700" : "text-foreground")}>{stats.dueSoon}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">within 3 days</p>
        </div>
        <div className="bg-white border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Timer size={13} className="text-slate-500" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total time</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {totalHrs > 0 && <>{totalHrs}h </>}{totalRemMin}min
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">to clear all open</p>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter size={13} className="text-muted-foreground mr-1" />
        {([
          { id: 'all', label: 'All open' },
          { id: 'due-soon', label: 'Due soon' },
          { id: 'linked', label: 'Linked to email' },
          { id: 'manual', label: 'Manual only' },
          { id: 'done', label: 'Done' },
        ] as { id: Filter; label: string }[]).map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "text-xs font-bold px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5",
              filter === f.id
                ? "bg-primary text-white border-primary"
                : "bg-white text-slate-700 border-border hover:border-primary/40"
            )}
            data-testid={`filter-${f.id}`}
          >
            {f.label}
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full font-bold",
              filter === f.id ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
            )}>
              {filterCounts[f.id]}
            </span>
          </button>
        ))}
      </div>

      {/* Grouped list */}
      <div className="space-y-6">
        {filtered.length === 0 && (
          <div className="bg-white border border-border rounded-2xl p-12 text-center">
            <CheckCircle2 size={32} className="text-emerald-500 mx-auto mb-3" />
            <p className="text-sm font-bold text-foreground">Nothing to show</p>
            <p className="text-xs text-muted-foreground mt-1">
              {filter === 'done' ? 'No completed tasks yet.' : 'You\'re all caught up on this filter.'}
            </p>
          </div>
        )}

        {(['overdue', 'today', 'week', 'later'] as const).map(bucket => {
          const items = grouped[bucket];
          if (!items || items.length === 0) return null;
          const meta = BUCKET_META[bucket];
          const Icon = meta.icon;
          return (
            <div key={bucket}>
              <div className="flex items-center gap-2 mb-2 px-1">
                <Icon size={14} className={meta.colour} />
                <h2 className={cn("text-xs font-bold uppercase tracking-widest", meta.colour)}>{meta.label}</h2>
                <span className="text-[10px] font-bold text-muted-foreground bg-slate-100 px-1.5 py-0.5 rounded-full">
                  {items.length}
                </span>
              </div>
              <div className="bg-white border border-border rounded-2xl divide-y divide-border overflow-hidden">
                {items.map(t => {
                  const linkedEmail = t.linkedEmailId ? emails.find(e => e.id === t.linkedEmailId) : null;
                  return (
                    <div
                      key={`${t.source}-${t.id}`}
                      className={cn(
                        "flex items-start gap-3 p-4 hover:bg-slate-50/50 transition-colors group",
                        t.done && "opacity-60"
                      )}
                      data-testid={`task-row-${t.id}`}
                    >
                      <button
                        onClick={() => handleToggle(t)}
                        className="mt-0.5 flex-shrink-0"
                        data-testid={`toggle-task-${t.id}`}
                      >
                        {t.done
                          ? <CheckCircle2 size={20} className="text-emerald-500" />
                          : <Circle size={20} className="text-slate-300 hover:text-primary transition-colors" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "text-sm font-semibold text-foreground leading-snug",
                          t.done && "line-through text-muted-foreground"
                        )}>
                          {t.title}
                        </p>
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          {t.type && (
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                              TYPE_COLOUR[t.type] ?? TYPE_COLOUR.Manual
                            )}>
                              {t.type}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-muted-foreground bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
                            <Clock size={9} /> {t.estMin} min
                          </span>
                          {t.deadline !== null && (
                            <span className={cn(
                              "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border",
                              deadlineColour(t.deadline)
                            )}>
                              {deadlineLabel(t.deadline)}
                            </span>
                          )}
                          {t.priority === 'high' && (
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                              HIGH PRIORITY
                            </span>
                          )}
                          {t.risk === 'high' && (
                            <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                              HIGH RISK
                            </span>
                          )}
                          {linkedEmail && (
                            <button
                              onClick={() => { onOpenEmail(t.linkedEmailId!); onNavigate('Emails'); }}
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full hover:bg-purple-100 transition-colors"
                              data-testid={`linked-email-${t.linkedEmailId}`}
                              title={linkedEmail.subject}
                            >
                              <Link2 size={9} />
                              Linked: {linkedEmail.from.split('—')[0].trim()}
                            </button>
                          )}
                        </div>
                        {t.noteAfterEmailDone && !t.done && (
                          <p className="text-[11px] text-amber-800 mt-2 flex items-center gap-1.5 font-semibold bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                            <AlertCircle size={10} />
                            {t.noteAfterEmailDone}
                          </p>
                        )}
                        {!t.noteAfterEmailDone && t.autoCompleteOnReply && linkedEmail && !t.done && isEmailOpen(t.linkedEmailId) && (
                          <p className="text-[11px] text-purple-700 mt-2 flex items-center gap-1.5 font-medium">
                            <Mail size={10} />
                            We'll ask if you also completed the document when you mark "{linkedEmail.subject.slice(0, 40)}{linkedEmail.subject.length > 40 ? '…' : ''}" done
                          </p>
                        )}
                      </div>
                      {t.source === 'sidebar' && (
                        <button
                          onClick={() => onRemoveSidebarTask(t.id)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1 rounded"
                          title="Remove task"
                          data-testid={`remove-task-${t.id}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
