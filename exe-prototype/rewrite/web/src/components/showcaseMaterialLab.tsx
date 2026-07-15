import type { ShowcaseMaterialProfile } from "./ActivityGalaxyCanvas";

export const showcaseMaterialLabEnabled = false;
export const showcaseMaterialDefaultProfile: ShowcaseMaterialProfile = "liquid";

export function ShowcaseMaterialLab(_props: {
  value: ShowcaseMaterialProfile;
  onChange: (value: ShowcaseMaterialProfile) => void;
}) {
  return null;
}
