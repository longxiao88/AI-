import { useEffect, useState } from "react";
import { Play, Pause, RotateCcw, Clock3 } from "lucide-react";
import { timerValue, formatDuration, type TimerState } from "../../shared/timer";
import { Button, Field, Notice, useConfirm } from "../components/ui";
import { useI18n } from "../lib/i18n";

const STORAGE_KEY = "office-timer";

const initial: TimerState = {
  mode: "countdown",
  running: false,
  baseMs: 25 * 60000,
  startedAt: 0,
  durationMs: 25 * 60000,
};

/** 计时状态存在 sessionStorage，切换页面回来后可以继续。读到的数据不合法就用默认值。 */
function load(): TimerState {
  try {
    const s = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    if (
      s &&
      ["countdown", "stopwatch"].includes(s.mode) &&
      ["baseMs", "startedAt", "durationMs"].every((k) => Number.isFinite(s[k]) && s[k] >= 0) &&
      typeof s.running === "boolean"
    )
      return s;
  } catch {
    // 存储不可用或内容损坏
  }
  return initial;
}

export function LiveTime() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span className="live-time tabular-nums">
      {now.toLocaleTimeString("zh-CN", { hour12: false })}
    </span>
  );
}

export function Clock() {
  const { t, locale } = useI18n();
  const [state, setState] = useState(load);
  const [now, setNow] = useState(Date.now());
  const [minutes, setMinutes] = useState(Math.round(state.durationMs / 60000));
  const [error, setError] = useState("");
  const confirm = useConfirm();
  const value = timerValue(state, now);
  const done = state.mode === "countdown" && value === 0;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      setError(t("clock.storageWarn"));
    }
  }, [state]);

  useEffect(() => {
    if (done && state.running) setState((s) => ({ ...s, running: false, baseMs: 0, startedAt: 0 }));
  }, [done, state.running]);

  async function reset(mode = state.mode, duration = state.durationMs) {
    if (state.running && !(await confirm(t("clock.resetConfirm")))) return;
    setState({
      mode,
      running: false,
      baseMs: mode === "countdown" ? duration : 0,
      startedAt: 0,
      durationMs: duration,
    });
    setNow(Date.now());
  }

  function toggle() {
    const at = Date.now();
    setNow(at);
    setState((s) => ({
      ...s,
      running: !s.running,
      baseMs: timerValue(s, at),
      startedAt: at,
    }));
  }

  return (
    <div className="clock-grid">
      <section className="panel world-clock">
        <span className="eyebrow">{t("clock.eyebrow")}</span>
        <LiveTime />
        <p>
          {new Date(now).toLocaleDateString(locale, {
            year: "numeric",
            month: "long",
            day: "numeric",
            weekday: "long",
          })}
        </p>
        <small>{Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
        <Clock3 size={90} strokeWidth={0.5} />
      </section>
      <section className="panel timer-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{t("clock.heading")}</h2>
          <div className="timer-tabs">
            <Button
              variant={state.mode === "countdown" ? "primary" : "secondary"}
              onClick={() => void reset("countdown")}
            >
              {t("clock.countdown")}
            </Button>
            <Button
              variant={state.mode === "stopwatch" ? "primary" : "secondary"}
              onClick={() => void reset("stopwatch")}
            >
              {t("clock.stopwatch")}
            </Button>
          </div>
        </div>
        <Notice error={error} />
        <div className="timer-face">
          <span className="eyebrow">
            {done ? "SESSION COMPLETE" : state.running ? "FOCUS IN PROGRESS" : "READY WHEN YOU ARE"}
          </span>
          <output aria-label={t("clock.value")}>{formatDuration(value)}</output>
          <p role="status">
            {done
              ? t("clock.done")
              : state.running
                ? t("clock.running")
                : t("clock.lead")}
          </p>
        </div>
        {state.mode === "countdown" && (
          <div className="timer-presets">
            {[5, 25, 45].map((n) => (
              <Button
                key={n}
                onClick={() => {
                  setMinutes(n);
                  void reset("countdown", n * 60000);
                }}
              >
                {n} 分钟
              </Button>
            ))}
            <Field label={t("clock.customMinutes")}>
              <input
                type="number"
                min={1}
                max={180}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />
            </Field>
            <Button
              disabled={!Number.isInteger(minutes) || minutes < 1 || minutes > 180}
              onClick={() => void reset("countdown", minutes * 60000)}
            >
              {t("clock.set")}
            </Button>
          </div>
        )}
        <div className="flex justify-center gap-3">
          <Button variant="primary" disabled={done} onClick={toggle}>
            {state.running ? <Pause size={17} /> : <Play size={17} />}
            {state.running ? t("clock.pause") : t("clock.start")}
          </Button>
          <Button onClick={() => void reset()}>
            <RotateCcw size={17} />
            {t("clock.reset")}
          </Button>
        </div>
      </section>
    </div>
  );
}
