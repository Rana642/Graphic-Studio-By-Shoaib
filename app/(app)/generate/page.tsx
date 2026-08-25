import { listBrands } from "@/lib/brands";
import PromptGenerateForm from "@/components/PromptGenerateForm";

export const dynamic = "force-dynamic";

export default async function GenerateFromPromptPage() {
  const brands = await listBrands();

  return (
    <div>
      <h1 className="font-serif italic text-3xl tracking-tight">
        Generate from prompt<span className="text-accent not-italic font-sans font-bold">.</span>
      </h1>
      <p className="mt-2 text-muted">
        No brand required — write the full creative brief yourself and generate directly. For
        on-brand graphics locked to a client&apos;s colors and voice, use a brand&apos;s own
        Generate page instead.
      </p>
      <div className="mt-8">
        <PromptGenerateForm brands={brands.map((b) => ({ id: b.id, name: b.name }))} />
      </div>
    </div>
  );
}
