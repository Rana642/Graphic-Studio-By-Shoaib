import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enhanceGeneration, UPSCALE_SCALES } from "../../lib/enhance.js";

function formatError(error: unknown): string {
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

const TOPAZ_MODELS = ["Standard V2", "High Fidelity V2", "Text Refine", "CGI", "Low Resolution V2"] as const;

export function registerEnhanceTools(server: McpServer): void {
  server.registerTool(
    "studio_enhance_generation",
    {
      title: "Enhance/Upscale a Generation (Topaz)",
      description: `Upscales an already-generated graphic via Topaz's AI upscaler and records the result on that generation — for print/large-format quality beyond what Nano Banana/GPT Image output natively (their max output is roughly 1024-1536px).

Args:
  - generationId (string, UUID, required): id of a completed generation — from studio_generate_graphics/studio_generate_from_prompt's results, or studio_list_generations.
  - scale (2 | 4 | 6, optional, default 4): output size = the generation's placement size × scale.
  - model (optional, default "Standard V2"): which Topaz model to use.
    - "Standard V2" / "High Fidelity V2": preserve the source faithfully, no invented detail — the right choice for real client photos or graphics where text/labels must not drift.
    - "Text Refine": specifically sharpens rendered text (labels/CTAs).
    - "CGI": for illustration/CGI-style sources.
    - "Low Resolution V2": for already-low-quality source images.

Returns (JSON): the updated generation row, including "upscaled_image_url" (the enhanced image's public URL) and "upscale_cost_usd".

Error Handling:
  - Returns an error if generationId doesn't exist, or if that generation isn't in "complete" status (nothing to enhance).
  - Requires TOPAZ_API_KEY to be configured in .env.local.`,
      inputSchema: {
        generationId: z.string().uuid().describe("Generation id to enhance, from a generate call's results or studio_list_generations"),
        scale: z
          .union([z.literal(2), z.literal(4), z.literal(6)])
          .default(4)
          .describe("Output size multiplier of the original placement dimensions"),
        model: z.enum(TOPAZ_MODELS).default("Standard V2").describe("Topaz model to use"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: {
      generationId: string;
      scale: (typeof UPSCALE_SCALES)[number];
      model: (typeof TOPAZ_MODELS)[number];
    }) => {
      try {
        const generation = await enhanceGeneration(params.generationId, {
          scale: params.scale,
          model: params.model,
        });
        return {
          content: [
            {
              type: "text",
              text: `Enhanced. ✨ ${generation.upscaled_image_url}`,
            },
          ],
          structuredContent: { generation },
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );
}
