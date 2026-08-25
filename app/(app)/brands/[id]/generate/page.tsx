import { notFound } from "next/navigation";
import Link from "next/link";
import { getBrand } from "@/lib/brands";
import GenerateForm from "@/components/GenerateForm";

export const dynamic = "force-dynamic";

export default async function GenerateBrandPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const brand = await getBrand(id);
  if (!brand) notFound();

  return (
    <div>
      <Link href={`/brands/${id}`} className="text-sm text-muted hover:text-foreground">
        ← {brand.name}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Generate for {brand.name}</h1>
      <p className="mt-2 text-muted">
        Locked to this brand's colors, font, and voice — nothing here can drift to another
        brand's identity.
      </p>
      <div className="mt-8">
        <GenerateForm brandId={id} />
      </div>
    </div>
  );
}
