// EmailParticipant extraction for the server-side de-identifier.
//
// The de-identifier needs a list of {name, role} pairs to scrub from
// the AI draft. The client is the source of truth for "who is this
// email about" because the server has no Microsoft Graph access. We
// build the list from two signals we already have:
//
//   1. email.from  — the sender's name + a role hint in parentheses
//                    (e.g. "Sasha Chenoweth (parent)" → name=Sasha
//                    Chenoweth, role=parent). When no paren is
//                    present, role defaults to 'other'.
//
//   2. classification.patientName — set by the classifier for emails
//                    that name a patient. Role=patient.
//
// Stage 4 limitation: we don't yet parse names from the email body or
// from CC lists. The medico-legal audit covers names that appear in
// the AI draft because the AI itself can only have learnt those names
// from the inputs we gave it (the prompt + the email body, which
// includes these participants). If a future regression makes the AI
// hallucinate a name we didn't supply, the de-identifier won't catch
// it — but neither would a perfect NER model without the same data.

import type { Email, AiClassification } from "./types";
import type { EmailParticipant } from "@workspace/api-zod";

const ROLE_BY_HINT: Record<string, EmailParticipant["role"]> = {
  parent: "parent",
  mother: "parent",
  mum: "parent",
  mom: "parent",
  father: "parent",
  dad: "parent",
  guardian: "parent",
  carer: "parent",
};

interface ParsedFrom {
  name: string;
  role: EmailParticipant["role"];
}

function parseFrom(from: string): ParsedFrom | null {
  // Examples we see in the seed data:
  //   "Sasha Chenoweth (parent)"
  //   "Dr. Martinez (GP)"
  //   "Dr. K. Osei — Clinical Psychology"
  //   "Reception — CAMHS Outpatient"
  //   "CHYMS Training Team"
  // We treat anything inside parentheses as a role hint; otherwise the
  // whole string (minus any dash-separated title suffix) is the name
  // with role='other'. We don't try to scrub clinician/team names
  // because they're not patient-identifying — but we still pass them
  // through as 'other' so any of them appearing in the AI draft gets
  // replaced with [NAME] rather than left in.
  const trimmed = from.trim();
  if (!trimmed) return null;

  const parenMatch = trimmed.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const name = parenMatch[1].trim();
    const hint = parenMatch[2].trim().toLowerCase();
    const role = ROLE_BY_HINT[hint] ?? "other";
    return { name, role };
  }

  // Strip a dash-separated title suffix ("— SENCO", "— Clinical Psychology")
  // so we get a cleaner name out. Em-dash and hyphen both seen in seeds.
  const dashSplit = trimmed.split(/\s+[—-]\s+/);
  return { name: dashSplit[0].trim(), role: "other" };
}

export function extractParticipants(
  email: Email,
  classification: AiClassification | undefined,
): EmailParticipant[] {
  const out: EmailParticipant[] = [];
  const seen = new Set<string>(); // dedupe by `${name.toLowerCase()}::${role}`

  const add = (name: string, role: EmailParticipant["role"]) => {
    const cleaned = name.trim();
    if (cleaned.length < 2) return;
    const key = `${cleaned.toLowerCase()}::${role}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: cleaned, role });
  };

  const fromParsed = parseFrom(email.from);
  if (fromParsed) add(fromParsed.name, fromParsed.role);

  if (classification?.patientName) {
    add(classification.patientName, "patient");
  }

  return out;
}
