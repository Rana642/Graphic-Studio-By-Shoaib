import { notFound } from "next/navigation";
import { getBrand } from "@/lib/brands";

export const dynamic = "force-dynamic";
import { updateBrandAction, deleteBrandAction } from "@/lib/actions/brands";
import BrandForm from "@/components/BrandForm";
import DeleteButton from "@/components/DeleteButton";

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
        <DeleteButton action={deleteBrandAction.bind(null, id)} />
      </div>
      <div className="mt-8">
        <BrandForm brand={brand} action={updateBrandAction.bind(null, id)} />
      </div>
    </div>
  );
}
