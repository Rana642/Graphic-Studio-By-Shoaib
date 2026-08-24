import Link from "next/link";
import { listBrands } from "@/lib/brands";

// Live DB data behind auth — never prerender at build time.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const brands = await listBrands();

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Graphics Studio</h1>
      <p className="mt-2 text-muted">
        {brands.length === 0
          ? "No brands yet — add one to start generating on-brand graphics."
          : `${brands.length} brand${brands.length === 1 ? "" : "s"} in the vault.`}
      </p>

      <div className="mt-8 flex gap-3">
        <Link
          href="/brands/new"
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
        >
          Add a brand
        </Link>
        <Link
          href="/brands"
          className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-surface"
        >
          View all brands
        </Link>
      </div>

      {brands.length > 0 && (
        <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {brands.slice(0, 6).map((brand) => (
            <Link
              key={brand.id}
              href={`/brands/${brand.id}`}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent/40"
            >
              <span
                className="size-8 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: brand.primary_hex }}
                aria-hidden
              />
              <span className="font-medium">{brand.name}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
