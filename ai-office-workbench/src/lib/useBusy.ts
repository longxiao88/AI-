import { useState } from "react";

/**
 * 包装一个异步操作，执行期间 busy 为 true。
 * onBusy 用来通知外层（例如 AI 生成时禁止切换页面）。
 */
export function useBusy(onBusy?: (value: boolean) => void) {
  const [busy, setBusy] = useState(false);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    onBusy?.(true);
    try {
      await task();
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }

  return [busy, run] as const;
}
