import { db, evidenceSourcesTable, emailEvidenceTable, type CitationLink } from "@workspace/db";
import { eq } from "drizzle-orm";

// Seed the evidence_sources registry and the email_evidence links for
// the hand-curated Stage 1 examples (emails 5, 61, 62). Idempotent —
// wipes both tables before reinserting so it can be re-run safely.
//
// THIS REGISTRY STORES POINTERS ONLY. The url field is what Stage 3
// will fetch live at query time. No guideline content is duplicated
// here — clinical guidelines update without notice and any cached
// version creates medico-legal exposure.

const TIER_1_WARNING =
  "Tier 1 prescribing sources (eTG, AMH, MIMS) have not been integrated. Verify any dose, interaction, or contraindication directly in eTG or AMH before replying.";

const DEFAULT_CLINICIAN_ID = "default";

interface SeedSource {
  key: string;
  tier: number;
  sourceName: string;
  title: string;
  year: number;
  url: string;
  isAustralian: boolean;
  specialty: string | null;
  publiclyAccessible: boolean;
}

const SOURCES: SeedSource[] = [
  {
    key: "rch_adhd_monitoring",
    tier: 2,
    sourceName: "RCH Melbourne",
    title: "Clinical Practice Guideline — ADHD: stimulant monitoring (weight, height, BP, HR)",
    year: 2023,
    url: "https://www.rch.org.au/clinicalguide/guideline_index/ADHD/",
    isAustralian: true,
    specialty: "paediatrics",
    publiclyAccessible: true,
  },
  {
    key: "ranzcp_adhd_ppg10",
    tier: 2,
    sourceName: "RANZCP",
    title: "Professional Practice Guideline 10 — ADHD: clinical practice points",
    year: 2024,
    url: "https://www.ranzcp.org/clinical-guidelines-publications",
    isAustralian: true,
    specialty: "psychiatry",
    // RANZCP PPGs sit behind member login for the full PDF; landing page
    // is public but the document body is not machine-readable.
    publiclyAccessible: false,
  },
  {
    key: "ranzcp_stimulant_monitoring",
    tier: 2,
    sourceName: "RANZCP",
    title: "Faculty of Child and Adolescent Psychiatry — stimulant prescribing monitoring schedule",
    year: 2024,
    url: "https://www.ranzcp.org/clinical-guidelines-publications",
    isAustralian: true,
    specialty: "psychiatry",
    publiclyAccessible: false,
  },
  {
    key: "nice_ng87_adhd",
    tier: 4,
    sourceName: "NICE (UK)",
    title:
      "NG87 — ADHD: diagnosis and management — methylphenidate dose titration in children and young people",
    year: 2019,
    url: "https://www.nice.org.uk/guidance/ng87",
    isAustralian: false,
    specialty: "psychiatry",
    publiclyAccessible: true,
  },
  {
    key: "asthma_handbook",
    tier: 2,
    sourceName: "National Asthma Council Australia",
    title:
      "Australian Asthma Handbook v2.2 — adjusting treatment for adolescents and adults (step-up after increased SABA use)",
    year: 2023,
    url: "https://www.asthmahandbook.org.au/",
    isAustralian: true,
    specialty: "respiratory",
    publiclyAccessible: true,
  },
  {
    key: "gina_2024",
    tier: 4,
    sourceName: "GINA (Global Initiative for Asthma)",
    title:
      "Global Strategy for Asthma Management and Prevention — Box 3-12: Stepwise approach for adolescents 12+",
    year: 2024,
    url: "https://ginasthma.org/2024-report/",
    isAustralian: false,
    specialty: "respiratory",
    publiclyAccessible: true,
  },
];

interface SeedEvidence {
  outlookEmailId: string;
  prescribingWarning: string | null;
  citations: Array<{
    sourceKey: string;
    flag: CitationLink["flag"];
    flagText: string | null;
  }>;
}

const EMAIL_EVIDENCE: SeedEvidence[] = [
  {
    outlookEmailId: "5",
    prescribingWarning: TIER_1_WARNING,
    citations: [
      { sourceKey: "ranzcp_adhd_ppg10", flag: null, flagText: null },
      {
        sourceKey: "nice_ng87_adhd",
        flag: "C",
        flagText:
          "AU practice (RANZCP / RACGP) typically titrates OROS-methylphenidate to a maximum of ~54 mg/day in adolescents. NICE NG87 permits titration to 108 mg/day under specialist supervision. Defer to Australian dosing unless you have a specific clinical rationale and have documented the deviation.",
      },
    ],
  },
  {
    outlookEmailId: "62",
    prescribingWarning: TIER_1_WARNING,
    citations: [
      { sourceKey: "asthma_handbook", flag: null, flagText: null },
      {
        sourceKey: "gina_2024",
        flag: "B",
        flagText:
          "Broadly concordant with the Australian Asthma Handbook on stepping up after rising SABA use. Minor variation: GINA preferences AIR therapy (ICS-formoterol as needed) as the Track 1 controller from Step 1 in adolescents 12+, whereas the Australian Asthma Handbook still treats low-dose daily ICS + SABA-PRN as a fully acceptable Step 2 option. Either pathway is defensible — defer to Australian Asthma Handbook unless there is a specific reason to follow GINA.",
      },
    ],
  },
  {
    outlookEmailId: "61",
    prescribingWarning: TIER_1_WARNING,
    citations: [
      { sourceKey: "rch_adhd_monitoring", flag: null, flagText: null },
      { sourceKey: "ranzcp_stimulant_monitoring", flag: null, flagText: null },
    ],
  },
];

async function main() {
  console.log("[seed:evidence] wiping evidence_sources + email_evidence");
  await db.delete(emailEvidenceTable);
  await db.delete(evidenceSourcesTable);

  console.log(`[seed:evidence] inserting ${SOURCES.length} sources`);
  const now = new Date();
  const keyToId = new Map<string, number>();
  for (const s of SOURCES) {
    const [inserted] = await db
      .insert(evidenceSourcesTable)
      .values({
        tier: s.tier,
        sourceName: s.sourceName,
        title: s.title,
        year: s.year,
        url: s.url,
        isAustralian: s.isAustralian,
        specialty: s.specialty,
        publiclyAccessible: s.publiclyAccessible,
        lastVerifiedUrl: now,
      })
      .returning({ id: evidenceSourcesTable.id });
    if (!inserted) throw new Error(`Failed to insert source ${s.key}`);
    keyToId.set(s.key, inserted.id);
  }

  console.log(`[seed:evidence] inserting ${EMAIL_EVIDENCE.length} email links`);
  for (const link of EMAIL_EVIDENCE) {
    const citations: CitationLink[] = link.citations.map((c) => {
      const id = keyToId.get(c.sourceKey);
      if (id === undefined) throw new Error(`Unknown source key: ${c.sourceKey}`);
      return { sourceId: id, flag: c.flag, flagText: c.flagText };
    });
    await db
      .delete(emailEvidenceTable)
      .where(eq(emailEvidenceTable.outlookEmailId, link.outlookEmailId));
    await db.insert(emailEvidenceTable).values({
      clinicianId: DEFAULT_CLINICIAN_ID,
      outlookEmailId: link.outlookEmailId,
      prescribingWarning: link.prescribingWarning,
      citations,
      aiCheckedNoMatch: false,
    });
  }

  console.log("[seed:evidence] done");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed:evidence] failed", err);
  process.exit(1);
});
