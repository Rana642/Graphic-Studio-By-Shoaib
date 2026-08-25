import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ASSET_LOCKED_TEMPLATES, getAssetLockedTemplate } from "../../lib/asset-locked/templates/index.js";
import { generateAssetLocked } from "../../lib/asset-locked/generate.js";
import { getBrand } from "../../lib/brands.js";

function formatError(error: unknown): string {
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

export function registerAssetLockedTools(server: McpServer): void {
  server.registerTool(
    "studio_list_asset_locked_templates",
    {
      title: "List Asset-Locked Templates",
      description: `List the Asset-Locked Track's hand-designed templates — for graphics where a real photo/3D-render (a property, an event, a person) must composite in exactly as-is, never touched by AI. Only the frame around it (typography, badges, banners) is generated. Use this to see what fields a template needs before calling studio_generate_asset_locked.

Returns (JSON): { "templates": [{ "id", "label", "description", "canvasWidth", "canvasHeight", "fields": [{ "key", "label", "kind", "maxLength" }] }] }
"kind" is "text", "urdu" (right-to-left), or "long-text".`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const templates = ASSET_LOCKED_TEMPLATES.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        canvasWidth: t.canvasWidth,
        canvasHeight: t.canvasHeight,
        fields: t.fields,
      }));
      const lines = ["# Asset-Locked templates", ""];
      for (const t of templates) {
        lines.push(`## ${t.label} (\`${t.id}\`) — ${t.canvasWidth}×${t.canvasHeight}`);
        lines.push(t.description);
        for (const f of t.fields) lines.push(`- \`${f.key}\` (${f.kind}, max ${f.maxLength}) — ${f.label}`);
        lines.push("");
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: { templates },
      };
    }
  );

  server.registerTool(
    "studio_generate_asset_locked",
    {
      title: "Generate an Asset-Locked Graphic",
      description: `Composites a real photo/3D-render into a professionally designed template — 100% pixel-perfect, no AI ever touches the photo (unlike studio_generate_graphics/studio_generate_from_prompt/studio_generate_subject_edit, which all call an AI image model). Deterministic sharp/SVG compositing only, so this makes no external AI API call and has no per-call AI cost. The photo also gets a basic exposure/contrast auto-correction first (see lib/retouch.ts) — the same "fix a dark photo before using it" pass Track B does.

Args:
  - templateId (string, required): from studio_list_asset_locked_templates.
  - fieldValues (object, required): key→text for each of the template's fields (get the exact keys from studio_list_asset_locked_templates). Urdu fields should contain real Urdu text, not transliteration.
  - photoPath (string, required): local file path to the real photo/render to composite in as-is.
  - brandId (string, UUID, optional): drives the template's accent color/logo initial from that brand, and files the result under its history.

Returns (JSON): { "generation": { "id", "status", "image_url", "template_id", "error_message" } } — one image, not a batch (each template is a fixed layout/size, unlike the AI tracks' multi-placement batches).

Error Handling:
  - Returns an error if templateId is unknown, photoPath can't be read, or brandId is given but doesn't match any brand.`,
      inputSchema: {
        templateId: z.string().describe("Template id from studio_list_asset_locked_templates"),
        fieldValues: z.record(z.string(), z.string()).describe("key→text for each of the template's fields"),
        photoPath: z.string().describe("Local file path to the real photo/render to composite in as-is"),
        brandId: z
          .string()
          .uuid()
          .optional()
          .describe("Optional: drives accent color/logo + files under this brand's history"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params: {
      templateId: string;
      fieldValues: Record<string, string>;
      photoPath: string;
      brandId?: string;
    }) => {
      try {
        if (!getAssetLockedTemplate(params.templateId)) {
          return {
            content: [
              {
                type: "text",
                text: `Error: No template found with id '${params.templateId}'. Call studio_list_asset_locked_templates for valid ids.`,
              },
            ],
            isError: true,
          };
        }

        if (params.brandId) {
          const brand = await getBrand(params.brandId);
          if (!brand) {
            return {
              content: [{ type: "text", text: `Error: No brand found with id '${params.brandId}'.` }],
              isError: true,
            };
          }
        }

        let photoBuffer: Buffer;
        try {
          photoBuffer = await readFile(params.photoPath);
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Could not read photo at '${params.photoPath}': ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }

        const generation = await generateAssetLocked({
          templateId: params.templateId,
          brandId: params.brandId ?? null,
          fieldValues: params.fieldValues,
          photoBuffer,
        });

        return {
          content: [
            {
              type: "text",
              text:
                generation.status === "complete"
                  ? `✅ ${generation.image_url}`
                  : `❌ ${generation.error_message}`,
            },
          ],
          structuredContent: {
            generation: {
              id: generation.id,
              status: generation.status,
              image_url: generation.image_url,
              template_id: generation.template_id,
              error_message: generation.error_message,
            },
          },
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );
}
