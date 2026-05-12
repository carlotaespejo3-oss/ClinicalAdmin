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

interface WeeklyPlanInput {
  hours: number;
  days: string[];
  emails: EmailInput[];
  tasks: TaskInput[];
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

router.post("/clinadmin/weekly-plan", async (req, res) => {
  if (!isWeeklyPlanInput(req.body)) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { hours, days, emails, tasks } = req.body;

  const emailLines = emails
    .map((e) => `  - [${e.risk.toUpperCase()}] ${e.from} | "${e.subject}" | deadline: ${e.deadline ?? "none"} days | ~${e.estMin}min | category: ${e.cat}`)
    .join("\n");

  const taskLines = tasks
    .map((t) => `  - [${t.priority.toUpperCase()}] ${t.title} | ~${t.estMin}min`)
    .join("\n");

  const perDayMin = days.length > 0 ? Math.round((hours * 60) / days.length) : hours * 60;

  const prompt = `Generate a day-by-day admin schedule for Dr. A. Patterson, NHS CAMHS Consultant.

AVAILABILITY: ${hours} hours total, across ${days.join(", ")} (approximately ${perDayMin}min per day).

INBOX (${emails.length} emails):
${emailLines}

MANUAL TASKS (${tasks.length} tasks):
${taskLines}

RULES:
1. Prioritise by clinical risk: high-risk emails must go first in the week (ideally day 1).
2. "Unsafe to answer by email" items must include a phone call note in the reason field.
3. Professional colleague emails go before admin.
4. Defer items that can safely wait until next week and list them in deferredItems.
5. Each day must not exceed ${perDayMin + 10}min total.
6. Keep each block reason concise (max 15 words).
7. Categories: urgent | clinical | admin | meeting | professional | legal | task
8. safetyNote: one sentence confirming no 14-day KPI breaches.

Return ONLY valid JSON (no markdown fences, no explanation) in this exact structure:
{
  "days": [
    {
      "day": "Tuesday",
      "totalMin": 75,
      "blocks": [
        { "task": "Review Mia Chen self-harm email", "min": 15, "category": "urgent", "reason": "Phone parent — do not reply by email." }
      ]
    }
  ],
  "deferredItems": ["MCA mandatory training (35 days)", "Appointment letter query (10 days)"],
  "safetyNote": "All high-risk items scheduled on day one; no 14-day breaches projected."
}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: CLINADMIN_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    const block = message.content[0];
    const raw = block.type === "text" ? block.text : "{}";

    let plan: unknown;
    try {
      plan = JSON.parse(raw);
    } catch {
      req.log.error({ raw }, "Failed to parse plan JSON from AI");
      res.status(500).json({ error: "AI returned invalid JSON" });
      return;
    }

    res.json({ plan });
  } catch (err) {
    req.log.error({ err }, "Weekly plan generation failed");
    res.status(500).json({ error: "Weekly plan generation failed" });
  }
});

export default router;
