import { listBrands } from "@/lib/brands";
import AssetLockedForm from "@/components/AssetLockedForm";

export const dynamic = "force-dynamic";

export default async function AssetLockedPage() {
  const brands = await listBrands();

  return (
    <div>
      <h1 className="font-serif italic text-3xl tracking-tight">
        Real estate / event<span className="text-accent not-italic font-sans font-bold">.</span>
      </h1>
      <p className="mt-2 text-muted">
        The photo/3D-render you upload is composited exactly as-is — never touched by AI. Only the
        frame around it (typography, badges, banners) is generated. Free — no AI model call.
      </p>
      <div className="mt-8">
        <AssetLockedForm brands={brands.map((b) => ({ id: b.id, name: b.name }))} />
      </div>
    </div>
  );
}
