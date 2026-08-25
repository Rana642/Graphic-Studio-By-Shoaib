import { notFound } from "next/navigation";
import Link from "next/link";
import { getBrand } from "@/lib/brands";
import { getCostedGenerationsForBrand } from "@/lib/costs";
import CostCalculator from "@/components/CostCalculator";

export const dynamic = "force-dynamic";

export default async function BrandCostsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const brand = await getBrand(id);
  if (!brand) notFound();

  const generations = await getCostedGenerationsForBrand(id);

  return (
    <div>
      <Link href={`/brands/${id}`} className="text-sm text-muted hover:text-foreground">
        ← {brand.name}
      </Link>
      <h1 className="mt-2 font-serif italic text-3xl tracking-tight">
        Costs for {brand.name}
      </h1>

      {generations.length === 0 ? (
        <p className="mt-8 text-muted">No generations for this brand yet.</p>
      ) : (
        <div className="mt-8">
          <CostCalculator generations={generations} />
        </div>
      )}
    </div>
  );
}
