import Link from "next/link";
import { getCostSummaryByBrand } from "@/lib/costs";

export const dynamic = "force-dynamic";

export default async function CostsPage() {
  const summaries = await getCostSummaryByBrand();
  const withGenerations = summaries.filter((s) => s.generationCount > 0);
  const grandTotal = withGenerations.reduce((sum, s) => sum + s.totalCostUsd, 0);

  return (
    <div>
      <h1 className="font-serif italic text-3xl tracking-tight">
        Costs<span className="text-accent not-italic font-sans font-bold">.</span>
      </h1>
      <p className="mt-2 text-muted">
        What generation actually costs, per brand — for pricing your own invoices. Only
        successful generations carry real cost; failed attempts didn't produce a billable image.
      </p>

      {withGenerations.length === 0 ? (
        <p className="mt-8 text-muted">No generations yet.</p>
      ) : (
        <>
          <div className="mt-8 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[520px] text-left">
              <thead>
                <tr className="border-b border-border bg-surface text-sm text-muted">
                  <th className="px-4 py-3 font-medium">Brand</th>
                  <th className="px-4 py-3 font-medium">Images generated</th>
                  <th className="px-4 py-3 font-medium">Total cost</th>
                  <th className="px-4 py-3 font-medium">Avg / image</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {withGenerations
                  .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
                  .map((s) => (
                    <tr key={s.brandId} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-medium">{s.brandName}</td>
                      <td className="px-4 py-3 text-sm">
                        {s.completeCount}
                        {s.generationCount !== s.completeCount && (
                          <span className="text-muted">
                            {" "}
                            ({s.generationCount - s.completeCount} failed)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">
                        ${s.totalCostUsd.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted">
                        {s.completeCount > 0
                          ? `$${(s.totalCostUsd / s.completeCount).toFixed(3)}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/brands/${s.brandId}/costs`}
                          className="text-sm text-accent hover:underline"
                        >
                          Details →
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm text-muted">
            Total across all brands: <span className="font-medium text-foreground">
              ${grandTotal.toFixed(2)}
            </span>
          </p>
        </>
      )}
    </div>
  );
}
