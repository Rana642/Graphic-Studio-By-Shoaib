import type { AssetLockedTemplate } from "./types";
import { dhaVillaPosterTemplate } from "./dhaVillaPoster";
import { eventOverlayTemplate } from "./eventOverlay";

export const ASSET_LOCKED_TEMPLATES: AssetLockedTemplate[] = [
  dhaVillaPosterTemplate,
  eventOverlayTemplate,
];

export function getAssetLockedTemplate(id: string): AssetLockedTemplate | undefined {
  return ASSET_LOCKED_TEMPLATES.find((t) => t.id === id);
}

export type { AssetLockedTemplate, TemplateField, TemplateFieldKind } from "./types";
