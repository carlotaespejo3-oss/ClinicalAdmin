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

export default router;
