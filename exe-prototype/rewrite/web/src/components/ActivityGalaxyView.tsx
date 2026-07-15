import { useEffect, useState } from "react";
import type { ActivityConstellationData, ActivityStarItem } from "../types";
import { ActivityGalaxyCanvas, type ShowcaseMaterialProfile } from "./ActivityGalaxyCanvas";
import {
  ShowcaseMaterialLab,
  showcaseMaterialDefaultProfile,
  showcaseMaterialLabEnabled
} from "./showcaseMaterialLab";

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
  const [materialProfile, setMaterialProfile] = useState<ShowcaseMaterialProfile>(() => {
    if (!showcaseMaterialLabEnabled || typeof window === "undefined") return showcaseMaterialDefaultProfile;
    const requested = new URL(window.location.href).searchParams.get("material");
    return requested === "liquid" || requested === "dispersion" ? requested : showcaseMaterialDefaultProfile;
  });

  useEffect(() => {
    if (!showcaseMaterialLabEnabled || materialProfile === "legacy") return;
    const url = new URL(window.location.href);
    url.searchParams.set("material", materialProfile);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [materialProfile]);

  return (
    <>
      <ActivityGalaxyCanvas
        codeLineCount={codeLineCount}
        items={constellation?.items || []}
        materialProfile={materialProfile}
        mode={mode}
        onBack={onEnterWorkbench}
        onBlankClick={mode === "entry" ? onEnterWorkbench : undefined}
        onOpenActivity={onOpenActivity}
      />
      <ShowcaseMaterialLab value={materialProfile} onChange={setMaterialProfile} />
    </>
  );
}
