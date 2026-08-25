import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listBrands, getBrand, createBrand, updateBrand } from "../../lib/brands.js";
import type { Brand, BrandInput } from "../../lib/brands.js";

function formatError(error: unknown): string {
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

function brandToMarkdown(b: Brand): string {
  const lines = [
    `## ${b.name} (${b.id})`,
    `- **Colors**: ${b.primary_hex}${b.secondary_hex ? `, ${b.secondary_hex}` : ""}${
      b.accent_hex ? `, ${b.accent_hex}` : ""
    }`,
  ];
  if (b.font_family) lines.push(`- **Typography**: ${b.font_family}`);
  if (b.voice_notes) lines.push(`- **Voice/vibe**: ${b.voice_notes}`);
  if (b.about) lines.push(`- **About**: ${b.about}`);
  if (b.services) lines.push(`- **Services**: ${b.services}`);
  const contact = [
    b.website_url,
    b.contact_phone,
    b.contact_email,
    b.instagram_handle,
    b.facebook_handle,
    b.linkedin_handle,
    b.tiktok_handle,
  ].filter(Boolean);
  if (contact.length > 0) lines.push(`- **Contact/social**: ${contact.join(" · ")}`);
  if (b.logo_url) lines.push(`- **Logo**: ${b.logo_url}`);
  return lines.join("\n");
}

const hexColor = (label: string) =>
  z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a 6-digit hex color, e.g. #1E40AF")
    .describe(label);

// Shared across create/update — kept as plain field descriptions rather than
// a single schema reused with .partial() so each tool's required/optional
// shape stays explicit and self-documenting in the registered inputSchema.
const optionalContactFields = {
  logo_url: z.string().url().optional().describe("Public URL to a transparent PNG logo"),
  secondary_hex: hexColor("Secondary brand color").optional(),
  accent_hex: hexColor("Accent brand color").optional(),
  font_family: z
    .string()
    .max(100)
    .optional()
    .describe('Typography, e.g. "Inter" or a style description like "clean geometric sans"'),
  voice_notes: z
    .string()
    .max(2000)
    .optional()
    .describe("Brand voice/vibe — steers both generated copy and image style"),
  about: z
    .string()
    .max(2000)
    .optional()
    .describe("What the brand does — feeds copywriting context"),
  services: z.string().max(2000).optional().describe("Products/services offered"),
  contact_phone: z.string().max(50).optional(),
  contact_email: z.string().email().optional(),
  website_url: z.string().url().optional(),
  instagram_handle: z.string().max(100).optional().describe('e.g. "@brandname"'),
  facebook_handle: z.string().max(100).optional().describe('e.g. "@brandname"'),
  linkedin_handle: z.string().max(100).optional().describe('e.g. "@brandname"'),
  tiktok_handle: z.string().max(100).optional().describe('e.g. "@brandname"'),
};

function toBrandInput(parsed: Record<string, unknown>): BrandInput {
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) input[key] = value;
  }
  return input as BrandInput;
}

export function registerBrandTools(server: McpServer): void {
  server.registerTool(
    "studio_list_brands",
    {
      title: "List Brands",
      description: `List every brand in the Graphics Studio brand vault.

Returns each brand's id, name, and color palette. Use this to find a brand's UUID before calling studio_get_brand, studio_update_brand, or studio_generate_graphics — all of those require the brand's id, not its name.

Returns (JSON): { "count": number, "brands": [{ "id", "name", "primary_hex", "secondary_hex", "accent_hex", "created_at" }] }`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const brands = await listBrands();
        const summary = brands.map((b) => ({
          id: b.id,
          name: b.name,
          primary_hex: b.primary_hex,
          secondary_hex: b.secondary_hex,
          accent_hex: b.accent_hex,
          created_at: b.created_at,
        }));
        const lines = [`# Brands (${summary.length})`, ""];
        for (const b of summary) {
          const colors = [b.primary_hex, b.secondary_hex, b.accent_hex].filter(Boolean).join(", ");
          lines.push(`- **${b.name}** (\`${b.id}\`) — ${colors}`);
        }
        if (summary.length === 0) lines.push("_No brands yet — use studio_create_brand to add one._");
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: { count: summary.length, brands: summary },
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  server.registerTool(
    "studio_get_brand",
    {
      title: "Get Brand",
      description: `Get the full brand kit for one brand — colors, typography, voice notes, about/services text, and contact/social handles.

Args:
  - brandId (string, UUID): the brand's id, from studio_list_brands.

Returns (JSON): the full brand row, or an error if no brand has that id.`,
      inputSchema: { brandId: z.string().uuid().describe("Brand id (UUID)") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ brandId }: { brandId: string }) => {
      try {
        const brand = await getBrand(brandId);
        if (!brand) {
          return {
            content: [{ type: "text", text: `Error: No brand found with id '${brandId}'.` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: brandToMarkdown(brand) }],
          structuredContent: brand,
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  server.registerTool(
    "studio_create_brand",
    {
      title: "Create Brand",
      description: `Add a new brand to the vault. Every graphic generated for this brand will be scoped to the identity set here — colors are enforced as a strict palette, voice notes and about/services text steer both copywriting and image style.

Required: name, primary_hex. Everything else is optional but the more that's filled in (about, services, voice_notes, contact/social), the more on-brand and complete the generated graphics will be.

Returns (JSON): the newly created brand row, including its generated id — save that id, it's required for every other studio_* tool.`,
      inputSchema: {
        name: z.string().min(1).max(200).describe("Brand display name"),
        primary_hex: hexColor("Primary brand color — the dominant color used across generated graphics"),
        ...optionalContactFields,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params: { name: string; primary_hex: string } & Record<string, string | undefined>) => {
      try {
        const brand = await createBrand(toBrandInput(params));
        return {
          content: [
            { type: "text", text: `Created brand **${brand.name}** with id \`${brand.id}\`.\n\n${brandToMarkdown(brand)}` },
          ],
          structuredContent: brand,
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  server.registerTool(
    "studio_update_brand",
    {
      title: "Update Brand",
      description: `Update fields on an existing brand. Only the fields you pass are changed — omitted fields keep their current value.

Args:
  - brandId (string, UUID, required): which brand to update.
  - Any brand field (name, primary_hex, secondary_hex, accent_hex, logo_url, font_family, voice_notes, about, services, contact_phone, contact_email, website_url, instagram_handle, facebook_handle, linkedin_handle, tiktok_handle) — only include the ones you want to change.

Returns (JSON): the updated brand row.`,
      inputSchema: {
        brandId: z.string().uuid().describe("Brand id (UUID) to update"),
        name: z.string().min(1).max(200).optional(),
        primary_hex: hexColor("Primary brand color").optional(),
        ...optionalContactFields,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ brandId, ...rest }: { brandId: string } & Record<string, string | undefined>) => {
      try {
        const existing = await getBrand(brandId);
        if (!existing) {
          return {
            content: [{ type: "text", text: `Error: No brand found with id '${brandId}'.` }],
            isError: true,
          };
        }
        const merged: BrandInput = { ...existing, ...toBrandInput(rest) };
        const brand = await updateBrand(brandId, merged);
        return {
          content: [{ type: "text", text: `Updated **${brand.name}**.\n\n${brandToMarkdown(brand)}` }],
          structuredContent: brand,
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );
}
