import { listBrands } from "@/lib/brands";
import MarkupEditForm from "@/components/MarkupEditForm";

export const dynamic = "force-dynamic";

export default async function MarkupEditPage() {
  const brands = await listBrands();

  return (
    <div>
      <h1 className="font-serif italic text-3xl tracking-tight">
        Markup edit<span className="text-accent not-italic font-sans font-bold">.</span>
      </h1>
      <p className="mt-2 text-muted">
        Upload an image, draw on the places that should change, and say what the change is. GPT
        Image 2.6 edits only the marked places and keeps the rest as it is.
      </p>
      <div className="mt-8">
        <MarkupEditForm brands={brands.map((b) => ({ id: b.id, name: b.name }))} />
      </div>
    </div>
  );
}
