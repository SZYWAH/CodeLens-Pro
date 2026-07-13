import type { ActivityConstellationData, ActivityStarItem } from "../types";
import { ActivityGalaxyCanvas } from "./ActivityGalaxyCanvas";

type ActivityGalaxyMode = "entry" | "explore";

export function ActivityGalaxyView({
  constellation,
  mode = "explore",
  onRefresh,
  onEnterWorkbench,
  onOpenActivity
}: {
  constellation: ActivityConstellationData | null;
  mode?: ActivityGalaxyMode;
  onRefresh: () => void | Promise<void>;
  onEnterWorkbench: () => void;
  onOpenActivity: (item: ActivityStarItem) => void | Promise<void>;
}) {
  const codeLineCount = Math.min(Math.max(constellation?.code_line_count || 0, 0), 12000);

  return (
    <ActivityGalaxyCanvas
      codeLineCount={codeLineCount}
      items={constellation?.items || []}
      mode={mode}
      onBack={onEnterWorkbench}
      onBlankClick={mode === "entry" ? onEnterWorkbench : undefined}
      onOpenActivity={onOpenActivity}
    />
  );
}
