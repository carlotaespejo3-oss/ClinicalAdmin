import { useState } from 'react';
import { Home, Calendar, Mail, AlertTriangle, Clock, CalendarDays, PenTool, RefreshCcw, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import HomeTab from '../tabs/HomeTab';
import TodayTab from '../tabs/TodayTab';
import InboxTab from '../tabs/InboxTab';
import HighRiskTab from '../tabs/HighRiskTab';
import TimelineTab from '../tabs/TimelineTab';
import WeeklyPlanTab from '../tabs/WeeklyPlanTab';
import StyleTab from '../tabs/StyleTab';
import CatchUpTab from '../tabs/CatchUpTab';
import { TabType } from '@/lib/types';

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

export default function ClinAdmin() {
  const [activeTab, setActiveTab] = useState<TabType>('Home');

  const renderTab = () => {
    switch (activeTab) {
      case 'Home': return <HomeTab />;
      case 'Today': return <TodayTab />;
      case 'Inbox': return <InboxTab />;
      case 'High Risk': return <HighRiskTab />;
      case 'Timeline': return <TimelineTab />;
      case 'Weekly Plan': return <WeeklyPlanTab />;
      case 'My Style': return <StyleTab />;
      case 'Catch-up': return <CatchUpTab />;
      default: return <HomeTab />;
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-sidebar-border bg-sidebar flex flex-col">
        <div className="p-6 border-b border-sidebar-border">
          <h1 className="text-xl font-bold text-primary flex items-center gap-2">
            <span className="bg-primary text-white p-1 rounded">CA</span>
            ClinAdmin
          </h1>
          <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider font-semibold">CAMHS Dashboard</p>
        </div>
        
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
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
              <tab.icon size={18} />
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

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-2 py-3 bg-sidebar-accent/50 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white font-bold text-xs">
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
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold">{activeTab}</h2>
          </div>
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
          <div className="max-w-7xl mx-auto h-full">
            {renderTab()}
          </div>
        </div>
      </main>
    </div>
  );
}
