export interface TimerState {
  mode: "countdown" | "stopwatch";
  running: boolean;
  /** 上次开始/暂停时的读数（倒计时为剩余时间，秒表为已用时间） */
  baseMs: number;
  startedAt: number;
  durationMs: number;
}

/** 根据状态和当前时间算出读数。不依赖 setInterval 累加，切页面或后台挂起也不会走偏。 */
export function timerValue(state: TimerState, now: number) {
  const elapsed = state.running ? Math.max(0, now - state.startedAt) : 0;
  return state.mode === "countdown" ? Math.max(0, state.baseMs - elapsed) : state.baseMs + elapsed;
}

export function formatDuration(ms: number) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}
