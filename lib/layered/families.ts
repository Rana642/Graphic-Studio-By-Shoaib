import type { Placement } from "../placements";

/**
 * One AI background can serve several sizes: a size whose shape is close to
 * the group's first (master) size is cropped from the master's background
 * instead of paying for its own. A size more than 1.5x different in shape
 * (e.g. a 4:1 cover next to a 1.91:1 ad) gets a background of its own.
 */
const MAX_SHAPE_DIFFERENCE = 1.5;

export type PlacementGroup = { master: Placement; members: Placement[] };

const shape = (p: Placement) => p.width / p.height;
const differenceOf = (a: Placement, b: Placement) => Math.max(shape(a), shape(b)) / Math.min(shape(a), shape(b));

export function groupPlacements(placements: Placement[]): PlacementGroup[] {
  const groups: PlacementGroup[] = [];
  // Narrowest shape first, so the tallest placement is the master and its neighbours crop from it.
  for (const p of [...placements].sort((a, b) => shape(a) - shape(b))) {
    const home = groups.find((g) => differenceOf(g.master, p) <= MAX_SHAPE_DIFFERENCE);
    if (home) home.members.push(p);
    else groups.push({ master: p, members: [p] });
  }
  return groups;
}
