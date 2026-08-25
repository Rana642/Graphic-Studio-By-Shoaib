"use client";

import { useState } from "react";
import type { CostedGeneration } from "@/lib/costs";

export default function CostCalculator({ generations }: { generations: CostedGeneration[] }) {
  const complete = generations.filter((g) => g.status === "complete");
  const totalCost = complete.reduce((sum, g) => sum + (g.est_cost_usd || 0), 0);
  const [pricePerImage, setPricePerImage] = useState("");

  const price = parseFloat(pricePerImage) || 0;
  const revenue = price * complete.length;
  const profit = revenue - totalCost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  return (
    <div>
      <div className="rounded-xl border border-border bg-surface p-5">
        <p className="font-mono uppercase text-xs tracking-widest text-muted">
          Pricing calculator
        </p>
        <div className="mt-4 flex items-end gap-4">
          <div>
            <label htmlFor="price" className="mb-1.5 block text-sm text-muted">
              Your sale price per image ($)
            </label>
            <input
              id="price"
              type="number"
              step="0.01"
              min="0"
              value={pricePerImage}
              onChange={(e) => setPricePerImage(e.target.value)}
              placeholder="0.00"
              className="w-40 rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
            />
          </div>
          <p className="pb-2.5 text-sm text-muted">× {complete.length} images generated</p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted">Your cost</p>
            <p className="mt-1 text-lg font-medium">${totalCost.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Revenue</p>
            <p className="mt-1 text-lg font-medium">${revenue.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Profit</p>
            <p className={`mt-1 text-lg font-medium ${profit < 0 ? "text-danger" : ""}`}>
              ${profit.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Margin</p>
            <p className={`mt-1 text-lg font-medium ${margin < 0 ? "text-danger" : ""}`}>
              {price > 0 ? `${margin.toFixed(0)}%` : "—"}
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted">
          This is a calculator only — it doesn't save anything. Once you've settled on a price,
          add it as a line item in your Ads by Shoaib dashboard to actually issue the invoice.
        </p>
      </div>

      <div className="mt-8 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[560px] text-left">
          <thead>
            <tr className="border-b border-border bg-surface text-sm text-muted">
              <th className="px-4 py-3 font-medium">Placement</th>
              <th className="px-4 py-3 font-medium">Model</th>
              <th className="px-4 py-3 font-medium">Cost</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {generations.map((g) => (
              <tr key={g.id} className="border-b border-border text-sm last:border-0">
                <td className="px-4 py-3">{g.placement}</td>
                <td className="px-4 py-3 text-muted">{g.model_used || "—"}</td>
                <td className="px-4 py-3">
                  {g.est_cost_usd != null ? `$${g.est_cost_usd.toFixed(3)}` : "—"}
                </td>
                <td className="px-4 py-3">
                  <span className={g.status === "failed" ? "text-danger" : "text-muted"}>
                    {g.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted">
                  {new Date(g.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
