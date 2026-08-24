import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

/**
 * Auth-only Supabase client, bound to the request's cookies. Uses the anon
 * key deliberately — this client authenticates the user; all data access
 * goes through the service-role client in lib/supabase/db.ts, gated by
 * requireUser()/getUser() below.
 */
export async function createAuthClient() {
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component, where cookies are read-only —
          // proxy.ts already refreshes the session, so this is safe to skip.
        }
      },
    },
  });
}

/** Returns the signed-in user, or null. */
export async function getUser() {
  const supabase = await createAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
