import type { Brand } from "../../brands";

export type TemplateFieldKind = "text" | "urdu" | "long-text";

export type TemplateField = {
  key: string;
  label: string;
  kind: TemplateFieldKind;
  maxLength: number;
  placeholder?: string;
};

export type AssetLockedTemplate = {
  id: string;
  label: string;
  /** Short description of what this layout suits — shown in the template picker. */
  description: string;
  canvasWidth: number;
  canvasHeight: number;
  fields: TemplateField[];
  /** Builds the frame/typography SVG layer — everywhere the real photo
   *  should show through must be left unfilled (no rect/fill) so it stays
   *  transparent for renderTemplate() to composite the photo underneath. */
  buildFrameSvg(values: Record<string, string>, brand: Brand | null): string;
};
