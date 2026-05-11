import { useState, useEffect } from 'react';
import { Home, Calendar, Mail, AlertTriangle, Clock, CalendarDays, PenTool, RefreshCcw, Bell, Plus, X, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';
import HomeTab from '../tabs/HomeTab';
import TodayTab from '../tabs/TodayTab';
import InboxTab from '../tabs/InboxTab';
import HighRiskTab from '../tabs/HighRiskTab';
import TimelineTab from '../tabs/TimelineTab';
import WeeklyPlanTab from '../tabs/WeeklyPlanTab';
import StyleTab from '../tabs/StyleTab';
import CatchUpTab from '../tabs/CatchUpTab';
import WeeklySetupModal from '../components/WeeklySetupModal';
import { TabType, SidebarTask } from '@/lib/types';

export interface WeekSetup {
  hours: number;
  days: string[];
}

const tabs: { id: TabType; icon: any; label: string }[] = [
  { id: 'Home', icon: Home, label: 'Home' },
  { id: 'Today', icon: Calendar, label: 'Today' },
  { id: 'Inbox', icon: Mail, label: 'Inbox' },
  { id: 'High Risk', icon: AlertTriangle, label: 'High Risk' },
  { id: 'Timeline', icon: Clock, label: 'Timeline' },
  { id: 'Weekly Plan', icon: CalendarDays, label: 'Weekly Plan' },
  { id: 'My Style', icon: PenTool, label: 'My Style' },
  { id: 'Catch-up', icon: RefreshCcw, label: 'Catch-up' },
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
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskMins, setNewTaskMins] = useState('15');
  const [newTaskPriority, setNewTaskPriority] = useState<'high' | 'normal'>('normal');
  const [showWeeklySetup, setShowWeeklySetup] = useState(false);
  const [weekSetup, setWeekSetup] = useState<WeekSetup | null>(null);

  // Show weekly setup modal on first visit of the week
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

  const handleWeeklySetupComplete = (hours: number, days: string[]) => {
    const setup: WeekSetup = { hours, days };
    setWeekSetup(setup);
    setShowWeeklySetup(false);
    localStorage.setItem(getWeekKey(), JSON.stringify(setup));
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

  const renderTab = () => {
    switch (activeTab) {
      case 'Home': return <HomeTab sidebarTasks={sidebarTasks} onToggleSidebarTask={toggleTask} weekSetup={weekSetup} onOpenWeeklySetup={() => setShowWeeklySetup(true)} />;
      case 'Today': return <TodayTab />;
      case 'Inbox': return <InboxTab />;
      case 'High Risk': return <HighRiskTab />;
      case 'Timeline': return <TimelineTab />;
      case 'Weekly Plan': return <WeeklyPlanTab />;
      case 'My Style': return <StyleTab />;
      case 'Catch-up': return <CatchUpTab />;
      default: return <HomeTab sidebarTasks={sidebarTasks} onToggleSidebarTask={toggleTask} weekSetup={weekSetup} onOpenWeeklySetup={() => setShowWeeklySetup(true)} />;
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden font-sans">

      {/* Weekly Setup Modal */}
      {showWeeklySetup && (
        <WeeklySetupModal
          onComplete={handleWeeklySetupComplete}
          onDismiss={handleWeeklySetupDismiss}
        />
      )}

      {/* Sidebar */}
      <aside className="w-64 border-r border-sidebar-border bg-sidebar flex flex-col">
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
              data-testid={`tab-${tab.id.toLowerCase().replace(' ', '-')}`}
            >
              <tab.icon size={16} />
              {tab.label}
              {tab.id === 'Inbox' && (
                <span className="ml-auto bg-primary-foreground text-primary text-[10px] px-1.5 py-0.5 rounded-full font-bold">9</span>
              )}
              {tab.id === 'High Risk' && (
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
              AP
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-semibold truncate">Dr. A. Patterson</p>
              <p className="text-[10px] text-muted-foreground truncate uppercase font-medium">CAMHS Consultant</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6 z-10 shadow-sm">
          <h2 className="text-lg font-semibold">{activeTab}</h2>
          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-accent rounded-full text-muted-foreground transition-colors relative">
              <Bell size={18} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full border-2 border-card"></span>
            </button>
            <div className="h-4 w-[1px] bg-border mx-1"></div>
            <div className="text-right">
              <p className="text-xs font-semibold">NHS CAMHS Outpatient</p>
              <p className="text-[10px] text-muted-foreground">St. Jude's Hospital</p>
            </div>
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
