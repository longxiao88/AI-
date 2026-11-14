import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { useI18n } from "../lib/i18n";

const Context = createContext({
  enabled: true,
  reduced: false,
  toggle: () => {},
});

export const useMotion = () => useContext(Context);

export function MotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [allowed, setAllowed] = useState(() => {
    try {
      return localStorage.getItem("ai-office-motion") !== "off";
    } catch {
      return true;
    }
  });
  const enabled = allowed && !reduced;

  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.motion = enabled ? "on" : "off";
  }, [enabled]);

  return (
    <Context.Provider
      value={{
        enabled,
        reduced,
        toggle: () => {
          const next = !allowed;
          setAllowed(next);
          try {
            localStorage.setItem("ai-office-motion", next ? "on" : "off");
          } catch {}
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function MotionToggle() {
  const { enabled, reduced, toggle } = useMotion();
  const { t } = useI18n();

  return (
    <button
      className="motion-toggle"
      onClick={toggle}
      disabled={reduced}
      aria-label={enabled ? t("toggle.motionDisable") : t("toggle.motionEnable")}
      aria-pressed={enabled}
      title={t("toggle.motionHint")}
    >
      <Sparkles size={17} />
      <span>{enabled ? t("toggle.motionOn") : t("toggle.motionOff")}</span>
    </button>
  );
}
