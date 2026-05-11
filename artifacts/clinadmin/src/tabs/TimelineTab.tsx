import { useState } from 'react';
import { Calendar, Filter, Clock, AlertTriangle, Plus, ChevronRight, Trash2 } from 'lucide-react';
import { manualTasks, CAT } from '@/lib/data';
import { cn, fmtTime, riskDot, dlText, dlClass } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const filters = ['All', 'Clinical', 'Professional', 'Meetings', 'Admin', 'Manual tasks'];

export default function TimelineTab() {
  const [activeFilter, setActiveFilter] = useState('All');
  const [tasks, setTasks] = useState(manualTasks);
  const [showAdd, setShowAdd] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', type: 'Report', cat: CAT.REVIEW, deadline: 7, risk: 'none' });

  const addTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.title) return;
    const task = {
      ...newTask,
      id: `m${Date.now()}`,
      estMin: 30,
      risk: newTask.risk as 'high' | 'medium' | 'low' | 'none'
    };
    setTasks([...tasks, task]);
    setNewTask({ title: '', type: 'Report', cat: CAT.REVIEW, deadline: 7, risk: 'none' });
    setShowAdd(false);
  };

  const removeTask = (id: string) => {
    setTasks(tasks.filter(t => t.id !== id));
  };

  // Mock calendar strip
  const today = new Date();
  const calendarDays = Array.from({ length: 29 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i - 1);
    return {
      date: d,
      day: d.getDate(),
      weekday: d.toLocaleDateString('en-GB', { weekday: 'short' }),
      isToday: i === 1,
      hasTask: [2, 5, 8, 12].includes(i)
    };
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Calendar Strip */}
      <div className="bg-card border border-border shadow-sm rounded-xl p-4 overflow-hidden">
        <div className="flex items-center justify-between mb-4 px-2">
          <h3 className="font-bold flex items-center gap-2">
            <Calendar size={18} className="text-primary" />
            May 2024
          </h3>
          <div className="flex gap-2">
            <button className="p-1 hover:bg-muted rounded"><ChevronRight size={16} className="rotate-180" /></button>
            <button className="p-1 hover:bg-muted rounded"><ChevronRight size={16} /></button>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {calendarDays.map((d, i) => (
            <div 
              key={i} 
              className={cn(
                "flex-shrink-0 w-12 h-16 rounded-lg flex flex-col items-center justify-center transition-colors cursor-pointer",
                d.isToday ? "bg-primary text-white" : "hover:bg-muted"
              )}
            >
              <span className="text-[10px] font-bold uppercase">{d.weekday}</span>
              <span className="text-sm font-bold">{d.day}</span>
              {d.hasTask && !d.isToday && (
                <div className="mt-1 flex gap-0.5">
                  <div className="w-1 h-1 rounded-full bg-blue-400"></div>
                  <div className="w-1 h-1 rounded-full bg-amber-400"></div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {filters.map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-colors whitespace-nowrap",
                activeFilter === f ? "bg-primary text-white border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/50"
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <button 
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 bg-primary text-white text-[10px] font-bold px-4 py-2 rounded-lg shadow-sm hover:bg-primary/90 transition-colors uppercase tracking-widest"
        >
          <Plus size={14} /> Add Task
        </button>
      </div>

      {showAdd && (
        <Card className="border-primary/20 shadow-md animate-in slide-in-from-top-4 duration-300">
          <CardContent className="p-6">
            <form onSubmit={addTask} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase">Task Description</label>
                  <input 
                    autoFocus
                    value={newTask.title}
                    onChange={e => setNewTask({...newTask, title: e.target.value})}
                    type="text" 
                    placeholder="e.g. Sign off discharge letter..." 
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    data-testid="input-task-name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Type</label>
                    <select 
                      value={newTask.type}
                      onChange={e => setNewTask({...newTask, type: e.target.value})}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
                    >
                      <option>Report</option>
                      <option>Phone call</option>
                      <option>Letter</option>
                      <option>Meeting</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase">Priority</label>
                    <select 
                      value={newTask.risk}
                      onChange={e => setNewTask({...newTask, risk: e.target.value as any})}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
                    >
                      <option value="none">Normal</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAdd(false)} className="text-[10px] font-bold uppercase tracking-widest px-4 py-2 hover:bg-muted rounded-lg">Cancel</button>
                <button type="submit" className="bg-primary text-white text-[10px] font-bold px-4 py-2 rounded-lg shadow-sm hover:bg-primary/90 transition-colors uppercase tracking-widest">Create Task</button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Summary Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Overdue', val: '2', color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'Due Today', val: '4', color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Due This Week', val: '12', color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Total Outstanding', val: tasks.length.toString(), color: 'text-slate-600', bg: 'bg-slate-50' },
        ].map((s, i) => (
          <div key={i} className={cn("p-4 rounded-xl border border-border/50 shadow-sm", s.bg)}>
            <p className={cn("text-2xl font-bold", s.color)}>{s.val}</p>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Task Groups */}
      <div className="space-y-8">
        {[
          { label: 'Today', items: tasks.filter(t => t.deadline <= 1) },
          { label: 'This Week', items: tasks.filter(t => t.deadline > 1 && t.deadline <= 7) },
          { label: 'Later', items: tasks.filter(t => t.deadline > 7) },
        ].map((group, gi) => (
          <div key={gi} className="space-y-3">
            <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-2">{group.label}</h4>
            <div className="space-y-2">
              {group.items.length > 0 ? group.items.map((t) => (
                <div key={t.id} className="group bg-card border border-border/50 rounded-xl p-4 flex items-center justify-between hover:border-primary/50 transition-colors shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className={cn("w-2 h-2 rounded-full", riskDot(t.risk))}></div>
                    <div>
                      <p className="text-sm font-semibold">{t.title}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase bg-muted px-2 py-0.5 rounded">{t.type}</span>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
                          <Clock size={12} /> {fmtTime(t.estMin)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className={cn("text-[10px] font-bold px-2 py-1 rounded border uppercase tracking-wider", dlClass(t.deadline))}>
                      {dlText(t.deadline)}
                    </div>
                    <button 
                      onClick={() => removeTask(t.id)}
                      className="p-2 text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              )) : (
                <div className="p-8 text-center border-2 border-dashed border-border rounded-xl">
                  <p className="text-xs text-muted-foreground italic">No tasks scheduled for {group.label.toLowerCase()}</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
