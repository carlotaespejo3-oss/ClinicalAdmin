import { AlertTriangle, AlertCircle, Clock, ChevronRight, Mail, Phone, ExternalLink, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { emails, CAT } from '@/lib/data';
import { cn } from '@/lib/utils';

export default function HighRiskTab() {
  const highRiskEmails = emails.filter(e => e.risk === 'high');

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="bg-[#FCEBEB] border border-red-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-red-100 text-red-600 rounded-full animate-pulse">
            <AlertTriangle size={24} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[#791F1F]">Safety Oversight Required</h3>
            <p className="text-sm text-[#791F1F]/80 mt-1 leading-relaxed">
              The following items have been flagged with high clinical risk based on keyword analysis (safeguarding, self-harm, crisis). 
              Please review these immediately before proceeding with other admin tasks.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {highRiskEmails.map((e) => (
          <Card key={e.id} className="border-l-8 border-l-red-500 border-border/50 shadow-md overflow-hidden hover:shadow-lg transition-shadow">
            <CardContent className="p-0">
              <div className="p-6">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-xl font-bold">{e.from.split(' ')[0]} {e.from.split(' ')[1]}</h4>
                      <span className="bg-red-100 text-red-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-widest">Critical</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{e.subject}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-muted-foreground uppercase">{e.date}</p>
                    <div className="flex gap-2 mt-2">
                      <span className="bg-purple-100 text-purple-700 text-[9px] font-bold px-2 py-1 rounded uppercase tracking-tight">Safeguarding</span>
                      <span className="bg-amber-100 text-amber-700 text-[9px] font-bold px-2 py-1 rounded uppercase tracking-tight">Crisis</span>
                    </div>
                  </div>
                </div>

                <div className="bg-muted/30 rounded-lg p-4 mb-6 text-sm italic border-l-2 border-muted leading-relaxed">
                  "{e.preview}..."
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock size={14} className="text-blue-600" />
                      <span className="text-[10px] font-bold text-blue-600 uppercase">Est. Review Time</span>
                    </div>
                    <p className="text-sm font-bold">15-20 minutes</p>
                  </div>
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertCircle size={14} className="text-amber-600" />
                      <span className="text-[10px] font-bold text-amber-600 uppercase">Recommended Action</span>
                    </div>
                    <p className="text-sm font-bold">Safeguarding triage call</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-center">
                    <button className="flex items-center gap-2 text-primary font-bold text-xs uppercase hover:underline">
                      Open Clinical Record <ExternalLink size={14} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-muted/20 border-t border-border p-4 flex justify-between items-center">
                <div className="flex gap-4">
                  <button className="flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors uppercase tracking-tight">
                    <Phone size={14} /> Log Call
                  </button>
                  <button className="flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors uppercase tracking-tight">
                    <Mail size={14} /> Notify Team
                  </button>
                </div>
                <button className="bg-primary text-white text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm hover:bg-primary/90 transition-colors uppercase tracking-tight">
                  Triage Complete <ChevronRight size={14} />
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="pt-8 border-t border-border flex flex-col items-center text-center max-w-2xl mx-auto">
        <div className="w-12 h-12 rounded-full bg-green-50 text-green-600 flex items-center justify-center mb-4">
          <CheckCircle2 size={24} />
        </div>
        <h4 className="font-bold">Patient Safety First</h4>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
          The high risk tab only shows items requiring immediate safety triage. 
          Once triaged, move them to your regular workflow to maintain clear visibility of outstanding risks.
        </p>
      </div>
    </div>
  );
}

import { CalendarDays } from 'lucide-react';
