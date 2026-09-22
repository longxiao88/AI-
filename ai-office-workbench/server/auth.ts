import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type express from "express";
import { z } from "zod";
import type { Profile } from "../shared/types.js";
import { ApiError } from "./ai.js";
import type { Store } from "./db.js";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const COOKIE_NAME = "office_session";
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const LOCK_TIME = 15 * 60 * 1000;

const credentialsSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[a-zA-Z0-9_.-]+$/),
    password: z.string().min(8).max(128),
    name: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    email: z.string().email().max(120).or(z.literal("")),
    role: z.string().max(80),
    bio: z.string().max(500),
  })
  .strict();

interface AccountRow {
  username: string;
  passwordHash: string;
  salt: string;
  profile: string;
}

// 数据库里只存会话令牌的哈希，库文件泄露也拿不到可用的 Cookie
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * 单用户账号：第一次打开时创建账号，之后用账号密码登录。
 * 必须在其他 /api 路由之前调用，登录校验中间件在这里挂载。
 */
export function installAuth(app: express.Express, store: Store) {
  const { db } = store;
  db.exec(`
    CREATE TABLE IF NOT EXISTS account (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      username     TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      salt         TEXT NOT NULL,
      profile      TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      tokenHash TEXT PRIMARY KEY,
      expiresAt INTEGER NOT NULL
    );
  `);

  const account = () =>
    db.prepare("SELECT * FROM account WHERE id = 1").get() as AccountRow | undefined;

  const profile = (): Profile | null => {
    const row = account();
    return row ? { username: row.username, ...JSON.parse(row.profile) } : null;
  };

  const readToken = (req: express.Request) =>
    req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1) || "";

  const isLoggedIn = (req: express.Request) => {
    const token = readToken(req);
    if (!token) return false;
    return !!db
      .prepare("SELECT 1 FROM sessions WHERE tokenHash = ? AND expiresAt > ?")
      .get(sha256(token), Date.now());
  };

  const startSession = (res: express.Response) => {
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM sessions WHERE expiresAt < ?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES (?, ?)").run(sha256(token), Date.now() + SESSION_TTL);
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_TTL,
    });
  };

  // 按 IP 记录失败次数，连续失败过多时暂时锁定
  const failures = new Map<string, { count: number; until: number }>();

  app.get("/api/auth/session", (req, res) => {
    res.json({
      setupRequired: !account(),
      user: isLoggedIn(req) ? profile() : null,
    });
  });

  app.post("/api/auth/setup", async (req, res) => {
    if (account()) throw new ApiError(409, "此工作空间已有账号，请直接登录。");
    const body = credentialsSchema.parse(req.body);
    const salt = randomBytes(16).toString("hex");
    const hash = await scrypt(body.password, salt, 64);
    // scrypt 是异步的，期间可能有另一个请求抢先建了账号
    if (account()) throw new ApiError(409, "账号已创建，请登录。");

    db.prepare("INSERT INTO account VALUES (1, ?, ?, ?, ?)").run(
      body.username,
      hash.toString("hex"),
      salt,
      JSON.stringify({ name: body.name || body.username, email: "", role: "", bio: "" }),
    );
    startSession(res);
    res.status(201).json({ setupRequired: false, user: profile() });
  });

  app.post("/api/auth/login", async (req, res) => {
    const ip = req.ip || "local";
    const record = failures.get(ip);
    if (record && record.until > Date.now() && record.count >= MAX_LOGIN_ATTEMPTS)
      throw new ApiError(429, "尝试次数过多，请 15 分钟后重试。");

    const body = credentialsSchema.parse(req.body);
    const row = account();
    // 账号不存在时也算一次哈希，避免通过响应时间判断账号是否存在
    const hash = await scrypt(body.password, row?.salt || "no-account", 64);
    const valid =
      row &&
      row.username === body.username &&
      timingSafeEqual(hash, Buffer.from(row.passwordHash, "hex"));

    if (!valid) {
      const current =
        record && record.until > Date.now() ? record : { count: 0, until: Date.now() + LOCK_TIME };
      current.count++;
      failures.set(ip, current);
      throw new ApiError(401, "账号或密码不正确。");
    }

    failures.delete(ip);
    startSession(res);
    res.json({ setupRequired: false, user: profile() });
  });

  app.post("/api/auth/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE tokenHash = ?").run(sha256(readToken(req)));
    res.clearCookie(COOKIE_NAME, { path: "/", httpOnly: true, sameSite: "strict" });
    res.json({ ok: true });
  });

  // 以下所有 /api 接口都需要登录
  app.use("/api", (req, _res, next) => {
    if (!isLoggedIn(req)) throw new ApiError(401, "请先登录工作空间。");
    next();
  });

  app.get("/api/profile", (_req, res) => res.json(profile()));

  app.put("/api/profile", (req, res) => {
    const body = profileSchema.parse(req.body);
    db.prepare("UPDATE account SET profile = ? WHERE id = 1").run(JSON.stringify(body));
    res.json(profile());
  });
}
