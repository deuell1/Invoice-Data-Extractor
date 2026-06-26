import { Router, type IRouter } from "express";
import {
  GetSettingsResponse,
  UpdateSettingsBody,
  UpdateSettingsResponse,
} from "@workspace/api-zod";
import { getSettings, updateSettings } from "../services/settingsService";

const router: IRouter = Router();

// ─── GET /settings ───────────────────────────────────────────────────────────
router.get("/settings", async (_req, res): Promise<void> => {
  const settings = await getSettings();
  res.json(GetSettingsResponse.parse(settings));
});

// ─── PUT /settings ───────────────────────────────────────────────────────────
router.put("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { updatedBy, ...patch } = parsed.data;
  const settings = await updateSettings(patch, updatedBy);
  res.json(UpdateSettingsResponse.parse(settings));
});

export default router;
