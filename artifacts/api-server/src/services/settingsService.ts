import { db, appSettingsTable } from "@workspace/db";

/**
 * Internal admin-configurable settings. app_settings is a key/value text store;
 * numeric values are stored as text and parsed on read. Safe Phase 1 defaults are
 * applied for any absent key — never store secrets here.
 */
export interface EffectiveSettings {
  extractionConfidenceThreshold: number;
  vendorMatchThreshold: number;
  tieOutPassTolerance: number;
  tieOutWarningTolerance: number;
  defaultPageSize: number;
  defaultExportFormat: string;
}

export const SETTINGS_DEFAULTS: EffectiveSettings = {
  extractionConfidenceThreshold: 85,
  vendorMatchThreshold: 85,
  tieOutPassTolerance: 0.01,
  tieOutWarningTolerance: 0.05,
  defaultPageSize: 20,
  defaultExportFormat: "CSV",
};

export type SettingsPatch = Partial<{
  extractionConfidenceThreshold: number | null;
  vendorMatchThreshold: number | null;
  tieOutPassTolerance: number | null;
  tieOutWarningTolerance: number | null;
  defaultPageSize: number | null;
  defaultExportFormat: string | null;
}>;

/** Read all settings keys and apply defaults for any that are absent. */
export async function getSettings(): Promise<EffectiveSettings> {
  const rows = await db.select().from(appSettingsTable);
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const num = (key: string, fallback: number): number => {
    const v = map.get(key);
    if (v == null) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return {
    extractionConfidenceThreshold: num(
      "extractionConfidenceThreshold",
      SETTINGS_DEFAULTS.extractionConfidenceThreshold,
    ),
    vendorMatchThreshold: num(
      "vendorMatchThreshold",
      SETTINGS_DEFAULTS.vendorMatchThreshold,
    ),
    tieOutPassTolerance: num(
      "tieOutPassTolerance",
      SETTINGS_DEFAULTS.tieOutPassTolerance,
    ),
    tieOutWarningTolerance: num(
      "tieOutWarningTolerance",
      SETTINGS_DEFAULTS.tieOutWarningTolerance,
    ),
    defaultPageSize: num("defaultPageSize", SETTINGS_DEFAULTS.defaultPageSize),
    defaultExportFormat:
      map.get("defaultExportFormat") ?? SETTINGS_DEFAULTS.defaultExportFormat,
  };
}

/** Upsert provided keys (values stored as text) and return effective settings. */
export async function updateSettings(
  patch: SettingsPatch,
  updatedBy?: string | null,
): Promise<EffectiveSettings> {
  const keys: (keyof EffectiveSettings)[] = [
    "extractionConfidenceThreshold",
    "vendorMatchThreshold",
    "tieOutPassTolerance",
    "tieOutWarningTolerance",
    "defaultPageSize",
    "defaultExportFormat",
  ];

  for (const key of keys) {
    const value = patch[key];
    if (value == null) continue;
    const stringValue = String(value);
    await db
      .insert(appSettingsTable)
      .values({ key, value: stringValue, updatedBy: updatedBy ?? null })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: { value: stringValue, updatedBy: updatedBy ?? null },
      });
  }

  return getSettings();
}
