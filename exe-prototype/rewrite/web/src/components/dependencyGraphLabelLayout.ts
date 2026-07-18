import type { SpatialLodLevel } from "./projectDependencyGraphModel";

export type SpatialLabelAnchor = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  forced?: boolean;
};

export type PlacedSpatialLabel = SpatialLabelAnchor & {
  left: number;
  top: number;
  anchorIndex: number;
};

export type SpatialLabelLayoutResult = {
  placed: PlacedSpatialLabel[];
  collisionHiddenCount: number;
};

type Rect = { left: number; right: number; top: number; bottom: number };

const LABEL_GAP = 9;
const COLLISION_GAP = 5;
const VIEWPORT_INSET = 2;

/** The 2.1 label policy: all files up to 30, then semantic LOD caps. */
export function spatialLabelLimit(visibleFileCount: number, lodLevel: SpatialLodLevel): number {
  if (visibleFileCount <= 30) return visibleFileCount;
  return lodLevel === "far" ? 10 : lodLevel === "mid" ? 18 : 30;
}

/**
 * Deterministic eight-anchor screen layout. Inputs must already be sorted by
 * semantic priority; focused and hovered labels should set `forced`.
 */
export function layoutSpatialLabels(
  labels: SpatialLabelAnchor[],
  viewportWidth: number,
  viewportHeight: number
): SpatialLabelLayoutResult {
  const occupied: Rect[] = [];
  const placed: PlacedSpatialLabel[] = [];
  let collisionHiddenCount = 0;

  for (const label of labels) {
    const candidates = labelCandidates(label);
    let selected: { left: number; top: number; anchorIndex: number; rect: Rect } | null = null;
    for (let anchorIndex = 0; anchorIndex < candidates.length; anchorIndex += 1) {
      const candidate = candidates[anchorIndex];
      const rect = toRect(candidate.left, candidate.top, label.width, label.height);
      if (!insideViewport(rect, viewportWidth, viewportHeight)) continue;
      if (!label.forced && occupied.some((other) => intersects(rect, other))) continue;
      selected = { ...candidate, anchorIndex, rect };
      break;
    }

    if (!selected && label.forced) {
      const fallback = candidates[0];
      selected = {
        ...fallback,
        anchorIndex: 0,
        rect: toRect(fallback.left, fallback.top, label.width, label.height)
      };
    }
    if (!selected) {
      collisionHiddenCount += 1;
      continue;
    }

    occupied.push(selected.rect);
    placed.push({
      ...label,
      left: selected.left,
      top: selected.top,
      anchorIndex: selected.anchorIndex
    });
  }

  return { placed, collisionHiddenCount };
}

function labelCandidates(label: SpatialLabelAnchor): Array<{ left: number; top: number }> {
  const horizontal = label.width / 2 + LABEL_GAP;
  const vertical = label.height / 2 + LABEL_GAP;
  return [
    { left: label.x, top: label.y - vertical },
    { left: label.x, top: label.y + vertical },
    { left: label.x - horizontal, top: label.y },
    { left: label.x + horizontal, top: label.y },
    { left: label.x - horizontal, top: label.y - vertical },
    { left: label.x + horizontal, top: label.y - vertical },
    { left: label.x - horizontal, top: label.y + vertical },
    { left: label.x + horizontal, top: label.y + vertical }
  ];
}

function toRect(left: number, top: number, width: number, height: number): Rect {
  return {
    left: left - width / 2,
    right: left + width / 2,
    top: top - height / 2,
    bottom: top + height / 2
  };
}

function insideViewport(rect: Rect, width: number, height: number): boolean {
  return rect.left >= VIEWPORT_INSET
    && rect.right <= width - VIEWPORT_INSET
    && rect.top >= VIEWPORT_INSET
    && rect.bottom <= height - VIEWPORT_INSET;
}

function intersects(left: Rect, right: Rect): boolean {
  return !(
    left.right + COLLISION_GAP < right.left
    || left.left - COLLISION_GAP > right.right
    || left.bottom + COLLISION_GAP < right.top
    || left.top - COLLISION_GAP > right.bottom
  );
}
