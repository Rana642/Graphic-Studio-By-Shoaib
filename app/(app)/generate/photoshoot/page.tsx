import { listBrands } from "@/lib/brands";
import { listRecentPhotoshoots, type PhotoshootGroup } from "@/lib/photoshoot";
import { getPhotoshootMode } from "@/lib/photoshoot-modes";
import PhotoshootForm from "@/components/PhotoshootForm";
import PhotoshootConcepts from "@/components/PhotoshootConcepts";

export const dynamic = "force-dynamic";

export default async function PhotoshootPage() {
  const brands = await listBrands();
  const names = new Map(brands.map((b) => [b.id, b.name]));
  let recent: PhotoshootGroup[] = [];
  let problem: string | null = null;
  try {
    recent = await listRecentPhotoshoots();
  } catch (err) {
    problem = err instanceof Error ? err.message : String(err);
  }

  return (
    <div>
      <h1 className="font-serif italic text-3xl tracking-tight">
        Product photoshoot<span className="text-accent not-italic font-sans font-bold">.</span>
      </h1>
      <p className="mt-2 max-w-2xl text-muted">
        Upload the product, pick a mode, and get cheap Draft concepts first. Approve the ones you like — only those are
        made again as Standard or Premium finals.
      </p>

      <div className="mt-8">
        <PhotoshootForm brands={brands.map((b) => ({ id: b.id, name: b.name }))} />
      </div>

      <div id="recent" className="mt-14 scroll-mt-6 border-t border-border pt-8">
        <h2 className="font-serif italic text-2xl tracking-tight">Recent photoshoots</h2>
        <p className="mt-1 text-sm text-muted">Approve the Draft concepts you like, then make them final at Standard or Premium.</p>
        {problem && <p className="mt-4 rounded-lg border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">{problem}</p>}
        {!problem && recent.length === 0 && <p className="mt-4 text-sm text-muted">None yet.</p>}
        <div className="mt-6 space-y-10">
          {recent.map((g) => (
            <section key={g.batchId}>
              <p className="mb-3 text-sm">
                <span className="font-medium">{getPhotoshootMode(g.mode ?? "")?.label ?? g.mode}</span>
                <span className="text-muted">
                  {" · "}
                  {g.brandId ? names.get(g.brandId) ?? "Deleted brand" : "No brand"}
                  {" · "}
                  {new Date(g.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" })}
                </span>
              </p>
              <PhotoshootConcepts concepts={g.concepts} />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
