import type { ShowcaseMaterialProfile } from "../components/ActivityGalaxyCanvas";
import "./showcase-material-lab.css";

const profiles: Array<{ value: ShowcaseMaterialProfile; label: string; detail: string }> = [
  { value: "optical", label: "A 无色水晶", detail: "背景透射与珍珠银倒角" },
  { value: "liquid", label: "B 液态镜片", detail: "局部法线扰动与冰蓝焦散" },
  { value: "dispersion", label: "C 轻色散", detail: "曲面转折处极弱冷色散" }
];

export const showcaseMaterialLabEnabled = true;
export const showcaseMaterialDefaultProfile: ShowcaseMaterialProfile = "optical";

export function ShowcaseMaterialLab({
  value,
  onChange
}: {
  value: ShowcaseMaterialProfile;
  onChange: (value: ShowcaseMaterialProfile) => void;
}) {
  return (
    <aside aria-label="水晶材质方案" className="showcase-material-lab-v1417">
      <span>材质方案</span>
      <div role="tablist" aria-label="选择材质方案">
        {profiles.map((profile) => (
          <button
            aria-selected={value === profile.value}
            className={value === profile.value ? "is-active" : ""}
            key={profile.value}
            onClick={() => onChange(profile.value)}
            role="tab"
            title={profile.detail}
            type="button"
          >
            <strong>{profile.label}</strong>
            <small>{profile.detail}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}
