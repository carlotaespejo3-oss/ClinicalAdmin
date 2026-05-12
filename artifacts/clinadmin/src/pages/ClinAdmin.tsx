import { useState, useEffect, useRef } from 'react';
import { Home, Mail, Shield, PenTool, RefreshCcw, Bell, Plus, X, ClipboardList, LayoutList, BarChart2, CheckSquare, Settings, User, CalendarDays, LogOut } from 'lucide-react';
import { cn, getEmailPriority, PRIORITY_PILL } from '@/lib/utils';
import { emails as allEmails } from '@/lib/data';
import HomeTab from '../tabs/HomeTab';
import TodayTab from '../tabs/TodayTab';
import InboxTab from '../tabs/InboxTab';
import HighRiskTab from '../tabs/HighRiskTab';
import TimelineTab from '../tabs/TimelineTab';
import WeeklyPlanTab from '../tabs/WeeklyPlanTab';
import StyleTab from '../tabs/StyleTab';
import CatchUpTab from '../tabs/CatchUpTab';
import TasksTab from '../tabs/TasksTab';
import SettingsTab from '../tabs/SettingsTab';
import WeeklySetupModal from '../components/WeeklySetupModal';
import { TabType, SidebarTask, ManualTask, GeneratedPlan } from '@/lib/types';
import { manualTasks as initialManualTasks } from '@/lib/data';

export interface WeekSetup {
  hours: number;
  days: string[];
  plan?: GeneratedPlan | null;
  sessionLengthMin?: number;
}

const tabs: { id: TabType; icon: any; label: string }[] = [
  { id: 'Home', icon: Home, label: 'Home' },
  { id: 'Detailed View', icon: LayoutList, label: 'Detailed View' },
  { id: 'Weekly Plan', icon: CalendarDays, label: 'Weekly Plan' },
  { id: 'Emails', icon: Mail, label: 'Emails' },
  { id: 'High-Risk Patients', icon: Shield, label: 'High-Risk Patients' },
  { id: 'Tasks', icon: CheckSquare, label: 'Tasks' },
  { id: 'Backlog Recovery', icon: RefreshCcw, label: 'Backlog Recovery' },
  { id: 'Forecast', icon: BarChart2, label: 'Forecast' },
  { id: 'Templates', icon: PenTool, label: 'Templates' },
  { id: 'Settings', icon: Settings, label: 'Settings' },
];

const defaultSidebarTasks: SidebarTask[] = [
  { id: 's1', title: 'ADHD assessment report — Zara Ali', estMin: 60, priority: 'normal', done: false },
  { id: 's2', title: 'Phone callback Dr. Osei re case formulation', estMin: 10, priority: 'high', done: false },
  { id: 's3', title: 'Sign off discharge letter — Thomas Wright', estMin: 10, priority: 'normal', done: false },
];

function getWeekKey() {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil((((d.getTime() - jan1.getTime()) / 86400000) + jan1.getDay() + 1) / 7);
  return `clinadmin-week-${d.getFullYear()}-${weekNum}`;
}

export default function ClinAdmin() {
  const [activeTab, setActiveTab] = useState<TabType>('Home');
  const [sidebarTasks, setSidebarTasks] = useState<SidebarTask[]>(defaultSidebarTasks);
  const [manualTaskList, setManualTaskList] = useState<ManualTask[]>(initialManualTasks);
  const [openEmailId, setOpenEmailId] = useState<number | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskMins, setNewTaskMins] = useState('15');
  const [newTaskPriority, setNewTaskPriority] = useState<'high' | 'normal'>('normal');
  const [showWeeklySetup, setShowWeeklySetup] = useState(false);
  const [weekSetup, setWeekSetup] = useState<WeekSetup | null>(null);

  useEffect(() => {
    const key = getWeekKey();
    const stored = localStorage.getItem(key);
    if (stored) {
      try { setWeekSetup(JSON.parse(stored)); } catch { setShowWeeklySetup(true); }
      return;
    }
    const t = setTimeout(() => setShowWeeklySetup(true), 600);
    return () => clearTimeout(t);
  }, []);

  const handleWeeklySetupComplete = (hours: number, days: string[], plan: GeneratedPlan | null, sessionLengthMin: number) => {
    const setup: WeekSetup = { hours, days, plan, sessionLengthMin };
    setWeekSetup(setup);
    setShowWeeklySetup(false);
    localStorage.setItem(getWeekKey(), JSON.stringify(setup));
    if (plan) setActiveTab('Weekly Plan');
  };

  const handlePlanGenerated = (plan: GeneratedPlan) => {
    setWeekSetup(prev => {
      if (!prev) return prev;
      const updated = { ...prev, plan };
      localStorage.setItem(getWeekKey(), JSON.stringify(updated));
      return updated;
    });
  };

  const handleUpdateAvailability = (hours: number, days: string[]) => {
    setWeekSetup(prev => {
      const updated: WeekSetup = {
        hours,
        days,
        plan: prev?.plan ?? null,
        sessionLengthMin: prev?.sessionLengthMin,
      };
      localStorage.setItem(getWeekKey(), JSON.stringify(updated));
      return updated;
    });
  };

  const handleWeeklySetupDismiss = () => {
    setShowWeeklySetup(false);
  };

  const addTask = () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    const task: SidebarTask = {
      id: `s${Date.now()}`,
      title,
      estMin: parseInt(newTaskMins) || 15,
      priority: newTaskPriority,
      done: false,
    };
    setSidebarTasks(prev => [...prev, task]);
    setNewTaskTitle('');
    setNewTaskMins('15');
    setNewTaskPriority('normal');
    setAddingTask(false);
  };

  const removeTask = (id: string) => {
    setSidebarTasks(prev => prev.filter(t => t.id !== id));
  };

  const toggleTask = (id: string) => {
    setSidebarTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  const toggleManualTask = (id: string) => {
    setManualTaskList(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  const addSidebarTask = (title: string, mins: number, priority: 'high' | 'normal') => {
    const task: SidebarTask = { id: `s${Date.now()}`, title, estMin: mins, priority, done: false };
    setSidebarTasks(prev => [...prev, task]);
  };

  const renderTab = () => {
    switch (activeTab) {
      case 'Home': return <HomeTab sidebarTasks={sidebarTasks} onToggleSidebarTask={toggleTask} manualTasks={manualTaskList} weekSetup={weekSetup} onOpenWeeklySetup={() => setShowWeeklySetup(true)} onUpdateAvailability={handleUpdateAvailability} onNavigate={setActiveTab} onOpenEmail={(id) => setOpenEmailId(id)} />;
      case 'Detailed View': return <TodayTab />;
      case 'Emails': return <InboxTab key={openEmailId ?? 'default'} initialSelectedId={openEmailId} />;
      case 'High-Risk Patients': return <HighRiskTab />;
      case 'Backlog Recovery': return <CatchUpTab />;
      case 'Forecast': return <TimelineTab />;
      case 'Templates': return <StyleTab />;
      case 'Weekly Plan': return <WeeklyPlanTab weekSetup={weekSetup} plan={weekSetup?.plan ?? null} onPlanGenerated={handlePlanGenerated} onOpenWeeklySetup={() => setShowWeeklySetup(true)} />;
      case 'Tasks': return (
        <TasksTab
          manualTasks={manualTaskList}
          sidebarTasks={sidebarTasks}
          onToggleManualTask={toggleManualTask}
          onToggleSidebarTask={toggleTask}
          onRemoveSidebarTask={removeTask}
          onAddSidebarTask={addSidebarTask}
          onNavigate={setActiveTab}
          onOpenEmail={(id) => setOpenEmailId(id)}
        />
      );
      case 'Settings': return <SettingsTab />;
      default: return <HomeTab sidebarTasks={sidebarTasks} onToggleSidebarTask={toggleTask} manualTasks={manualTaskList} weekSetup={weekSetup} onOpenWeeklySetup={() => setShowWeeklySetup(true)} onUpdateAvailability={handleUpdateAvailability} onNavigate={setActiveTab} onOpenEmail={(id) => setOpenEmailId(id)} />;
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
                <span className="ml-auto bg-primary-foreground text-primary text-[10px] px-1.5 py-0.5 rounded-full font-bold">9</span>
              )}
              {tab.id === 'High-Risk Patients' && (
                <span className="ml-auto bg-destructive text-destructive-foreground text-[10px] px-1.5 py-0.5 rounded-full font-bold animate-pulse">2</span>
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
            <button
              onClick={() => setActiveTab('Detailed View')}
              className="flex items-center gap-2 px-3 py-1.5 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              <LayoutList size={15} />
              Detailed view
            </button>
            <NotificationsBell
              onOpenEmail={(id) => {
                setOpenEmailId(id);
                setActiveTab('Emails');
              }}
            />
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

function NotificationsBell({ onOpenEmail }: { onOpenEmail: (id: number) => void }) {
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

  const items = allEmails
    .map((e) => ({ email: e, priority: getEmailPriority(e) }))
    .filter((x) => x.priority === 'High' || x.priority === 'Medium')
    .sort((a, b) => (a.priority === 'High' && b.priority !== 'High' ? -1 : 1))
    .slice(0, 6);

  const highCount = items.filter((x) => x.priority === 'High').length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 hover:bg-accent rounded-full text-muted-foreground transition-colors"
        data-testid="button-notifications"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {items.length > 0 && (
          <span className={cn(
            "absolute top-1.5 right-1.5 w-2 h-2 rounded-full border-2 border-card",
            highCount > 0 ? "bg-destructive" : "bg-amber-500"
          )} />
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-96 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Needs your attention</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {items.length === 0 ? 'Inbox is clear.' : `${items.length} item${items.length === 1 ? '' : 's'} flagged`}
            </p>
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-border">
            {items.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                Nothing high or medium priority right now.
              </div>
            ) : (
              items.map(({ email, priority }) => (
                <button
                  key={email.id}
                  onClick={() => {
                    onOpenEmail(email.id);
                    setOpen(false);
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
                  data-testid={`notification-${email.id}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-sm font-bold truncate">{email.from}</p>
                    <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0", PRIORITY_PILL[priority])}>
                      {priority}
                    </span>
                  </div>
                  <p className="text-xs font-semibold truncate">{email.subject}</p>
                  <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{email.preview}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
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
