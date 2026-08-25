#!/usr/bin/env node
/**
 * MCP server exposing Graphics Studio's brand vault and image-generation
 * pipeline to Claude Code, running locally over stdio. Reuses the same
 * lib/ business logic as the Next.js app (Supabase service-role client,
 * image providers, placement specs, prompt builder) instead of duplicating
 * it — only the Next.js-specific glue (proxy.ts auth, server actions,
 * revalidatePath) is intentionally skipped, since this process has no
 * HTTP request/cookie context and is trusted-local by nature (whoever can
 * run Claude Code here already has full access to this machine).
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Must run before importing anything under lib/ — those modules read
// process.env at import time (e.g. lib/supabase/db.ts constructs the
// Supabase client as soon as it's loaded). ESM `import` statements are
// hoisted above ordinary code, so the tool modules are loaded via dynamic
// `import()` further down, after env vars are in place.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../.env.local") });

const REQUIRED_ENV = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `graphics-studio-mcp-server: missing required env var(s) in .env.local: ${missing.join(", ")}`
  );
  process.exit(1);
}

const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
const { registerBrandTools } = await import("./tools/brands.js");
const { registerGenerationTools } = await import("./tools/generations.js");
const { registerEnhanceTools } = await import("./tools/enhance.js");
const { registerAssetLockedTools } = await import("./tools/asset-locked.js");

const server = new McpServer({
  name: "graphics-studio-mcp-server",
  version: "1.0.0",
});

registerBrandTools(server);
registerGenerationTools(server);
registerEnhanceTools(server);
registerAssetLockedTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("graphics-studio-mcp-server running on stdio");
