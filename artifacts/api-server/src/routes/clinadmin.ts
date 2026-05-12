import { Router } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { AiCompleteBody } from "@workspace/api-zod";

const router = Router();

const CLINADMIN_SYSTEM = `You are a clinical admin AI for an NHS CAMHS outpatient clinician. 
PRIORITY CATEGORIES: Urgent clinical, Unsafe to answer by email, Professional — high priority (any clinical colleague: psychologist, psychiatrist, GP, paediatrician, nurse, OT, CAMHS/CHYMS/CYPMHS team, social worker, LAC team), Needs clinician review, Meeting / event deadline, Medico-legal, Admin only, No action required, Low priority.
Always be concise, professional, and clinically aware. British English only.`;

router.post("/clinadmin/ai/complete", async (req, res) => {
  const parsed = AiCompleteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { prompt, systemPrompt, maxTokens } = parsed.data;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens ?? 8192,
      system: systemPrompt ?? CLINADMIN_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    const block = message.content[0];
    const text = block.type === "text" ? block.text : "";
    res.json({ text });
  } catch (err) {
    req.log.error({ err }, "AI completion failed");
    res.status(500).json({ error: "AI completion failed" });
  }
});

interface EmailInput {
  id: number;
  from: string;
  subject: string;
  risk: string;
  cat: string;
  deadline: number | null;
  estMin: number;
}

interface TaskInput {
  id: string;
  title: string;
  estMin: number;
  priority: string;
}

interface LinkedTaskInput {
  emailId: number;
  taskId: string;
  title: string;
  estMin: number;
  isLinkedDoc: boolean;
}

interface WeeklyPlanInput {
  hours: number;
  days: string[];
  minutesByDay?: Record<string, number>;
  emails: EmailInput[];
  tasks: TaskInput[];
  linkedTasks?: LinkedTaskInput[];
}

function isWeeklyPlanInput(body: unknown): body is WeeklyPlanInput {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b["hours"] === "number" &&
    Array.isArray(b["days"]) &&
    Array.isArray(b["emails"]) &&
    Array.isArray(b["tasks"])
  );
}

type PlanBlockCategory =
  | "urgent"
  | "clinical"
  | "admin"
  | "meeting"
  | "professional"
  | "legal"
  | "task";

interface PlanBlock {
  task: string;
  min: number;
  category: PlanBlockCategory;
  reason: string;
}

interface PlanDay {
  day: string;
  totalMin: number;
  blocks: PlanBlock[];
}

// Lower number = higher priority. Used to sort emails for packing.
function emailRank(e: EmailInput): number {
  if (e.risk === "high") return 0;
  const cat = e.cat?.toUpperCase() ?? "";
  if (cat === "URGENT_CLINICAL" || cat === "SAFEGUARDING") return 0;
  if (cat === "CLINICAL") return 1;
  if (cat === "LEGAL") return 2;
  if (cat === "PROFESSIONAL") return 3;
  if (cat === "ADMIN") return 5;
  return 4;
}

function emailCategory(e: EmailInput): PlanBlockCategory {
  if (e.risk === "high") return "urgent";
  const cat = e.cat?.toUpperCase() ?? "";
  if (cat === "LEGAL") return "legal";
  if (cat === "PROFESSIONAL") return "professional";
  if (cat === "CLINICAL" || cat === "URGENT_CLINICAL" || cat === "SAFEGUARDING")
    return "clinical";
  if (cat === "MEETING") return "meeting";
  return "admin";
}

function emailReason(e: EmailInput): string {
  if (e.risk === "high")
    return "High-risk — phone call, do not reply by email.";
  const cat = e.cat?.toUpperCase() ?? "";
  if (cat === "SAFEGUARDING") return "Safeguarding — escalate today.";
  if (cat === "LEGAL") return "Medico-legal — fixed deadline.";
  if (cat === "URGENT_CLINICAL") return "Same-day clinical action required.";
  if (cat === "CLINICAL") return "Clinical reply needed.";
  if (cat === "PROFESSIONAL") return "Colleague awaiting clinical input.";
  if (cat === "MEETING") return "Meeting / event deadline.";
  return "Routine admin reply.";
}

router.post("/clinadmin/weekly-plan", async (req, res) => {
  if (!isWeeklyPlanInput(req.body)) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { hours, days, emails, tasks } = req.body;
  const minutesByDay = req.body.minutesByDay ?? {};
  const linkedTasks = req.body.linkedTasks ?? [];

  if (days.length === 0) {
    res.status(400).json({ error: "At least one admin day is required" });
    return;
  }

  // ---- Per-day capacity ----
  // Honour per-day overrides when provided; otherwise split the weekly
  // total evenly. Reserve 20% of each day as buffer for unexpected urgent
  // emails — packing fills only the remaining 80%.
  const totalWeeklyMins = Math.round(hours * 60);
  const evenSplit = Math.round(totalWeeklyMins / days.length);
  const dayCap: Record<string, number> = {};
  const dayUsable: Record<string, number> = {};
  const dayBuffer: Record<string, number> = {};
  for (const d of days) {
    const cap =
      typeof minutesByDay[d] === "number" ? minutesByDay[d] : evenSplit;
    dayCap[d] = cap;
    const usable = Math.floor(cap * 0.8);
    dayUsable[d] = usable;
    dayBuffer[d] = cap - usable;
  }

  // ---- Build the email packing units ----
  // Each unit may be paired with a linked task. The pair must always be
  // scheduled on the same day; if the combined size doesn't fit the day,
  // we move on to the next day rather than splitting them.
  const linkByEmailId = new Map<number, LinkedTaskInput>();
  for (const lt of linkedTasks) linkByEmailId.set(lt.emailId, lt);

  const sortedEmails = [...emails].sort((a, b) => {
    const ra = emailRank(a);
    const rb = emailRank(b);
    if (ra !== rb) return ra - rb;
    const da = a.deadline ?? 99;
    const db = b.deadline ?? 99;
    return da - db;
  });

  const dayBlocks: Record<string, PlanBlock[]> = Object.fromEntries(
    days.map((d) => [d, [] as PlanBlock[]]),
  );
  const dayUsed: Record<string, number> = Object.fromEntries(
    days.map((d) => [d, 0]),
  );
  const deferred: string[] = [];

  for (const e of sortedEmails) {
    const link = linkByEmailId.get(e.id);
    // For auto-detected document tasks, the email's estMin already
    // includes the 20/30 min document block — combined = email.estMin.
    // For hand-authored linked tasks, both estimates are independent.
    const combinedMin = link
      ? link.isLinkedDoc
        ? e.estMin
        : e.estMin + link.estMin
      : e.estMin;

    let placedDay: string | null = null;
    for (const d of days) {
      if (dayUsed[d] + combinedMin <= dayUsable[d]) {
        placedDay = d;
        break;
      }
    }
    if (!placedDay) {
      const label = link
        ? `${e.subject} + linked ${
            link.isLinkedDoc ? "document" : "task"
          } (~${combinedMin}min)`
        : `${e.subject} (~${combinedMin}min)`;
      deferred.push(
        `${label} — moved to next week (no day has room for the full pair).`,
      );
      continue;
    }

    if (link?.isLinkedDoc) {
      // Combined block — the doc and the reply are one piece of work.
      dayBlocks[placedDay].push({
        task: `Reply + document: ${e.subject}`,
        min: combinedMin,
        category: "task",
        reason: `${emailReason(e)} Includes writing the linked document.`,
      });
    } else {
      // Standard email block, possibly followed by a paired task block.
      dayBlocks[placedDay].push({
        task: `Reply: ${e.subject}`,
        min: e.estMin,
        category: emailCategory(e),
        reason: emailReason(e),
      });
      if (link) {
        dayBlocks[placedDay].push({
          task: link.title,
          min: link.estMin,
          category: "task",
          reason: `Linked to "${e.subject}" above — kept on the same day.`,
        });
      }
    }
    dayUsed[placedDay] += combinedMin;
  }

  // ---- Pack standalone (un-linked) manual tasks ----
  const linkedTaskIds = new Set(linkedTasks.map((lt) => lt.taskId));
  const standalone = tasks.filter((t) => !linkedTaskIds.has(t.id));
  const sortedTasks = [...standalone].sort((a, b) => {
    const pa = a.priority === "high" ? 0 : 1;
    const pb = b.priority === "high" ? 0 : 1;
    return pa - pb;
  });
  for (const t of sortedTasks) {
    let placedDay: string | null = null;
    for (const d of days) {
      if (dayUsed[d] + t.estMin <= dayUsable[d]) {
        placedDay = d;
        break;
      }
    }
    if (!placedDay) {
      deferred.push(`${t.title} (~${t.estMin}min) — deferred to next week.`);
      continue;
    }
    dayBlocks[placedDay].push({
      task: t.title,
      min: t.estMin,
      category: "task",
      reason:
        t.priority === "high"
          ? "High-priority task."
          : "Scheduled admin task.",
    });
    dayUsed[placedDay] += t.estMin;
  }

  // ---- Compose the response ----
  const planDays: PlanDay[] = days.map((d) => ({
    day: d,
    totalMin: dayUsed[d],
    blocks: dayBlocks[d],
  }));

  const docs = linkedTasks.filter((lt) => lt.isLinkedDoc);
  const docSummary = {
    count: docs.length,
    mins: docs.reduce((a, lt) => a + lt.estMin, 0),
  };

  const bufferMin = days.reduce((a, d) => a + dayBuffer[d], 0);

  const highRiskCount = emails.filter((e) => e.risk === "high").length;
  const safetyNote =
    deferred.length === 0
      ? `${highRiskCount} high-risk email${
          highRiskCount === 1 ? "" : "s"
        } scheduled within the first available day; no 14-day KPI breaches projected.`
      : `${deferred.length} item${
          deferred.length === 1 ? "" : "s"
        } deferred to next week — review the deferred list for KPI risk before closing the week.`;

  res.json({
    plan: {
      days: planDays,
      deferredItems: deferred,
      safetyNote,
      docSummary,
      bufferMin,
    },
  });
});

export default router;
