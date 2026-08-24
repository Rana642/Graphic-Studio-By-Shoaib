import "server-only";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * Service-role client for all brand/generation data. Bypasses RLS, so it
 * must only ever be reached from server code behind the proxy.ts auth
 * check — the `server-only` import makes bundling it into a client
 * component a build error rather than a silent key leak. Same pattern as
 * adsbyshoaib.com's dashboard (lib/dashboard/db.ts) — this is a single/
 * small-team internal tool, not a multi-tenant product, so one shared
 * service-role client is simpler than per-table RLS policies.
 */
export const db = createClient(
  url || "https://placeholder.supabase.co",
  serviceRoleKey || "placeholder-service-role-key",
  { auth: { persistSession: false } }
);
