import type { Request } from "express";
import type { Multer } from "multer";
import type { z } from "zod";
import type { ChatMessage } from "../shared/chat.js";
import type { Mode, Settings } from "../shared/types.js";
import type { Store } from "./db.js";
import type { fileStore } from "./files.js";
import type { SmtpConfig } from "./mail.js";

export interface AppOptions {
  fetcher?: typeof fetch;
  timeout?: number;
  staticDir?: string;
  /** 资源库文件存储目录（默认 data/files/） */
  filesDir?: string;
  /** 测试用：注入邮件发送函数，绕过真实 SMTP */
  mailer?: (config: SmtpConfig, body: { to: string; subject: string; text: string }) => Promise<void>;
}

/**
 * 路由之间共享的运行时依赖。
 * API Key 与「正在处理 AI 请求」两个状态只存在于进程内存，因此通过 getter/setter 暴露，
 * 而不是把字符串直接摊在上下文对象上——否则各路由拿到的是创建时的快照，改了不生效。
 */
export interface AppContext {
  store: Store;
  options: AppOptions;
  files: ReturnType<typeof fileStore>;
  upload: Multer;
  /** 当前登录账号 ID（由 installAuth 的中间件挂到请求上） */
  accountOf(req: Request): string;
  settings(accountId: string): Settings;
  isBusy(): boolean;
  getKey(): string;
  setKey(value: string): void;
  callModel(
    accountId: string,
    input: string,
    mode: Mode,
    systemPrompt?: string,
    conversation?: ChatMessage[],
  ): Promise<string>;
  callModelForJson<T>(
    accountId: string,
    payload: object,
    prompt: string,
    schema: z.ZodType<T>,
  ): Promise<T>;
}
