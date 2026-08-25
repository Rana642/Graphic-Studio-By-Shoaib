import { listBrands } from "@/lib/brands";
import SubjectEditForm from "@/components/SubjectEditForm";

export const dynamic = "force-dynamic";

export default async function SubjectEditPage() {
  const brands = await listBrands();

  return (
    <div>
      <h1 className="font-serif italic text-3xl tracking-tight">
        Subject edit<span className="text-accent not-italic font-sans font-bold">.</span>
      </h1>
      <p className="mt-2 text-muted">
        Upload a real photo of a person or product — a salon client, a product shot — and
        describe a new scene around them. The subject stays visually unchanged; only the
        background/scene is AI-generated.
      </p>
      <div className="mt-8">
        <SubjectEditForm brands={brands.map((b) => ({ id: b.id, name: b.name }))} />
      </div>
    </div>
  );
}
