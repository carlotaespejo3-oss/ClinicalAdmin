import { useState, useEffect, useRef } from 'react';
import { Home, Mail, Shield, PenTool, RefreshCcw, Plus, X, ClipboardList, BarChart2, CheckSquare, Settings, User, CalendarDays, LogOut, Archive } from 'lucide-react';
import { cn } from '@/lib/utils';
import { emails as allEmails } from '@/lib/data';
import { useAcknowledgedEmails, acknowledgeEmail } from '@/lib/acknowledgedStore';
import { useArchivedEmails, archiveEmail } from '@/lib/archivedStore';
import {
  setLinkedDocDone,
  setLinkedDocNote,
  useLinkedDocTasks,
} from '@/lib/linkedDocTasksStore';
import {
  requestLinkedTaskPrompt,
  hasPendingPromptForEmail,
} from '@/lib/linkedTaskPromptStore';
import { findLinkedTaskForEmail } from '@/lib/linkedTaskUtils';
import {
  usePromptedTasksState,
  getPromptedTasksForEmail,
  setPromptedTaskDone,
} from '@/lib/promptedTasksStore';
import {
  useWeekSetupCache,
  useIsWeekHydrated,
  setWeekSetupInternal,
  updateWeekSetupInternal,
} from '@/lib/weeklyPlanStore';
import LinkedTaskPromptModal from '../components/LinkedTaskPromptModal';
import HomeTab from '../tabs/HomeTab';
import InboxTab from '../tabs/InboxTab';
import ArchiveTab from '../tabs/ArchiveTab';
import HighRiskTab from '../tabs/HighRiskTab';
import { useClassifyBootstrap } from '@/lib/useClassifyBootstrap';
import { useMatchEvidenceBootstrap } from '@/lib/useMatchEvidenceBootstrap';
import { useClinicianSettingsHydration } from '@/lib/clinicianSettingsStore';
import TimelineTab from '../tabs/TimelineTab';
import CalendarTab from '../tabs/CalendarTab';
import ForecastTab from '../tabs/ForecastTab';
import WeeklyPlanTab from '../tabs/WeeklyPlanTab';
import StyleTab from '../tabs/StyleTab';
import CatchUpTab from '../tabs/CatchUpTab';
import TasksTab from '../tabs/TasksTab';
import SettingsTab from '../tabs/SettingsTab';
import WeeklySetupModal from '../components/WeeklySetupModal';
import { TabType, GeneratedPlan } from '@/lib/types';
import {
  useManualTasksWithOverrides,
  setManualTaskDone,
  setManualTaskNote,
} from '@/lib/manualTaskOverridesStore';
import {
  useSidebarTasks,
  addSidebarTaskInternal,
  removeSidebarTaskInternal,
  toggleSidebarTaskInternal,
} from '@/lib/sidebarTasksStore';

export interface WeekSetup {
  hours: number;
  days: string[];
  plan?: GeneratedPlan | null;
  sessionLengthMin?: number;
  /** Optional per-day minute allocations. When present, takes precedence
   * over the even-split derived from `hours / days.length` for any day
   * listed here. Days not present fall back to the even split. */
  minutesByDay?: Record<string, number>;
}

const tabs: { id: TabType; icon: any; label: string }[] = [
  { id: 'Home', icon: Home, label: 'Home' },
  { id: 'Weekly Plan', icon: CalendarDays, label: 'Weekly Plan' },
  { id: 'Calendar', icon: CalendarDays, label: 'Calendar' },
  { id: 'Emails', icon: Mail, label: 'Emails' },
  { id: 'Archive', icon: Archive, label: 'Archive' },
  { id: 'High-Risk Patients', icon: Shield, label: 'High-Risk Patients' },
  { id: 'Tasks', icon: CheckSquare, label: 'Tasks' },
  { id: 'Backlog Recovery', icon: RefreshCcw, label: 'Backlog Recovery' },
  { id: 'Forecast', icon: BarChart2, label: 'Forecast' },
  { id: 'Templates', icon: PenTool, label: 'Templates' },
  { id: 'Settings', icon: Settings, label: 'Settings' },
];

// ISO-style identifier for the current week. The legacy localStorage
// key was `clinadmin-week-${weekKey}`; the new server-backed store
// strips the prefix and persists just the YYYY-NN portion. The
// migration helper inside weeklyPlanStore knows how to find the old
// localStorage entry from the bare weekKey.
function getWeekKey() {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil((((d.getTime() - jan1.getTime()) / 86400000) + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-${weekNum}`;
}

export default function ClinAdmin() {
  // Kick off AI classification for every inbox email once per session, no
  // matter which tab the user opens first. High-Risk and any future
  // classification-driven tab depend on this running early.
  useClassifyBootstrap();
  // Stage 3: AI source-matcher. Boots up the urgent subset
  // (URGENT_CLINICAL + SAFEGUARDING) once both the classification
  // store and the evidence store have hydrated. Routine CLINICAL
  // emails match on-demand via `useEnsureEvidenceMatch` in the
  // email-open container.
  useMatchEvidenceBootstrap();
  // Hydrate clinician-wide settings (arrivals, style profile,
  // signatures) once, at app root, so synchronous prompt builders
  // see real values rather than defaults by the time the user
  // clicks "Generate".
  useClinicianSettingsHydration();
  const [activeTab, setActiveTab] = useState<TabType>('Home');
  // Both lists now persist server-side. Sidebar is full CRUD;
  // manual tasks are seed records (lib/data.ts) overlaid with the
  // clinician's per-task overrides (done flag + optional kept-open
  // note). See manualTaskOverridesStore for why we don't persist
  // the seed records themselves.
  const sidebarTasks = useSidebarTasks();
  const manualTaskList = useManualTasksWithOverrides();
  const [openEmailId, setOpenEmailId] = useState<number | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskMins, setNewTaskMins] = useState('15');
  const [newTaskPriority, setNewTaskPriority] = useState<'high' | 'normal'>('normal');
  const [showWeeklySetup, setShowWeeklySetup] = useState(false);
  // Per-week planner snapshot now lives in Postgres via
  // weeklyPlanStore (composite PK clinician_id + week_key). The
  // store hydrates this week's row on first read and keeps the
  // cache in sync across components.
  const [weekKey] = useState(() => getWeekKey());
  const weekSetup = useWeekSetupCache(weekKey);
  const weekHydrated = useIsWeekHydrated(weekKey);
  const acknowledged = useAcknowledgedEmails();
  const archived = useArchivedEmails();
  const linkedDocTasks = useLinkedDocTasks();
  // Subscribe so the email-done detector reacts to newly-created
  // prompted tasks. Value itself is read via getPromptedTasksForEmail
  // inside the effect to avoid stale-closure issues.
  usePromptedTasksState();
  // An email is "out of the inbox" if it has been acknowledged OR archived
  // (acknowledged or marked done). Sidebar badges and counts use this.
  const isOutOfInbox = (id: number) => acknowledged.has(id) || archived.has(id);

  // Linked email/task prompt detector. When an email transitions from
  // open → done (acknowledged or archived) AND has an open linked task,
  // we ask the clinician whether to also complete the task. The
  // pre-seen refs ensure we don't fire prompts for state restored from
  // localStorage on first mount, and the hasPendingPromptForEmail check
  // means a 'reply-language' prompt already queued by InboxTab wins
  // (it's the more specific signal).
  const seenAckRef = useRef<Set<number> | null>(null);
  const seenArcRef = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (seenAckRef.current === null) {
      seenAckRef.current = new Set(acknowledged);
      seenArcRef.current = new Set(archived.keys());
      return;
    }
    const newlyDone = new Set<number>();
    for (const id of acknowledged) {
      if (!seenAckRef.current.has(id)) newlyDone.add(id);
    }
    for (const id of archived.keys()) {
      if (!seenArcRef.current!.has(id)) newlyDone.add(id);
    }
    seenAckRef.current = new Set(acknowledged);
    seenArcRef.current = new Set(archived.keys());

    for (const id of newlyDone) {
      if (hasPendingPromptForEmail(id)) continue;
      const email = allEmails.find((e) => e.id === id);
      if (!email) continue;
      const linked = findLinkedTaskForEmail(id, manualTaskList, linkedDocTasks);
      if (linked && !linked.done) {
        requestLinkedTaskPrompt({
          mode: 'email-done',
          emailId: id,
          emailSubject: email.subject,
          taskId: linked.id,
          taskTitle: linked.title,
          taskSource: linked.source,
        });
        continue;
      }
      // No doc/manual link — check inbox-prompted tasks. If there are
      // open prompted tasks for this email, ask about the most
      // recently created one. Sort explicitly so we don't depend on
      // store insertion order.
      const prompted = getPromptedTasksForEmail(id)
        .filter((t) => !t.done)
        .sort((a, b) => b.createdAt - a.createdAt);
      if (prompted.length > 0) {
        const t = prompted[0];
        requestLinkedTaskPrompt({
          mode: 'email-done',
          emailId: id,
          emailSubject: email.subject,
          taskId: t.id,
          taskTitle: t.title,
          taskSource: 'prompt',
        });
      }
    }
  }, [acknowledged, archived, linkedDocTasks, manualTaskList]);

  // Handlers wired into the modal — route by source to the right store.
  const handleCompleteLinkedTask = (
    taskId: string,
    source: 'manual' | 'doc' | 'prompt',
    emailId: number,
  ) => {
    if (source === 'doc') {
      setLinkedDocDone(emailId, true);
    } else if (source === 'prompt') {
      setPromptedTaskDone(taskId, true);
    } else {
      // Mark the manual override done and clear any kept-open note
      // that might have been attached on a previous round.
      setManualTaskDone(taskId, true);
      setManualTaskNote(taskId, null);
    }
  };

  const handleKeepTaskOpenWithNote = (
    taskId: string,
    source: 'manual' | 'doc' | 'prompt',
    emailId: number,
    note: string,
  ) => {
    if (source === 'doc') {
      setLinkedDocNote(emailId, note);
    } else if (source === 'prompt') {
      // Prompted tasks don't carry a note field today; keeping it open
      // is the default "No" behaviour. The note is intentionally
      // ignored — we just need the task to remain visible in Tasks tab.
      void note;
    } else {
      setManualTaskNote(taskId, note);
    }
  };

  const handleCompleteEmailFromPrompt = (emailId: number) => {
    acknowledgeEmail(emailId);
    archiveEmail(emailId, 'done');
  };

  // Show the weekly setup modal only once hydration has finished
  // and the server has nothing for this week. The 600ms grace
  // matches the old behaviour: a brief delay so the page doesn't
  // pop a modal the instant it mounts. weekHydrated comes from
  // the reactive hook so the null→null transition (loading →
  // hydrated-empty) still re-runs this effect.
  useEffect(() => {
    if (weekSetup) return;
    if (!weekHydrated) return;
    const t = setTimeout(() => setShowWeeklySetup(true), 600);
    return () => clearTimeout(t);
  }, [weekKey, weekSetup, weekHydrated]);

  const handleWeeklySetupComplete = (hours: number, days: string[], plan: GeneratedPlan | null, sessionLengthMin: number) => {
    const setup: WeekSetup = { hours, days, plan, sessionLengthMin };
    setWeekSetupInternal(weekKey, setup);
    setShowWeeklySetup(false);
    if (plan) setActiveTab('Weekly Plan');
  };

  // Use functional updaters here so two rapid edits to the same
  // week (e.g. regenerate plan + change availability fired in the
  // same tick) merge against the latest cached snapshot rather
  // than a stale captured closure.
  const handlePlanGenerated = (plan: GeneratedPlan) => {
    updateWeekSetupInternal(weekKey, prev => (prev ? { ...prev, plan } : prev ?? { hours: 0, days: [], plan }));
  };

  const handleUpdateAvailability = (hours: number, days: string[], minutesByDay?: Record<string, number>) => {
    updateWeekSetupInternal(weekKey, prev => ({
      hours,
      days,
      plan: prev?.plan ?? null,
      sessionLengthMin: prev?.sessionLengthMin,
      minutesByDay,
    }));
  };

  const handleWeeklySetupDismiss = () => {
    setShowWeeklySetup(false);
  };

  const addTask = () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    addSidebarTaskInternal(title, parseInt(newTaskMins) || 15, newTaskPriority);
    setNewTaskTitle('');
    setNewTaskMins('15');
    setNewTaskPriority('normal');
    setAddingTask(false);
  };

  const removeTask = (id: string) => {
    removeSidebarTaskInternal(id);
  };

  const toggleTask = (id: string) => {
    toggleSidebarTaskInternal(id);
  };

  // Toggle a manual task's done flag via the override store. We read
  // the current merged value (seed + override) to decide which way to
  // flip — relying on the store's internal map alone would treat any
  // task without an override as "done=false" even if the seed record
  // ships as already done.
  const toggleManualTask = (id: string) => {
    const current = manualTaskList.find((t) => t.id === id);
    setManualTaskDone(id, !(current?.done ?? false));
  };

  const addSidebarTask = (title: string, mins: number, priority: 'high' | 'normal') => {
    addSidebarTaskInternal(title, mins, priority);
  };

  const renderTab = () => {
    switch (activeTab) {
      case 'Home': return <HomeTab sidebarTasks={sidebarTasks} onToggleSidebarTask={toggleTask} manualTasks={manualTaskList} weekSetup={weekSetup} onUpdateAvailability={handleUpdateAvailability} onNavigate={setActiveTab} onOpenEmail={(id) => { setOpenEmailId(id); setActiveTab("Emails"); }} />;
      case 'Emails': return <InboxTab key={openEmailId ?? 'default'} initialSelectedId={openEmailId} />;
      case 'Archive': return <ArchiveTab />;
      case 'High-Risk Patients': return <HighRiskTab onNavigate={setActiveTab} onOpenEmail={(id) => { setOpenEmailId(id); setActiveTab("Emails"); }} />;
      case 'Backlog Recovery': return <CatchUpTab />;
      case 'Forecast': return <ForecastTab weekSetup={weekSetup} plan={weekSetup?.plan ?? null} onOpenWeeklySetup={() => setShowWeeklySetup(true)} />;
      case 'Templates': return <StyleTab />;
      case 'Weekly Plan': return <WeeklyPlanTab weekSetup={weekSetup} plan={weekSetup?.plan ?? null} onPlanGenerated={handlePlanGenerated} onOpenWeeklySetup={() => setShowWeeklySetup(true)} />;
      case 'Calendar': return <CalendarTab weekSetup={weekSetup} manualTasks={manualTaskList} onOpenEmail={(id) => { setOpenEmailId(id); setActiveTab("Emails"); }} onNavigate={setActiveTab} onOpenWeeklySetup={() => setShowWeeklySetup(true)} onUpdateAvailability={handleUpdateAvailability} />;
      case 'Tasks': return (
        <TasksTab
          manualTasks={manualTaskList}
          sidebarTasks={sidebarTasks}
          onToggleManualTask={toggleManualTask}
          onToggleSidebarTask={toggleTask}
          onRemoveSidebarTask={removeTask}
          onAddSidebarTask={addSidebarTask}
          onNavigate={setActiveTab}
          onOpenEmail={(id) => { setOpenEmailId(id); setActiveTab("Emails"); }}
        />
      );
      case 'Settings': return <SettingsTab />;
      default: return <HomeTab sidebarTasks={sidebarTasks} onToggleSidebarTask={toggleTask} manualTasks={manualTaskList} weekSetup={weekSetup} onUpdateAvailability={handleUpdateAvailability} onNavigate={setActiveTab} onOpenEmail={(id) => { setOpenEmailId(id); setActiveTab("Emails"); }} />;
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden font-sans">

      {showWeeklySetup && (
        <WeeklySetupModal
          onComplete={handleWeeklySetupComplete}
          onDismiss={handleWeeklySetupDismiss}
        />
      )}

      <LinkedTaskPromptModal
        onCompleteTask={handleCompleteLinkedTask}
        onKeepTaskOpenWithNote={handleKeepTaskOpenWithNote}
        onCompleteEmail={handleCompleteEmailFromPrompt}
      />

      {/* Sidebar */}
      <aside className="w-56 border-r border-sidebar-border bg-sidebar flex flex-col">
        {/* Logo */}
        <div className="p-5 border-b border-sidebar-border">
          <h1 className="text-xl font-bold text-primary flex items-center gap-2">
            <span className="bg-primary text-white p-1 rounded text-sm">CA</span>
            ClinAdmin
          </h1>
          <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wider font-semibold">CAMHS Dashboard</p>
        </div>

        {/* Nav */}
        <nav className="p-3 space-y-0.5 border-b border-sidebar-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium",
                activeTab === tab.id
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
              data-testid={`tab-${tab.id.toLowerCase().replace(/[\s-]/g, '-')}`}
            >
              <tab.icon size={16} />
              {tab.label}
              {tab.id === 'Emails' && (
                <span className="ml-auto bg-primary-foreground text-primary text-[10px] px-1.5 py-0.5 rounded-full font-bold">{allEmails.filter(e => !isOutOfInbox(e.id)).length}</span>
              )}
              {tab.id === 'Archive' && archived.size > 0 && (
                <span className="ml-auto bg-slate-200 text-slate-700 text-[10px] px-1.5 py-0.5 rounded-full font-bold">{archived.size}</span>
              )}
              {tab.id === 'High-Risk Patients' && allEmails.filter(e => e.risk === 'high' && !isOutOfInbox(e.id)).length > 0 && (
                <span className="ml-auto bg-destructive text-destructive-foreground text-[10px] px-1.5 py-0.5 rounded-full font-bold animate-pulse">{allEmails.filter(e => e.risk === 'high' && !isOutOfInbox(e.id)).length}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Manual Tasks Section */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-3">
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-2">
                <ClipboardList size={13} className="text-muted-foreground" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Manual Tasks</span>
              </div>
              <button
                onClick={() => setAddingTask(v => !v)}
                className={cn(
                  "w-5 h-5 rounded flex items-center justify-center transition-colors",
                  addingTask ? "bg-primary text-white" : "hover:bg-sidebar-accent text-muted-foreground"
                )}
                title="Add task"
              >
                {addingTask ? <X size={11} /> : <Plus size={11} />}
              </button>
            </div>

            {addingTask && (
              <div className="mb-2 bg-sidebar-accent/40 rounded-lg p-2 space-y-1.5">
                <input
                  autoFocus
                  type="text"
                  value={newTaskTitle}
                  onChange={e => setNewTaskTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addTask(); if (e.key === 'Escape') setAddingTask(false); }}
                  placeholder="Task description..."
                  className="w-full text-xs bg-white border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/60"
                />
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      value={newTaskMins}
                      onChange={e => setNewTaskMins(e.target.value)}
                      className="w-full text-xs bg-white border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">min</span>
                  </div>
                  <select
                    value={newTaskPriority}
                    onChange={e => setNewTaskPriority(e.target.value as 'high' | 'normal')}
                    className="text-xs bg-white border border-border rounded px-1.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <button
                  onClick={addTask}
                  disabled={!newTaskTitle.trim()}
                  className="w-full bg-primary text-white text-xs font-bold py-1.5 rounded transition-colors hover:bg-primary/90 disabled:opacity-40"
                >
                  Add to plan
                </button>
              </div>
            )}

            <ul className="space-y-0.5">
              {sidebarTasks.length === 0 && (
                <li className="text-[11px] text-muted-foreground text-center py-3 italic">No tasks yet</li>
              )}
              {sidebarTasks.map(task => (
                <li key={task.id} className="flex items-start gap-2 px-1 py-1.5 rounded-md hover:bg-sidebar-accent/50 group">
                  <button
                    onClick={() => toggleTask(task.id)}
                    className={cn(
                      "mt-0.5 w-3.5 h-3.5 rounded-sm border flex-shrink-0 flex items-center justify-center transition-colors",
                      task.done ? "bg-primary border-primary" : "border-muted-foreground/40"
                    )}
                  >
                    {task.done && <span className="text-white text-[8px] font-bold">✓</span>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-[11px] leading-snug", task.done ? "line-through text-muted-foreground" : "text-sidebar-foreground")}>
                      {task.title}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">{task.estMin}min</span>
                      {task.priority === 'high' && (
                        <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1 rounded">HIGH</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => removeTask(task.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive mt-0.5"
                  >
                    <X size={11} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Profile */}
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-2 py-2.5 bg-sidebar-accent/50 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
              DM
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-semibold truncate">Dr. Morgan</p>
              <p className="text-[10px] text-muted-foreground truncate uppercase font-medium">CAMHS Consultant</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6 z-10 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-primary">ClinAdmin</span>
            <span className="text-xs text-muted-foreground font-medium">CAMHS Dashboard</span>
          </div>
          <div className="flex items-center gap-3">
            <ProfileMenu onOpenSettings={() => setActiveTab('Settings')} />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-background p-6">
          <div className="max-w-7xl mx-auto">
            {renderTab()}
          </div>
        </div>
      </main>
    </div>
  );
}

function ProfileMenu({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 rounded-full bg-primary/10 border border-border flex items-center justify-center text-primary hover:bg-primary/20 transition-colors"
        data-testid="button-profile"
        aria-label="Profile menu"
      >
        <User size={16} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <p className="text-sm font-bold">Dr. A. Patterson</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Consultant Child Psychiatrist · CAMHS Outpatient</p>
          </div>
          <div className="py-1">
            <button
              onClick={() => {
                onOpenSettings();
                setOpen(false);
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors text-left"
              data-testid="profile-settings"
            >
              <Settings size={15} className="text-muted-foreground" />
              Settings
            </button>
            <button
              disabled
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground/60 cursor-not-allowed text-left"
              title="Connect your Microsoft account first"
              data-testid="profile-signout"
            >
              <LogOut size={15} />
              <span className="flex-1">Sign out</span>
              <span className="text-[9px] uppercase tracking-wider bg-muted text-muted-foreground/70 px-1.5 py-0.5 rounded">Soon</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
