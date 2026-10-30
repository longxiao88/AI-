import nodemailer from "nodemailer";

/** SMTP 发件配置（全局，服务级，非某个账号独有）。 */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  /** 邮件里展示的发件人名称，可选 */
  fromName?: string;
}

/** 邮件正文内容。 */
export interface MailBody {
  to: string;
  subject: string;
  text: string;
}

/**
 * 通过 SMTP 发送一封纯文本邮件。
 * 配置来自数据库里的全局 app_config，未配置时抛出明确错误。
 */
export async function sendMail(
  config: SmtpConfig,
  body: MailBody,
): Promise<void> {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure, // 465 用 true，587 用 false
    auth: { user: config.user, pass: config.pass },
  });

  await transport.sendMail({
    from: config.fromName
      ? `"${config.fromName}" <${config.user}>`
      : config.user,
    to: body.to,
    subject: body.subject,
    text: body.text,
  });

  transport.close();
}

/** 判断一份 SMTP 配置是否完整可用。 */
export function isSmtpConfigured(config: SmtpConfig | null | undefined): config is SmtpConfig {
  return !!config && !!config.host && !!config.user && !!config.pass;
}
