import Link from "next/link";
import { listBrands } from "@/lib/brands";

export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  const brands = await listBrands();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-serif italic text-3xl tracking-tight">
          Brands<span className="text-accent not-italic font-sans font-bold">.</span>
        </h1>
        <Link
          href="/brands/new"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
        >
          Add brand
        </Link>
      </div>

      {brands.length === 0 ? (
        <p className="mt-8 text-muted">No brands yet.</p>
      ) : (
        <ul className="mt-8 divide-y divide-border rounded-xl border border-border bg-surface">
          {brands.map((brand) => (
            <li key={brand.id}>
              <Link
                href={`/brands/${brand.id}`}
                className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-background"
              >
                <span
                  className="size-9 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: brand.primary_hex }}
                  aria-hidden
                />
                <div>
                  <p className="font-medium">{brand.name}</p>
                  {brand.font_family && (
                    <p className="text-sm text-muted">{brand.font_family}</p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
