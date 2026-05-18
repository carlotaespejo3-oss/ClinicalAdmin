import { Router } from "express";
import { promises as dns } from "node:dns";
import net from "node:net";
import { inArray, asc } from "drizzle-orm";
import { db, evidenceSourcesTable } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { AiCompleteBody, AiChatWithToolsBody } from "@workspace/api-zod";

const router = Router();

const CLINADMIN_SYSTEM = `You are a clinical admin AI for an NHS CAMHS outpatient clinician. 
PRIORITY CATEGORIES: Urgent clinical, Unsafe to answer by email, Professional — high priority (any clinical colleague: psychologist, psychiatrist, GP, paediatrician, nurse, OT, CAMHS/CHYMS/CYPMHS team, social worker, LAC team), Needs clinician review, Meeting / event deadline, Medico-legal, Admin only, No action required, Low priority.
Always be concise, professional, and clinically aware. British English only.`;

// ----------------------------------------------------------------------------
// Tool-use chat endpoint.
//
// The clinician's mini-chat now uses Anthropic tool-use so the model can
// actively look up content in the clinician's REGISTERED evidence sources
// rather than just being told their titles and asked to self-report what
// it consulted. Two tools:
//
//   search_registered_sources(query)  — fuzzy match across the registry by
//                                       name and title; returns matching
//                                       sources with id/title/year/tier/url.
//   fetch_source(source_id)           — fetch the live page text for one
//                                       registry id. The id MUST exist in
//                                       the registry — arbitrary URLs are
//                                       not allowed.
//
// Why this shape:
//   - Live fetch, never cache the body  → guideline updates flow through
//     automatically. Respects the storage rule (no clinical content
//     persisted — fetched on demand like email bodies from Graph).
//   - Registry-bounded fetch            → the model cannot wander off and
//     pull from Wikipedia or random PDFs. It can only read sources the
//     clinician has vetted and registered.
//   - Fetch failures returned as IDs    → the UI can surface them ("we
//     tried RCH but couldn't read it") instead of silently falling back
//     to training data dressed up as "general clinical knowledge".
// ----------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 6000;
const FETCH_MAX_BYTES = 600_000;
const FETCH_MAX_CHARS = 12_000;
const TOOL_LOOP_MAX_ITERS = 6;

function stripHtmlToText(html: string): string {
  // Best-effort HTML → plain text. Drops scripts/styles, strips tags,
  // decodes a handful of common entities, collapses whitespace. Good
  // enough for first-pass guideline scraping; some clinical sites will
  // still need a manual-excerpt fallback (see follow-up work).
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// SSRF guard: reject any hostname whose A/AAAA records resolve to a
// private, loopback, link-local, multicast or otherwise "internal"
// address. Registry URLs are clinician-curated, but a compromised or
// careless entry should not be allowed to probe internal infrastructure.
function isPrivateAddress(addr: string): boolean {
  const v = net.isIP(addr);
  if (v === 0) return true; // unresolvable → treat as private (deny)
  if (v === 4) {
    const parts = addr.split(".").map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  // IPv6 — block loopback, link-local, unique-local, multicast.
  const lc = addr.toLowerCase();
  if (lc === "::1" || lc === "::") return true;
  if (lc.startsWith("fe80:")) return true; // link-local
  if (lc.startsWith("fc") || lc.startsWith("fd")) return true; // unique-local
  if (lc.startsWith("ff")) return true; // multicast
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — recurse on the v4 portion.
  const mapped = lc.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return false;
}

async function isUrlSafeToFetch(rawUrl: string): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid url" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: `unsupported scheme ${parsed.protocol}` };
  }
  const host = parsed.hostname;
  if (!host) return { ok: false, reason: "no host" };
  // If host is a literal IP, check directly without DNS.
  if (net.isIP(host) !== 0) {
    return isPrivateAddress(host)
      ? { ok: false, reason: "private address" }
      : { ok: true };
  }
  // Resolve and reject if ANY address is private (defence against
  // DNS rebinding-style configurations and split-horizon DNS).
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `dns lookup failed: ${msg}` };
  }
  if (addrs.length === 0) return { ok: false, reason: "host has no addresses" };
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) {
      return { ok: false, reason: "resolves to private address" };
    }
  }
  return { ok: true };
}

async function fetchSourceText(url: string): Promise<
  | { ok: true; text: string }
  | { ok: false; reason: string }
> {
  // Manual redirect handling so we re-run the SSRF guard at every hop —
  // a public URL that redirects to a private one (intentional or not)
  // must not be followed.
  const MAX_HOPS = 4;
  let currentUrl = url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let resp: Response | null = null;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const safe = await isUrlSafeToFetch(currentUrl);
      if (!safe.ok) return { ok: false, reason: safe.reason };
      resp = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          // A plain UA — some sites 403 the default Node UA. We are
          // identifying as a clinical-tool fetcher, not pretending to be
          // a browser.
          "user-agent": "ClinAdmin/1.0 (+clinical evidence fetch)",
          accept: "text/html, application/xhtml+xml, text/plain, */*",
        },
      });
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get("location");
        if (!loc) return { ok: false, reason: `redirect with no location (HTTP ${resp.status})` };
        currentUrl = new URL(loc, currentUrl).toString();
        continue;
      }
      break;
    }
    if (!resp) return { ok: false, reason: "no response" };
    if (resp.status >= 300 && resp.status < 400) {
      return { ok: false, reason: "too many redirects" };
    }
    if (!resp.ok) {
      return { ok: false, reason: `HTTP ${resp.status}` };
    }
    // Cap body size — read up to FETCH_MAX_BYTES and stop. We don't
    // want a 50MB PDF blowing up the request.
    const reader = resp.body?.getReader();
    if (!reader) return { ok: false, reason: "empty response body" };
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < FETCH_MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    try { await reader.cancel(); } catch { /* ignore */ }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const contentType = resp.headers.get("content-type") ?? "";
    const raw = buf.toString("utf8");
    const text = contentType.includes("text/html")
      ? stripHtmlToText(raw)
      : raw.replace(/\s+/g, " ").trim();
    if (!text) return { ok: false, reason: "no readable text in response" };
    return { ok: true, text: text.slice(0, FETCH_MAX_CHARS) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg.includes("aborted") ? "timed out" : msg };
  } finally {
    clearTimeout(timer);
  }
}

interface RegistryRow {
  id: number;
  tier: number;
  sourceName: string;
  title: string;
  year: number;
  url: string;
  publiclyAccessible: boolean;
}

function renderRegistryForSystem(rows: RegistryRow[]): string {
  if (rows.length === 0) {
    return "(the clinician has not registered any evidence sources)";
  }
  const sorted = [...rows].sort((a, b) => a.tier - b.tier || b.year - a.year);
  return sorted
    .map((r) => {
      const acc = r.publiclyAccessible ? "public" : "restricted";
      return `  [${r.id}] tier ${r.tier} — ${r.sourceName} (${r.year}, ${acc}): ${r.title}`;
    })
    .join("\n");
}

const CHAT_TOOL_SYSTEM = (registryBlock: string) => `You are a clinical assistant for a CAMHS consultant chatting about a single email. You can:

1) WRITE OR REVISE A DRAFT REPLY when asked.
2) ANSWER A CLINICAL / LITERATURE / PRACTICAL QUESTION concisely. Cite registered sources by id when you draw on them.

CRITICAL: when the clinician asks a clinical question, you MUST use the tools to consult their REGISTERED evidence sources rather than relying on your own training. The registered sources are the only ones the clinician trusts; your training data alone is not an acceptable substitute.

Workflow for clinical questions:
  - Call search_registered_sources with relevant keywords to find matching registered sources.
  - Call fetch_source(source_id) for the most relevant matches to read the live current text.
  - Base your answer on what you actually read. Cite the source IDs you fetched.
  - If nothing relevant is registered, or every fetch fails, say so plainly. Do NOT fall back to "general clinical knowledge" without flagging it explicitly in your reply.

For pure draft-writing turns ("make it warmer", "shorten this") no tool call is needed.

Registered evidence sources currently available:
${registryBlock}

When you have finished tool use, your FINAL response MUST be ONLY a single JSON object — no markdown fences, no preamble, no sentences before or after it. Put any commentary INSIDE the "text" field. The whole message must parse as JSON.

{ "kind": "draft", "body": "..." }     ← use when writing or revising a reply
{ "kind": "answer", "text": "..." }    ← use for everything else

Use "draft" ONLY when the clinician has clearly asked for a reply to be written or revised. If unsure, use "answer". British English. Be concise — the clinician knows the field.`;

router.post("/clinadmin/ai/chat", async (req, res) => {
  const parsed = AiChatWithToolsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { prompt } = parsed.data;

  // Load the live registry once per request. Server-of-record for what
  // the model is allowed to fetch — the client cannot pass a registry.
  const registryRows: RegistryRow[] = (
    await db
      .select()
      .from(evidenceSourcesTable)
      .orderBy(asc(evidenceSourcesTable.tier), asc(evidenceSourcesTable.sourceName))
  ).map((r) => ({
    id: r.id,
    tier: r.tier,
    sourceName: r.sourceName,
    title: r.title,
    year: r.year,
    url: r.url,
    publiclyAccessible: r.publiclyAccessible,
  }));
  const registryById = new Map(registryRows.map((r) => [r.id, r]));

  const tools = [
    {
      name: "search_registered_sources",
      description:
        "Search the clinician's REGISTERED evidence sources by keywords. Returns matching sources with id, title, year, tier, source name and url. Use this FIRST to discover which registered sources are relevant. Returns at most 8 matches, ranked by tier then year.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Keywords to search the registry by name and title (case-insensitive).",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "fetch_source",
      description:
        "Fetch the live page text for one REGISTERED source by id. Returns up to ~12000 characters of plain text scraped from the registered URL. The id MUST be from the registered sources list — arbitrary URLs are rejected. Returns an error string if the URL is unreachable, restricted or non-readable.",
      input_schema: {
        type: "object" as const,
        properties: {
          source_id: {
            type: "integer",
            description: "Registry id of the source to fetch.",
          },
        },
        required: ["source_id"],
      },
    },
  ];

  const runSearch = (query: string): string => {
    const q = (query ?? "").toLowerCase().trim();
    if (!q) return JSON.stringify({ matches: [] });
    const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
    if (tokens.length === 0) return JSON.stringify({ matches: [] });
    const scored = registryRows
      .map((r) => {
        const hay = `${r.sourceName} ${r.title}`.toLowerCase();
        const hits = tokens.filter((t) => hay.includes(t)).length;
        return { r, hits };
      })
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits || a.r.tier - b.r.tier || b.r.year - a.r.year)
      .slice(0, 8)
      .map(({ r }) => ({
        id: r.id,
        sourceName: r.sourceName,
        title: r.title,
        year: r.year,
        tier: r.tier,
        url: r.url,
        publiclyAccessible: r.publiclyAccessible,
      }));
    return JSON.stringify({ matches: scored });
  };

  const fetchedOk = new Set<number>();
  const fetchedFail = new Set<number>();

  const runFetch = async (sourceIdRaw: unknown): Promise<string> => {
    const sourceId =
      typeof sourceIdRaw === "number"
        ? sourceIdRaw
        : typeof sourceIdRaw === "string"
        ? Number(sourceIdRaw)
        : NaN;
    if (!Number.isFinite(sourceId) || !Number.isInteger(sourceId)) {
      return JSON.stringify({ error: "source_id must be an integer" });
    }
    const row = registryById.get(sourceId);
    if (!row) {
      return JSON.stringify({
        error: `source_id ${sourceId} is not in the clinician's registered sources. Use search_registered_sources to find valid ids.`,
      });
    }
    const result = await fetchSourceText(row.url);
    if (!result.ok) {
      fetchedFail.add(sourceId);
      return JSON.stringify({
        error: `Could not read this source (${result.reason}). Tell the clinician you tried to read ${row.sourceName} but it was unreachable.`,
        source_id: sourceId,
        source_name: row.sourceName,
        url: row.url,
      });
    }
    fetchedOk.add(sourceId);
    return JSON.stringify({
      source_id: sourceId,
      source_name: row.sourceName,
      title: row.title,
      year: row.year,
      url: row.url,
      text: result.text,
    });
  };

  type AnthropicContent =
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
  type AnthropicMessage = { role: "user" | "assistant"; content: string | AnthropicContent[] };

  const messages: AnthropicMessage[] = [{ role: "user", content: prompt }];
  let finalText = "";

  try {
    for (let iter = 0; iter < TOOL_LOOP_MAX_ITERS; iter++) {
      // Cast: the Anthropic SDK's typed `tools` signature is fiddly to
      // satisfy structurally; the shape above matches the wire format.
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: CHAT_TOOL_SYSTEM(renderRegistryForSystem(registryRows)),
        tools: tools as unknown as Parameters<typeof anthropic.messages.create>[0]["tools"],
        messages: messages as unknown as Parameters<typeof anthropic.messages.create>[0]["messages"],
      });

      // Always push the assistant turn back into the thread so subsequent
      // tool_result messages have something to reply to.
      messages.push({
        role: "assistant",
        content: message.content as unknown as AnthropicContent[],
      });

      if (message.stop_reason !== "tool_use") {
        // Final answer — extract concatenated text blocks.
        finalText = (message.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string)
          .join("");
        break;
      }

      // Run every tool call in this assistant turn and feed the results
      // back as a single user message of tool_result blocks.
      const toolUses = (message.content as AnthropicContent[]).filter(
        (b): b is Extract<AnthropicContent, { type: "tool_use" }> => b.type === "tool_use",
      );
      const toolResults: AnthropicContent[] = [];
      for (const tu of toolUses) {
        let result: string;
        try {
          if (tu.name === "search_registered_sources") {
            const q = typeof tu.input?.["query"] === "string" ? (tu.input["query"] as string) : "";
            result = runSearch(q);
          } else if (tu.name === "fetch_source") {
            result = await runFetch(tu.input?.["source_id"]);
          } else {
            result = JSON.stringify({ error: `unknown tool: ${tu.name}` });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result = JSON.stringify({ error: `tool execution failed: ${msg}` });
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: result,
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    if (!finalText) {
      // Tool-use loop exhausted without a final answer. This is a model
      // misbehaviour — log it and return a clear error rather than a
      // truncated reply.
      req.log.warn(
        { iters: TOOL_LOOP_MAX_ITERS, fetched: [...fetchedOk], failed: [...fetchedFail] },
        "chat tool-use loop exhausted",
      );
      res.status(500).json({ error: "Chat tool-use loop did not converge." });
      return;
    }

    // Server-of-record validation backstop: fetchedOk is what WE actually
    // ran via the fetch tool, so by construction every id exists in the
    // registry. Belt-and-braces inArray check in case of bugs.
    const ok = [...fetchedOk];
    const failed = [...fetchedFail];
    const allIds = [...new Set([...ok, ...failed])];
    if (allIds.length > 0) {
      const present = await db
        .select({ id: evidenceSourcesTable.id })
        .from(evidenceSourcesTable)
        .where(inArray(evidenceSourcesTable.id, allIds));
      const valid = new Set(present.map((r) => r.id));
      res.json({
        text: finalText,
        sourcesFetched: ok.filter((id) => valid.has(id)),
        sourcesFailedToFetch: failed.filter((id) => valid.has(id)),
      });
      return;
    }
    res.json({ text: finalText, sourcesFetched: [], sourcesFailedToFetch: [] });
  } catch (err) {
    req.log.error({ err }, "Chat tool-use failed");
    res.status(500).json({ error: "Chat tool-use failed" });
  }
});

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
  interface DeferredItem {
    label: string;
    dueDays: number | null;
    estMin: number;
    reason: string;
  }
  const deferred: DeferredItem[] = [];

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
          }`
        : e.subject;
      deferred.push({
        label,
        dueDays: e.deadline,
        estMin: combinedMin,
        reason: link
          ? "No day has room for the email and its linked task together."
          : "No day has room this week.",
      });
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
      deferred.push({
        label: t.title,
        dueDays: null,
        estMin: t.estMin,
        reason: "Standalone task — no day had a free slot of this size.",
      });
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
