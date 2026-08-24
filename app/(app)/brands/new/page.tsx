import BrandForm from "@/components/BrandForm";
import { createBrandAction } from "@/lib/actions/brands";

export default function NewBrandPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Add a brand</h1>
      <p className="mt-2 text-muted">
        This is the brand kit every generation will lock to — logo, colors, type, voice.
      </p>
      <div className="mt-8">
        <BrandForm action={createBrandAction} />
      </div>
    </div>
  );
}
