import test from "node:test";
import assert from "node:assert/strict";
import { SendCooldown } from "../server/cooldown.js";

const T0 = 1_700_000_000_000;

test("冷却：首次发送放行，紧接着第二次被挡下并给出剩余秒数", () => {
  const guard = new SendCooldown({ cooldownMs: 60_000, windowMs: 3_600_000, maxPerWindow: 10 });

  const first = guard.take("ip|reset|alice", T0);
  assert.equal(first.ok, true);
  assert.equal(first.retryAfter, 0);

  const second = guard.take("ip|reset|alice", T0 + 1000);
  assert.equal(second.ok, false);
  assert.equal(second.retryAfter, 59);

  // 冷却到期后放行
  const third = guard.take("ip|reset|alice", T0 + 60_000);
  assert.equal(third.ok, true);
});

test("冷却：不同 key 互不影响（不同账号、不同 IP 各自独立）", () => {
  const guard = new SendCooldown({ cooldownMs: 60_000 });

  assert.equal(guard.take("ipA|reset|alice", T0).ok, true);
  // 同一个 IP 换一个账号：不受 alice 的冷却影响
  assert.equal(guard.take("ipA|reset|bob", T0 + 1000).ok, true);
  // 换 IP 请求同一账号：不受影响
  assert.equal(guard.take("ipB|reset|alice", T0 + 1000).ok, true);
  // 完全相同的 key 才拦
  assert.equal(guard.take("ipA|reset|alice", T0 + 2000).ok, false);
});

test("配额：窗口内超过上限后拒绝，并给出最早一条滑出窗口的等待时间", () => {
  const guard = new SendCooldown({ cooldownMs: 0, windowMs: 60_000, maxPerWindow: 3 });

  for (let i = 0; i < 3; i++) {
    const r = guard.take("key", T0 + i * 1000);
    assert.equal(r.ok, true, `第 ${i + 1} 次应放行`);
  }

  const blocked = guard.take("key", T0 + 10_000);
  assert.equal(blocked.ok, false);
  // 最早一次在 T0，60 秒后滑出窗口 -> T0+10s 时还应等 50 秒
  assert.equal(blocked.retryAfter, 50);

  // 窗口滑过最早一条后恢复
  const resumed = guard.take("key", T0 + 60_000);
  assert.equal(resumed.ok, true);
});

test("配额：被拒的请求不占用名额（不叠加惩罚）", () => {
  const guard = new SendCooldown({ cooldownMs: 60_000, windowMs: 3_600_000, maxPerWindow: 2 });

  assert.equal(guard.take("k", T0).ok, true);
  for (let i = 0; i < 20; i++) guard.take("k", T0 + 1000);
  // 冷却结束后仍应有 1 个名额（被拒的 20 次没占位）
  assert.equal(guard.take("k", T0 + 60_000).ok, true);
  assert.equal(guard.take("k", T0 + 120_000).ok, false);
});

test("冷却：窗口外的旧记录会被清理，不会让内存无限增长", () => {
  const guard = new SendCooldown({ cooldownMs: 60_000, windowMs: 1000, maxPerWindow: 10 });

  guard.take("k", T0);
  assert.equal(guard.take("k", T0 + 5000).ok, true);
  assert.equal(guard.size, 1);

  guard.clear("k");
  assert.equal(guard.size, 0);
  assert.equal(guard.take("k", T0 + 6000).ok, true);
});

test("默认参数：60 秒冷却、每小时 10 次", () => {
  const guard = new SendCooldown();
  assert.equal(guard.take("d", T0).ok, true);
  assert.equal(guard.take("d", T0 + 30_000).retryAfter, 30);

  let allowed = 0;
  for (let i = 1; i <= 20; i++) {
    if (guard.take("e", T0 + i * 60_000).ok && i * 60_000 < 3_600_000) allowed++;
  }
  // 第 1 次 + 之后每分钟 1 次，一小时内最多 10 次
  assert.equal(allowed, 10);
});
