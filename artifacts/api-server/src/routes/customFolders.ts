import { Router } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  customFoldersTable,
  emailFolderAssignmentsTable,
} from "@workspace/db";
import {
  CreateCustomFolderBody,
  RenameCustomFolderBody,
  AssignEmailToFolderBody,
} from "@workspace/api-zod";
import { getMessage } from "../lib/outlookSeedAdapter";

const router = Router();

const DEFAULT_CLINICIAN_ID = "default";

// GET /api/custom-folders — clinician's own folder definitions.
router.get("/custom-folders", async (_req, res) => {
  const rows = await db
    .select()
    .from(customFoldersTable)
    .where(eq(customFoldersTable.clinicianId, DEFAULT_CLINICIAN_ID));
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// POST /api/custom-folders — idempotent on id.
router.post("/custom-folders", async (req, res) => {
  const parsed = CreateCustomFolderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  await db
    .insert(customFoldersTable)
    .values({
      id: parsed.data.id,
      clinicianId: DEFAULT_CLINICIAN_ID,
      name: parsed.data.name,
    })
    .onConflictDoNothing();
  res.status(204).send();
});

// PATCH /api/custom-folders/:id — rename.
router.patch("/custom-folders/:id", async (req, res) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const parsed = RenameCustomFolderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  await db
    .update(customFoldersTable)
    .set({ name: parsed.data.name })
    .where(
      and(
        eq(customFoldersTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(customFoldersTable.id, id),
      ),
    );
  res.status(204).send();
});

// DELETE /api/custom-folders/:id — also clear any assignments
// pointing at this folder so deleted folders don't leave dangling
// references.
router.delete("/custom-folders/:id", async (req, res) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  await db
    .delete(emailFolderAssignmentsTable)
    .where(
      and(
        eq(
          emailFolderAssignmentsTable.clinicianId,
          DEFAULT_CLINICIAN_ID,
        ),
        eq(emailFolderAssignmentsTable.customFolderId, id),
      ),
    );
  await db
    .delete(customFoldersTable)
    .where(
      and(
        eq(customFoldersTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(customFoldersTable.id, id),
      ),
    );
  res.status(204).send();
});

// GET /api/custom-folders/:id/messages — resolve every assignment
// for this folder back to a live message via the email-fetch
// adapter. Stub rows are returned for ids the adapter can't
// resolve (client-only seed inbox IDs); the client merges them
// with its own inbox seed at render time.
router.get("/custom-folders/:id/messages", async (req, res) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const assignments = await db
    .select()
    .from(emailFolderAssignmentsTable)
    .where(
      and(
        eq(emailFolderAssignmentsTable.clinicianId, DEFAULT_CLINICIAN_ID),
        eq(emailFolderAssignmentsTable.customFolderId, id),
      ),
    );
  const out = assignments.map((a) => {
    const m = getMessage(a.outlookEmailId);
    if (m) {
      return {
        id: m.id,
        from: m.from,
        subject: m.subject,
        snippet: m.snippet,
        receivedAt: m.receivedAt,
      };
    }
    return {
      id: a.outlookEmailId,
      from: "",
      subject: "",
      snippet: "",
      receivedAt: a.assignedAt.toISOString(),
    };
  });
  out.sort((x, y) => y.receivedAt.localeCompare(x.receivedAt));
  res.json(out);
});

// GET /api/email-folder-assignments — every (email → custom folder)
// mapping for the clinician.
router.get("/email-folder-assignments", async (_req, res) => {
  const rows = await db
    .select()
    .from(emailFolderAssignmentsTable)
    .where(eq(emailFolderAssignmentsTable.clinicianId, DEFAULT_CLINICIAN_ID));
  res.json(
    rows.map((r) => ({
      outlookEmailId: r.outlookEmailId,
      customFolderId: r.customFolderId,
      assignedAt: r.assignedAt.toISOString(),
    })),
  );
});

// POST /api/email-folder-assignments — assign / reassign. An email
// can be in at most one ClinAdmin custom folder, so reposting with
// a different folder updates in place.
router.post("/email-folder-assignments", async (req, res) => {
  const parsed = AssignEmailToFolderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  await db
    .insert(emailFolderAssignmentsTable)
    .values({
      clinicianId: DEFAULT_CLINICIAN_ID,
      outlookEmailId: parsed.data.outlookEmailId,
      customFolderId: parsed.data.customFolderId,
    })
    .onConflictDoUpdate({
      target: [
        emailFolderAssignmentsTable.clinicianId,
        emailFolderAssignmentsTable.outlookEmailId,
      ],
      set: { customFolderId: parsed.data.customFolderId },
    });
  res.status(204).send();
});

// DELETE /api/email-folder-assignments/:outlookEmailId — unassign.
router.delete("/email-folder-assignments/:outlookEmailId", async (req, res) => {
  const outlookEmailId = req.params.outlookEmailId;
  if (!outlookEmailId) {
    res.status(400).json({ error: "Missing outlookEmailId" });
    return;
  }
  await db
    .delete(emailFolderAssignmentsTable)
    .where(
      and(
        eq(
          emailFolderAssignmentsTable.clinicianId,
          DEFAULT_CLINICIAN_ID,
        ),
        eq(emailFolderAssignmentsTable.outlookEmailId, outlookEmailId),
      ),
    );
  res.status(204).send();
});

export default router;
