import { Router } from "express";
import {
  listFolders,
  listMessages,
  moveMessage,
  folderExists,
} from "../lib/outlookSeedAdapter";
import { MoveEmailBetweenOutlookFoldersBody } from "@workspace/api-zod";

const router = Router();

// GET /api/outlook-folders — live folder tree (Outlook is the source
// of truth in production; seed-backed today). Three-bucket rule:
// nothing returned here is persisted server-side.
router.get("/outlook-folders", (_req, res) => {
  res.json(listFolders());
});

// GET /api/outlook-folders/:folderId/messages — list messages.
router.get("/outlook-folders/:folderId/messages", (req, res) => {
  const folderId = req.params.folderId;
  if (!folderId || !folderExists(folderId)) {
    res.status(404).json({ error: "Unknown folder" });
    return;
  }
  const items = listMessages(folderId).map((m) => ({
    id: m.id,
    from: m.from,
    subject: m.subject,
    snippet: m.snippet,
    receivedAt: m.receivedAt,
  }));
  res.json(items);
});

// POST /api/outlook-folders/move — move a message between Outlook
// folders. Production calls Graph; today the in-memory adapter
// applies the move so subsequent list calls reflect it.
router.post("/outlook-folders/move", (req, res) => {
  const parsed = MoveEmailBetweenOutlookFoldersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const ok = moveMessage(parsed.data.outlookEmailId, parsed.data.toFolderId);
  if (!ok) {
    res.status(404).json({ error: "Unknown folder" });
    return;
  }
  res.status(204).send();
});

export default router;
