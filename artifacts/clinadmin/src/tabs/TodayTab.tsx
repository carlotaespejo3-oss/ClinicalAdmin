import { cn } from '@/lib/utils';
import { AlertTriangle, Clock, Inbox, FileText, BarChart3, TrendingDown, CheckCircle, CalendarDays } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { weekHistory, emails, CAT } from '@/lib/data';
import { fmtTime } from '@/lib/utils';
import { useAcknowledgedEmails } from '@/lib/acknowledgedStore';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';

export default function TodayTab() {
  const acknowledged = useAcknowledgedEmails();
  const activeEmails = emails.filter(e => !acknowledged.has(e.id));
  const inboxCount = activeEmails.length;
  const highRiskCount = activeEmails.filter(e => e.risk === 'high').length;
  const pendingDraftCount = activeEmails.filter(e => e.cat === CAT.UNSAFE || e.cat === CAT.REVIEW).length;
  const clearMinutes = activeEmails.reduce((a, e) => a + e.estMin, 0);
  const clearLabel = clearMinutes >= 60
    ? `${Math.floor(clearMinutes / 60)}h ${clearMinutes % 60}m`
    : `${clearMinutes}m`;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Safety Bar */}
      {highRiskCount > 0 && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="text-destructive" size={20} />
          <p className="text-sm font-bold text-destructive">
            SAFETY ALERT: {highRiskCount} {highRiskCount === 1 ? 'item requires' : 'items require'} immediate clinical oversight to maintain patient safety.
          </p>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: "Today's Inbox", val: String(inboxCount), icon: Inbox, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "High Risk", val: String(highRiskCount), icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50" },
          { label: "Pending Drafts", val: String(pendingDraftCount), icon: FileText, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "Time to Clear", val: clearLabel, icon: Clock, color: "text-green-600", bg: "bg-green-50" },
          { label: "Admin Days", val: "Tue/Wed/Thu", icon: CalendarDays, color: "text-purple-600", bg: "bg-purple-50" },
        ].map((m, i) => (
          <Card key={i} className="border-border/50 shadow-sm">
            <CardContent className="p-4 flex flex-col items-center text-center">
              <div className={cn("p-2 rounded-lg mb-2", m.bg, m.color)}>
                <m.icon size={20} />
              </div>
              <p className="text-xl font-bold">{m.val}</p>
              <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">{m.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Drafts & Tasks */}
        <div className="lg:col-span-7 space-y-6">
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText size={18} className="text-primary" />
                Drafts Ready for Review
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {[
                  { to: "Dr. Martinez (GP)", sub: "James Okafor clinical update", time: "Drafted 10m ago" },
                  { to: "Linda Foster", sub: "Appointment clarification", time: "Drafted 25m ago" }
                ].map((d, i) => (
                  <div key={i} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                    <div className="overflow-hidden">
                      <p className="text-sm font-bold truncate">{d.to}</p>
                      <p className="text-xs text-muted-foreground truncate">{d.sub}</p>
                    </div>
                    <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                      <span className="text-[10px] font-medium text-muted-foreground">{d.time}</span>
                      <button className="text-[10px] font-bold bg-primary/10 text-primary px-3 py-1.5 rounded hover:bg-primary/20 transition-colors uppercase tracking-tight">Review</button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle size={18} className="text-primary" />
                Task Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {[
                  { label: "New Clinical (Last 24h)", val: "5 items", time: "55min" },
                  { label: "Pending Clinical Review", val: "2 items", time: "30min" },
                  { label: "Approaching KPI Deadline (14d)", val: "2 items", time: "15min" },
                  { label: "Admin/Other", val: "4 items", time: "20min" },
                ].map((t, i) => (
                  <div key={i} className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">{t.label}</p>
                      <p className="text-xs text-muted-foreground">{t.val}</p>
                    </div>
                    <span className="text-xs font-bold text-muted-foreground bg-muted px-2 py-1 rounded">{t.time}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Progress & Charts */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="border-border/50 shadow-sm overflow-hidden">
            <CardHeader className="bg-muted/30 pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingDown size={18} className="text-primary" />
                Backlog Progress
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 text-center">
              <div className="relative inline-flex items-center justify-center">
                <svg className="w-32 h-32 transform -rotate-90">
                  <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-muted" />
                  <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="12" fill="transparent" strokeDasharray={364.4} strokeDashoffset={364.4 * 0.28} className="text-primary" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold">72%</span>
                  <span className="text-[10px] text-muted-foreground uppercase font-bold">Clear</span>
                </div>
              </div>
              <p className="mt-4 text-sm font-medium">10/36 backlog items remaining</p>
              <p className="text-xs text-muted-foreground mt-1">Estimated 2.5h to total clearance.</p>
            </CardContent>
          </Card>

          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 size={18} className="text-primary" />
                Weekly Workload History
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekHistory}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="week" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                    <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="high" stackId="a" fill="#EF4444" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="medium" stackId="a" fill="#FB923C" />
                    <Bar dataKey="low" stackId="a" fill="#3B82F6" />
                    <Bar dataKey="admin" stackId="a" fill="#94A3B8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 flex flex-wrap gap-4 justify-center">
                {[
                  { label: "High", color: "bg-red-500" },
                  { label: "Medium", color: "bg-orange-400" },
                  { label: "Low", color: "bg-blue-500" },
                  { label: "Admin", color: "bg-slate-400" },
                ].map((l, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <div className={cn("w-2.5 h-2.5 rounded-full", l.color)}></div>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase">{l.label}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

