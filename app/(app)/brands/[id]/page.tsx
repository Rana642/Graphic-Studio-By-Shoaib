import { notFound } from "next/navigation";
import Link from "next/link";
import { getBrand } from "@/lib/brands";
import { listReferencesForBrand } from "@/lib/references";
import { updateBrandAction, deleteBrandAction } from "@/lib/actions/brands";
import BrandForm from "@/components/BrandForm";
import DeleteButton from "@/components/DeleteButton";
import ReferenceImages from "@/components/ReferenceImages";

export const dynamic = "force-dynamic";

export default async function BrandDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const brand = await getBrand(id);
  if (!brand) notFound();

  const references = await listReferencesForBrand(id);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-serif italic text-3xl tracking-tight">{brand.name}</h1>
        <div className="flex gap-3">
          <Link
            href={`/brands/${id}/generate`}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
          >
            Generate
          </Link>
          <Link
            href={`/brands/${id}/costs`}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-background"
          >
            Costs
          </Link>
          <DeleteButton action={deleteBrandAction.bind(null, id)} />
        </div>
      </div>
      <div className="mt-8">
        <BrandForm brand={brand} action={updateBrandAction.bind(null, id)} />
      </div>
      <div className="mt-12 max-w-2xl border-t border-border pt-8">
        <ReferenceImages brandId={id} references={references} />
      </div>
    </div>
  );
}
