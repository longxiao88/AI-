/**
 * 前后端共用的规则常量。
 *
 * 这些数字同时出现在三处：前端预校验（即时提示）、后端 zod 校验（真正的把关）、
 * 演示模式的本地模拟接口。放在 shared 下统一引用，避免改了一处忘了另一处。
 */

/** 账号与个人资料 */
export const ACCOUNT = {
  usernameMin: 3,
  usernameMax: 40,
  passwordMin: 8,
  passwordMax: 128,
  nameMax: 60,
  emailMax: 120,
  roleMax: 80,
  bioMax: 500,
  /** 一个工作空间最多注册的账号数 */
  maxAccounts: 3,
} as const;

/** 会话与登录保护 */
export const SESSION = {
  /** Cookie 与会话有效期：7 天 */
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  /** 连续失败达到该次数后锁定 */
  maxLoginAttempts: 10,
  /** 锁定时长：15 分钟 */
  lockMs: 15 * 60 * 1000,
} as const;

/** 验证码（找回密码与绑定邮箱共用） */
export const OTP = {
  length: 6,
  /** 5 分钟有效 */
  ttlMs: 5 * 60 * 1000,
  /** 最多尝试 5 次 */
  maxAttempts: 5,
} as const;

/** 发信冷却与配额 */
export const MAIL = {
  /** 同一目标 60 秒内只发一封 */
  cooldownMs: 60 * 1000,
  /** 配额窗口：1 小时 */
  windowMs: 60 * 60 * 1000,
  /** 窗口内最多 10 封 */
  maxPerWindow: 10,
} as const;

/** 记录内容长度限制 */
export const CONTENT = {
  /** 标题最多 120 字 */
  titleMax: 120,
  /** 正文字段最多 50,000 字 */
  textMax: 50000,
  /** 知识库关键词最多 500 字 */
  keywordsMax: 500,
} as const;

/** 资源库上传 */
export const UPLOAD = {
  /** 单文件上限 50 MB */
  maxBytes: 50 * 1024 * 1024,
} as const;
