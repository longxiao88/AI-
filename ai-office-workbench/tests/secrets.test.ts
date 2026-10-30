import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../server/db.js";
import { decryptSecret, encryptSecret, isEncrypted, resetKeyCache } from "../server/secrets.js";
import {
  migrateSmtpSecret,
  readStoredSmtp,
  resolveSmtp,
  saveSmtp,
  smtpFromEnv,
  smtpView,
} from "../server/smtp.js";

/** 建一个临时的、带真实文件的数据库目录，用于验证密钥文件确实落盘 */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "office-secrets-"));
  return {
    dir,
    keyPath: join(dir, ".mail-key"),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const CODE = "abcd1234efgh5678";
const ENV_KEYS = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_PORT", "SMTP_SECURE"];

test("授权码加密：加解密往返一致，密文不包含明文，且重复加密幂等", () => {
  const t = tempDir();
  try {
    const cipher = encryptSecret(CODE, t.keyPath);

    assert.ok(isEncrypted(cipher), "应输出带 enc:v1: 前缀的密文");
    assert.ok(!cipher.includes(CODE), "密文里不能出现明文");
    assert.notEqual(cipher, CODE);
    assert.equal(decryptSecret(cipher, t.keyPath), CODE, "解密应还原原文");

    // 幂等：对已是密文的值再加密应原样返回，避免二次加密
    assert.equal(encryptSecret(cipher, t.keyPath), cipher);

    // 空值不产生密文
    assert.equal(encryptSecret("", t.keyPath), "");
    assert.equal(decryptSecret("", t.keyPath), "");
  } finally {
    t.dispose();
    resetKeyCache();
  }
});

test("授权码加密：密钥文件落盘，且旧版明文可原样读回（升级无需迁移）", () => {
  const t = tempDir();
  try {
    encryptSecret(CODE, t.keyPath);
    assert.ok(existsSync(t.keyPath), "首次加密应生成密钥文件");
    // 密钥是 32 字节，以十六进制保存即 64 个字符
    assert.equal(readFileSync(t.keyPath, "utf8").trim().length, 64);

    // 旧版本直接把授权码明文写在 app_config 里，升级后必须仍然能发信
    assert.equal(decryptSecret("legacy-plaintext", t.keyPath), "legacy-plaintext");
    assert.ok(!isEncrypted("legacy-plaintext"));
  } finally {
    t.dispose();
    resetKeyCache();
  }
});

test("授权码加密：密文被篡改时解密失败（GCM 完整性校验）", () => {
  const t = tempDir();
  try {
    const cipher = encryptSecret(CODE, t.keyPath);
    // 改动密文最后一个十六进制字符
    const tampered = cipher.slice(0, -1) + (cipher.endsWith("0") ? "1" : "0");
    assert.throws(() => decryptSecret(tampered, t.keyPath));
  } finally {
    t.dispose();
    resetKeyCache();
  }
});

test("SMTP：入库的授权码是密文，接口视图只返回 configured 不泄露授权码", () => {
  const t = tempDir();
  const store = createStore(join(t.dir, "test.sqlite"));
  try {
    const view = saveSmtp(store, {
      host: "smtp.qq.com",
      port: 465,
      secure: true,
      user: "someone@qq.com",
      pass: CODE,
      fromName: "AI 办公助手",
    });

    // 数据库里存的必须是密文
    const raw = store.getAppConfig("smtp")!;
    assert.ok(isEncrypted(JSON.parse(raw).pass), "入库的授权码必须加密");
    assert.ok(!raw.includes(CODE), "数据库内容不能含授权码明文");

    // 给前端的视图不含授权码本身
    assert.equal(view.configured, true);
    assert.equal(view.user, "someone@qq.com");
    assert.equal(view.managedByEnv, false);
    assert.ok(!("pass" in view), "视图不应包含授权码字段");

    // 读取时解密，能用于发信
    assert.equal(readStoredSmtp(store)?.pass, CODE);
    assert.equal(resolveSmtp(store)?.pass, CODE);
  } finally {
    store.db.close();
    t.dispose();
    resetKeyCache();
  }
});

test("SMTP：授权码留空表示沿用原值，clearPass 才清除", () => {
  const t = tempDir();
  const store = createStore(join(t.dir, "test.sqlite"));
  const base = { host: "smtp.qq.com", port: 465, secure: true, user: "someone@qq.com" };
  try {
    saveSmtp(store, { ...base, pass: CODE });
    saveSmtp(store, { ...base, user: "changed@qq.com" });
    assert.equal(readStoredSmtp(store)?.pass, CODE, "留空应保留原授权码");

    saveSmtp(store, { ...base, clearPass: true });
    assert.equal(readStoredSmtp(store)?.pass, "", "clearPass 应清空授权码");
    assert.equal(smtpView(store).configured, false);
  } finally {
    store.db.close();
    t.dispose();
    resetKeyCache();
  }
});

test("SMTP：启动时把旧版明文授权码就地升级为密文，且不改变可用性", () => {
  const t = tempDir();
  const store = createStore(join(t.dir, "test.sqlite"));
  try {
    // 模拟旧版本留下的明文配置
    store.setAppConfig(
      "smtp",
      JSON.stringify({
        host: "smtp.qq.com",
        port: 465,
        secure: true,
        user: "legacy@qq.com",
        pass: "legacy-plain-code",
        fromName: "",
      }),
    );
    assert.ok(store.getAppConfig("smtp")!.includes("legacy-plain-code"), "前置条件：此时是明文");

    assert.equal(migrateSmtpSecret(store), true, "应当执行了升级");
    const migrated = store.getAppConfig("smtp")!;
    assert.ok(!migrated.includes("legacy-plain-code"), "升级后库里不能再有明文");
    assert.ok(isEncrypted(JSON.parse(migrated).pass), "升级后应为密文");

    // 升级后仍能正常发信，且重复调用不再改动
    assert.equal(readStoredSmtp(store)?.pass, "legacy-plain-code");
    assert.equal(resolveSmtp(store)?.pass, "legacy-plain-code");
    assert.equal(migrateSmtpSecret(store), false, "已是密文时不应重复写入");

    // 没有配置时也不应报错
    const empty = createStore(join(t.dir, "empty.sqlite"));
    assert.equal(migrateSmtpSecret(empty), false);
    empty.db.close();
  } finally {
    store.db.close();
    t.dispose();
    resetKeyCache();
  }
});

test("SMTP：环境变量优先于数据库，且此时界面标记为只读", () => {
  const t = tempDir();
  const store = createStore(join(t.dir, "test.sqlite"));
  const saved = { ...process.env };
  try {
    // 只给 HOST 或只给 USER 都不算启用
    process.env.SMTP_HOST = "smtp.qq.com";
    delete process.env.SMTP_USER;
    assert.equal(smtpFromEnv(), null, "缺少 SMTP_USER 时不应启用");

    saveSmtp(store, {
      host: "smtp.db.example.com",
      port: 587,
      secure: false,
      user: "db-user@example.com",
      pass: CODE,
    });
    assert.equal(resolveSmtp(store)?.host, "smtp.db.example.com", "无环境变量时用数据库配置");

    // 环境变量齐备后应完全接管
    process.env.SMTP_HOST = "smtp.env.example.com";
    process.env.SMTP_USER = "env-user@example.com";
    process.env.SMTP_PASS = "env-code-12345678";

    const resolved = resolveSmtp(store)!;
    assert.equal(resolved.host, "smtp.env.example.com");
    assert.equal(resolved.user, "env-user@example.com");
    assert.equal(resolved.pass, "env-code-12345678");

    const view = smtpView(store);
    assert.equal(view.managedByEnv, true, "环境变量接管时界面应改为只读");
    assert.equal(view.configured, true);
    assert.equal(view.host, "smtp.env.example.com");
    assert.ok(!("pass" in view), "即便走环境变量也不能把授权码返回前端");
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    store.db.close();
    t.dispose();
    resetKeyCache();
  }
});
