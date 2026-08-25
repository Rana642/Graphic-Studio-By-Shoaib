import { notFound } from "next/navigation";
import Link from "next/link";
import { getBrand } from "@/lib/brands";
import { updateBrandAction, deleteBrandAction } from "@/lib/actions/brands";
import BrandForm from "@/components/BrandForm";
import DeleteButton from "@/components/DeleteButton";

export const dynamic = "force-dynamic";

export default async function BrandDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const brand = await getBrand(id);
  if (!brand) notFound();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{brand.name}</h1>
        <div className="flex gap-3">
          <Link
            href={`/brands/${id}/generate`}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
          >
            Generate
          </Link>
          <DeleteButton action={deleteBrandAction.bind(null, id)} />
        </div>
      </div>
      <div className="mt-8">
        <BrandForm brand={brand} action={updateBrandAction.bind(null, id)} />
      </div>
    </div>
  );
}
