import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type express from "express";
import { z } from "zod";
import { ACCOUNT, MAIL, OTP } from "../shared/constants.js";
import type { Profile } from "../shared/types.js";
import { ApiError } from "./ai.js";
import { SendCooldown } from "./cooldown.js";
import type { Store } from "./db.js";
import { migrate } from "./db.js";
import type { FileStore } from "./files.js";
import { isSmtpConfigured, sendMail, type SmtpConfig } from "./mail.js";
import { resolveSmtp } from "./smtp.js";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const COOKIE_NAME = "office_session";
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const LOCK_TIME = 15 * 60 * 1000;
// 账号数量、验证码有效期、发信冷却等规则统一来自 shared/constants.ts

const usernameSchema = z
  .string()
  .trim()
  .min(ACCOUNT.usernameMin)
  .max(ACCOUNT.usernameMax)
  .regex(/^[a-zA-Z0-9_.-]+$/);

const credentialsSchema = z
  .object({
    username: usernameSchema,
    password: z.string().min(ACCOUNT.passwordMin).max(ACCOUNT.passwordMax),
    name: z.string().trim().min(1).max(ACCOUNT.nameMax).optional(),
  })
  .strict();

const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(ACCOUNT.nameMax),
    email: z.string().email().max(ACCOUNT.emailMax).or(z.literal("")),
    role: z.string().max(ACCOUNT.roleMax),
    bio: z.string().max(ACCOUNT.bioMax),
  })
  .strict();

// 请求发送验证码：用账号名或邮箱定位账号
const resetRequestSchema = z
  .object({
    account: z.string().trim().min(1).max(120),
  })
  .strict();

// 验证验证码并重置密码
const resetConfirmSchema = z
  .object({
    account: z.string().trim().min(1).max(120),
    code: z.string().trim().regex(/^\d{6}$/),
    newPassword: z.string().min(8).max(128),
  })
  .strict();

interface AccountRow {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  profile: string;
  email?: string;
  emailVerified?: number;
}

interface SessionRow {
  tokenHash: string;
  accountId: string;
  expiresAt: number;
}

// 数据库里只存会话令牌的哈希，库文件泄露也拿不到可用的 Cookie
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * 多账号：一个工作空间里可以创建多个账号，每个账号的数据彼此隔离。
 * 会话令牌绑定到具体账号，切换账号即重新登录（签发一个新会话）。
 * 必须在其他 /api 路由之前调用，登录校验中间件在这里挂载，
 * 并把当前账号 ID 挂到请求上，供后续路由做数据隔离。
 */
export function installAuth(
  app: express.Express,
  store: Store,
  mailer: (config: SmtpConfig, body: { to: string; subject: string; text: string }) => Promise<void> = sendMail,
  files?: FileStore,
) {
  const { db } = store;
  db.exec(`
    CREATE TABLE IF NOT EXISTS account (
      id           TEXT PRIMARY KEY,
      username     TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      salt         TEXT NOT NULL,
      profile      TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      tokenHash TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      expiresAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      tokenHash   TEXT PRIMARY KEY,
      accountId   TEXT NOT NULL,
      email       TEXT NOT NULL,
      codeHash    TEXT NOT NULL,
      attempts    INTEGER NOT NULL DEFAULT 0,
      expiresAt   INTEGER NOT NULL
    );
  `);

  // 兼容旧版单账号数据：把老 account 表（id=1）迁移成多账号结构并归入第一个账号
  migrateLegacyAccount(db);
  // 旧版 sessions 表没有 accountId 列，直接重建（会话是临时的，可安全丢弃）
  migrateLegacySessions(db);
  // account 表增加邮箱字段（旧库升级时补齐）
  migrateAccountEmail(db);

  // 业务数据表第一次升级为多账号时，把存量数据归给已有账号（旧单账号时代唯一的账号）。
  const firstAccountId = () => {
    const row = db.prepare("SELECT id FROM account ORDER BY rowid LIMIT 1").get() as
      | { id: string }
      | undefined;
    return row?.id;
  };

  const needsDataMigration = () => !hasAccountIdColumn(db, "entries");

  // 若旧库有业务数据但还没迁移，立即用第一个已有账号完成迁移（此时旧账号已通过
  // migrateLegacyAccount 保留下来）。全新安装的新库表自带 accountId，无需迁移。
  if (needsDataMigration() && firstAccountId()) migrate(db, firstAccountId()!);

  const accountById = (id: string) =>
    db.prepare("SELECT * FROM account WHERE id = ?").get(id) as AccountRow | undefined;
  const accountByUsername = (username: string) =>
    db.prepare("SELECT * FROM account WHERE username = ?").get(username) as
      | AccountRow
      | undefined;

  const toProfile = (row: AccountRow): Profile => ({
    username: row.username,
    ...JSON.parse(row.profile),
    email: row.email || "",
    emailVerified: !!row.emailVerified,
  });
  const profileById = (id: string): Profile | null => {
    const row = accountById(id);
    return row ? toProfile(row) : null;
  };

  const listAccounts = (): Profile[] =>
    (db.prepare("SELECT * FROM account ORDER BY rowid").all() as unknown as AccountRow[]).map(
      toProfile,
    );

  const readToken = (req: express.Request) =>
    req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1) || "";

  const activeAccountId = (req: express.Request): string | null => {
    const token = readToken(req);
    if (!token) return null;
    const row = db
      .prepare("SELECT accountId FROM sessions WHERE tokenHash = ? AND expiresAt > ?")
      .get(sha256(token), Date.now()) as Pick<SessionRow, "accountId"> | undefined;
    return row?.accountId ?? null;
  };

  const startSession = (res: express.Response, accountId: string) => {
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM sessions WHERE expiresAt < ?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(
      sha256(token),
      accountId,
      Date.now() + SESSION_TTL,
    );
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_TTL,
    });
  };

  // 按 IP 记录失败次数，连续失败过多时暂时锁定
  const failures = new Map<string, { count: number; until: number }>();

  const isRateLimited = (ip: string) => {
    const record = failures.get(ip);
    return !!record && record.until > Date.now() && record.count >= MAX_LOGIN_ATTEMPTS;
  };
  const recordFailure = (ip: string) => {
    const current =
      failures.get(ip)?.until && failures.get(ip)!.until > Date.now()
        ? failures.get(ip)!
        : { count: 0, until: Date.now() + LOCK_TIME };
    current.count++;
    failures.set(ip, current);
  };

  const hashPassword = (password: string, salt: string) => scrypt(password, salt, 64);

  app.get("/api/auth/session", (req, res) => {
    const accountId = activeAccountId(req);
    res.json({
      accounts: listAccounts(),
      user: accountId ? profileById(accountId) : null,
    });
  });

  // 创建账号（注册）。已有账号时也允许创建新的。
  app.post("/api/auth/setup", async (req, res) => {
    const ip = req.ip || "local";
    if (isRateLimited(ip))
      throw new ApiError(429, "尝试次数过多，请 15 分钟后重试。");

    const body = credentialsSchema.parse(req.body);
    if (listAccounts().length >= ACCOUNT.maxAccounts)
      throw new ApiError(409, `最多只能创建 ${ACCOUNT.maxAccounts} 个账号，请先删除一个再注册。`);
    if (accountByUsername(body.username)) throw new ApiError(409, "该账号名已被使用，请换一个。");

    const salt = randomBytes(16).toString("hex");
    const hash = await hashPassword(body.password, salt);

    // scrypt 是异步的，期间可能有另一个请求抢先注册了同名账号
    if (accountByUsername(body.username)) throw new ApiError(409, "该账号名已被使用，请换一个。");

    db.prepare("INSERT INTO account VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      body.username,
      body.username,
      hash.toString("hex"),
      salt,
      JSON.stringify({ name: body.name || body.username, role: "", bio: "" }),
      "",
      0,
    );
    startSession(res, body.username);
    res.status(201).json({ accounts: listAccounts(), user: profileById(body.username) });
  });

  app.post("/api/auth/login", async (req, res) => {
    const ip = req.ip || "local";
    if (isRateLimited(ip))
      throw new ApiError(429, "尝试次数过多，请 15 分钟后重试。");

    const body = credentialsSchema.parse(req.body);
    const row = accountByUsername(body.username);
    // 账号不存在时也算一次哈希，避免通过响应时间判断账号是否存在
    const hash = await hashPassword(body.password, row?.salt || "no-account");
    const valid =
      row &&
      row.username === body.username &&
      timingSafeEqual(hash, Buffer.from(row.passwordHash, "hex"));

    if (!valid) {
      recordFailure(ip);
      throw new ApiError(401, "账号或密码不正确。");
    }

    failures.delete(ip);
    startSession(res, row!.id);
    res.json({ accounts: listAccounts(), user: profileById(row!.id) });
  });

  app.post("/api/auth/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE tokenHash = ?").run(sha256(readToken(req)));
    res.clearCookie(COOKIE_NAME, { path: "/", httpOnly: true, sameSite: "strict" });
    res.json({ ok: true });
  });

  // 删除账号：删除该账号及其全部数据（不可恢复）。
  // 放在登录校验中间件之前——登录页未登录时也能删除账号。删除只在前端做一次确认。
  app.delete("/api/account/:username", (req, res) => {
    const username = String(req.params.username);
    const row = accountByUsername(username);
    if (!row) throw new ApiError(404, "账号不存在。");

    db.exec("BEGIN IMMEDIATE");
    try {
      // 先清理该账号上传的资源文件（资源库模块），避免孤儿文件
      if (files) {
        const resources = db
          .prepare("SELECT data FROM entries WHERE accountId = ? AND kind = 'resources'")
          .all(row.id) as { data: string }[];
        for (const r of resources) {
          try {
            const storedName = (JSON.parse(r.data) as { storedName?: string }).storedName;
            if (storedName) files.remove(storedName);
          } catch {
            // 忽略解析失败的旧数据
          }
        }
      }
      db.prepare("DELETE FROM sessions WHERE accountId = ?").run(row.id);
      db.prepare("DELETE FROM password_resets WHERE accountId = ?").run(row.id);
      db.prepare("DELETE FROM tasks WHERE accountId = ?").run(row.id);
      db.prepare("DELETE FROM entries WHERE accountId = ?").run(row.id);
      db.prepare("DELETE FROM settings WHERE accountId = ?").run(row.id);
      db.prepare("DELETE FROM request_batches WHERE accountId = ?").run(row.id);
      db.prepare("DELETE FROM audit_logs WHERE accountId = ?").run(row.id);
      db.prepare("DELETE FROM account WHERE id = ?").run(row.id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }

    res.json({ ok: true, accounts: listAccounts() });
  });

  // ---- 账号找回（邮箱验证码）----

  // 发信冷却与配额：每发一封验证码都要消耗发件邮箱的真实配额，
  // 所以要挡住「连点发送」。key 里带上 IP 与目标标识。
  const sendGuard = new SendCooldown({
    cooldownMs: MAIL.cooldownMs,
    windowMs: MAIL.windowMs,
    maxPerWindow: MAIL.maxPerWindow,
  });

  const takeSendSlot = (ip: string, scope: string, target: string) => {
    const result = sendGuard.take(`${ip}|${scope}|${target.trim().toLowerCase()}`);
    if (!result.ok)
      throw new ApiError(429, `发送过于频繁，请 ${result.retryAfter} 秒后再试。`);
  };

  // 读取用于发信的 SMTP 配置：环境变量优先，其次数据库（授权码已解密）
  const getSmtpConfig = (): SmtpConfig | null => resolveSmtp(store);

  // 发送邮件，把底层发信异常转成带具体原因的 ApiError，避免落到全局 500 兜底
  const sendCodeMail = async (
    config: SmtpConfig,
    body: { to: string; subject: string; text: string },
  ) => {
    try {
      await mailer(config, body);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new ApiError(
        502,
        `邮件发送失败，请检查发件邮箱的 SMTP 配置（服务器、端口、授权码）。原因：${detail}`,
      );
    }
  };

  // 按「账号名或已绑定邮箱」定位账号
  const accountByIdentifier = (account: string) => {
    const byName = accountByUsername(account);
    if (byName) return byName;
    return db
      .prepare("SELECT * FROM account WHERE email = ? LIMIT 1")
      .get(account) as AccountRow | undefined;
  };

  // 生成并保存一个验证码，返回明文验证码（用于写入邮件）
  const issueResetCode = (accountId: string, email: string): string => {
    const code = String(randomBytes(3).readUIntBE(0, 3) % 1_000_000).padStart(6, "0");
    const token = randomBytes(16).toString("hex");
    db.prepare(
      "INSERT INTO password_resets (tokenHash, accountId, email, codeHash, attempts, expiresAt) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      sha256(token),
      accountId,
      email,
      sha256(code),
      0,
      Date.now() + OTP.ttlMs,
    );
    // 返回一个组合字符串：验证码 + token，前端用 token 换取重置（简化：直接返回 code）
    return code;
  };

  // 步骤一：请求发送验证码。无论账号是否存在，都返回同样的提示，避免枚举账号。
  app.post("/api/auth/reset/request", async (req, res) => {
    const ip = req.ip || "local";
    if (isRateLimited(ip))
      throw new ApiError(429, "尝试次数过多，请 15 分钟后重试。");

    const { account } = resetRequestSchema.parse(req.body);
    const config = getSmtpConfig();
    if (!isSmtpConfigured(config))
      throw new ApiError(503, "发件邮箱尚未配置，请联系管理员在设置中配置 SMTP。");

    const row = accountByIdentifier(account);
    // 冷却检查必须在查账号之前：不存在的账号同样占用名额，
    // 这样「会不会返回 429」就不构成账号是否存在的探测信号。
    takeSendSlot(ip, "reset", account);
    // 账号不存在或没绑定邮箱时，静默返回成功（不泄露账号是否存在）
    if (!row || !row.email)
      return res.json({ ok: true, hint: "若该账号已绑定邮箱，验证码将发送至该邮箱。" });

    const code = issueResetCode(row.id, row.email);
    await sendCodeMail(config, {
      to: row.email,
      subject: "AI 办公助手 · 密码重置验证码",
      text: `你的密码重置验证码是：${code}\n\n验证码 5 分钟内有效，请勿泄露给他人。\n如果不是你本人操作，请忽略本邮件。`,
    });
    res.json({ ok: true, hint: "验证码已发送，请查收邮箱。" });
  });

  // 步骤二：验证验证码并重置密码
  app.post("/api/auth/reset/confirm", async (req, res) => {
    const ip = req.ip || "local";
    if (isRateLimited(ip))
      throw new ApiError(429, "尝试次数过多，请 15 分钟后重试。");

    const { account, code, newPassword } = resetConfirmSchema.parse(req.body);
    const row = accountByIdentifier(account);
    if (!row || !row.email) throw new ApiError(404, "未找到可重置的账号或未绑定邮箱。");

    // 取该账号最新一条未过期的验证记录
    const reset = db
      .prepare(
        "SELECT * FROM password_resets WHERE accountId = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(row.id) as
      | { codeHash: string; attempts: number; expiresAt: number }
      | undefined;

    if (!reset || reset.expiresAt < Date.now())
      throw new ApiError(410, "验证码已过期，请重新获取。");
    if (reset.attempts >= OTP.maxAttempts)
      throw new ApiError(429, "验证码尝试次数过多，请重新获取。");
    if (!timingSafeEqual(Buffer.from(sha256(code)), Buffer.from(reset.codeHash))) {
      db.prepare("UPDATE password_resets SET attempts = attempts + 1 WHERE accountId = ?").run(
        row.id,
      );
      throw new ApiError(401, "验证码不正确。");
    }

    // 验证通过：更新密码、清空验证记录、注销该账号所有会话
    const salt = randomBytes(16).toString("hex");
    const hash = await hashPassword(newPassword, salt);
    db.prepare("UPDATE account SET passwordHash = ?, salt = ? WHERE id = ?").run(
      hash.toString("hex"),
      salt,
      row.id,
    );
    db.prepare("DELETE FROM password_resets WHERE accountId = ?").run(row.id);
    db.prepare("DELETE FROM sessions WHERE accountId = ?").run(row.id);
    failures.delete(ip);

    res.json({ ok: true, message: "密码已重置，请使用新密码登录。" });
  });

  // ---- 邮箱绑定（登录后） ----
  // 绑定邮箱需先验证：先发验证码到目标邮箱，验证通过后才写入 account.email。
  // 这里复用 password_resets 表做邮箱绑定验证码存储。

  // 以下所有 /api 接口都需要登录，并把账号 ID 挂到请求上
  app.use("/api", (req, _res, next) => {
    const accountId = activeAccountId(req);
    if (!accountId) throw new ApiError(401, "请先登录工作空间。");
    (req as express.Request & { accountId: string }).accountId = accountId;
    next();
  });

  app.get("/api/profile", (req, res) =>
    res.json(profileById((req as express.Request & { accountId: string }).accountId)),
  );

  app.put("/api/profile", (req, res) => {
    const accountId = (req as express.Request & { accountId: string }).accountId;
    const body = profileSchema.parse(req.body);
    db.prepare("UPDATE account SET profile = ? WHERE id = ?").run(JSON.stringify(body), accountId);
    res.json(profileById(accountId));
  });

  // 请求发送邮箱验证码（绑定邮箱用）
  app.post("/api/profile/email/request", async (req, res) => {
    const accountId = (req as express.Request & { accountId: string }).accountId;
    const ip = req.ip || "local";
    const { email } = z.object({ email: z.string().email().max(120) }).strict().parse(req.body);

    const config = getSmtpConfig();
    if (!isSmtpConfigured(config))
      throw new ApiError(503, "发件邮箱尚未配置，请联系管理员在设置中配置 SMTP。");

    // 该邮箱若已被其他账号占用，拒绝
    const occupied = db
      .prepare("SELECT id FROM account WHERE email = ? AND id != ?")
      .get(email, accountId);
    if (occupied) throw new ApiError(409, "该邮箱已被其他账号绑定。");

    // 冷却：同一账号对同一目标邮箱 60 秒内只发一封
    takeSendSlot(ip, "bind", `${accountId}|${email}`);

    const code = issueResetCode(accountId, email);
    await sendCodeMail(config, {
      to: email,
      subject: "AI 办公助手 · 邮箱验证码",
      text: `你的邮箱验证码是：${code}\n\n验证码 5 分钟内有效。`,
    });
    res.json({ ok: true });
  });

  // 验证邮箱验证码，绑定邮箱
  app.post("/api/profile/email/confirm", (req, res) => {
    const accountId = (req as express.Request & { accountId: string }).accountId;
    const { email, code } = z
      .object({ email: z.string().email().max(120), code: z.string().regex(/^\d{6}$/) })
      .strict()
      .parse(req.body);

    const reset = db
      .prepare("SELECT * FROM password_resets WHERE accountId = ? ORDER BY rowid DESC LIMIT 1")
      .get(accountId) as
      | { codeHash: string; email: string; expiresAt: number }
      | undefined;

    if (!reset || reset.expiresAt < Date.now())
      throw new ApiError(410, "验证码已过期，请重新获取。");
    if (reset.email !== email) throw new ApiError(409, "验证码与邮箱不匹配。");
    if (!timingSafeEqual(Buffer.from(sha256(code)), Buffer.from(reset.codeHash)))
      throw new ApiError(401, "验证码不正确。");

    db.prepare("UPDATE account SET email = ?, emailVerified = 1 WHERE id = ?").run(
      email,
      accountId,
    );
    db.prepare("DELETE FROM password_resets WHERE accountId = ?").run(accountId);
    res.json(profileById(accountId));
  });
}

/**
 * 把旧版单账号的 account 表（固定 id=1）迁移为多账号结构。
 * 旧表的主键是 INTEGER 且 CHECK(id=1)，新表是 TEXT 主键，
 * 需要重建表并把用户名作为主键。
 */
function migrateLegacyAccount(db: Store["db"]) {
  const cols = db.prepare("PRAGMA table_info(account)").all() as { name: string; type: string }[];
  const idCol = cols.find((c) => c.name === "id");
  // 已经是 TEXT 主键的新结构，无需迁移
  if (idCol && /TEXT|VARCHAR|CHAR/i.test(idCol.type)) return;

  const legacy = db.prepare("SELECT * FROM account WHERE id = 1").get() as
    | AccountRow
    | undefined;
  if (!legacy) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DROP TABLE account");
    db.exec(`
      CREATE TABLE account (
        id           TEXT PRIMARY KEY,
        username     TEXT NOT NULL UNIQUE,
        passwordHash TEXT NOT NULL,
        salt         TEXT NOT NULL,
        profile      TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO account VALUES (?, ?, ?, ?, ?)").run(
      legacy.username,
      legacy.username,
      legacy.passwordHash,
      legacy.salt,
      legacy.profile,
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** 旧版 sessions 表缺少 accountId 列，直接重建（会话是临时的，可安全丢弃）。 */
function migrateLegacySessions(db: Store["db"]) {
  if (hasAccountIdColumn(db, "sessions")) return;
  db.exec(`
    DROP TABLE IF EXISTS sessions;
    CREATE TABLE sessions (
      tokenHash TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      expiresAt INTEGER NOT NULL
    );
  `);
}

/** 旧版 account 表没有 email 字段，升级时补齐（默认为空、未验证）。 */
function migrateAccountEmail(db: Store["db"]) {
  const cols = db.prepare("PRAGMA table_info(account)").all() as { name: string }[];
  if (cols.some((c) => c.name === "email")) return;
  db.exec(`
    ALTER TABLE account ADD COLUMN email TEXT NOT NULL DEFAULT '';
    ALTER TABLE account ADD COLUMN emailVerified INTEGER NOT NULL DEFAULT 0;
  `);
}

function hasAccountIdColumn(db: Store["db"], table: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === "accountId");
}
