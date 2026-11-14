import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api";
import { zhCN, type MessageKey } from "./zh-CN";
import { en } from "./en";

export type { MessageKey };

/** 翻译函数的签名，模块级的纯函数（如搜索页的模块名映射）需要它 */
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * 一个语言包：code 进 localStorage，name 是母语写法（切过去之后还能认出自己）。
 * messages 用宽松类型，因为以后导入的第三方语言包可能只翻了一部分 ——
 * 内置的 zh-CN / en 在各自的文件里仍然受 Messages 的完整 key 约束。
 */
export interface LocalePack {
  code: string;
  name: string;
  messages: Record<string, string>;
}

/** 内置语言包。以后从 data/locales/ 导入的包直接往这个列表里加即可。 */
const builtinPacks: LocalePack[] = [
  { code: "zh-CN", name: "中文", messages: zhCN },
  { code: "en", name: "English", messages: en },
];

const totalKeys = Object.keys(zhCN).length;

/** 生成语言包模板：所有 key + 中文原文，直接给想翻译的人当骨架 */
export function buildLocaleTemplate() {
  return JSON.stringify(
    {
      code: "xx",
      name: "Your language",
      messages: { ...zhCN },
    },
    null,
    2,
  );
}

/** 语言包对中文源文案的覆盖比例，用来判断这份包翻完没有 */
export function coverageOf(pack: LocalePack) {
  const filled = Object.keys(zhCN).filter((key) => (pack.messages[key] ?? "").trim() !== "").length;
  return Math.round((filled / totalKeys) * 100);
}

const STORAGE_KEY = "aipharis-locale";

function readLocale(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && builtinPacks.some((p) => p.code === saved)) return saved;
  } catch {
    // 浏览器禁用存储时按系统语言走
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "zh-CN";
  return nav.toLowerCase().startsWith("en") ? "en" : "zh-CN";
}

/** 只替换 {name} 这种简单占位，不引入 ICU —— 这个项目没有复数和性别变化的需求 */
function format(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in vars ? String(vars[key]) : whole,
  );
}

export interface SkippedPack {
  file: string;
  reason: string;
}

type I18nValue = {
  locale: string;
  localeName: string;
  packs: LocalePack[];
  setLocale: (code: string) => void;
  /** 缺失的 key 逐级回退：当前语言 → 中文源文 → key 本身 */
  t: Translate;
  /** 语言包目录的绝对路径，由后端给出（浏览器不知道本机路径） */
  localeDir: string;
  /** 重新扫描目录：用户把 json 丢进去之后点一下 */
  reloadLocales: () => Promise<void>;
  /** 目录里存在但没能解析的文件，附原因 */
  skipped: SkippedPack[];
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<string>(readLocale);
  const [external, setExternal] = useState<LocalePack[]>([]);
  const [localeDir, setLocaleDir] = useState("");
  const [skipped, setSkipped] = useState<SkippedPack[]>([]);

  /** 内置包打底，data/locales 里的同名包覆盖它——用户可以自己改进英文翻译 */
  const packs = useMemo(() => {
    const map = new Map<string, LocalePack>();
    for (const pack of builtinPacks) map.set(pack.code, pack);
    for (const pack of external) map.set(pack.code, pack);
    return [...map.values()];
  }, [external]);

  const reloadLocales = useCallback(async () => {
    try {
      const data = await api<{
        dir: string;
        packs: { code: string; name: string; messages: Record<string, string> }[];
        skipped?: SkippedPack[];
      }>("/locales");
      setLocaleDir(data.dir);
      setExternal(
        (data.packs ?? []).map((p) => ({ code: p.code, name: p.name, messages: p.messages })),
      );
      setSkipped(data.skipped ?? []);
    } catch {
      // 预览模式或后端未启动：保持内置语言包，不影响界面
    }
  }, []);

  useEffect(() => {
    void reloadLocales();
  }, [reloadLocales]);

  const active = useMemo(
    () => packs.find((p) => p.code === locale) ?? packs[0],
    [locale, packs],
  );

  useEffect(() => {
    // lang 会影响断字、字体回退和读屏发音，必须跟着语言走
    document.documentElement.lang = active.code;
    try {
      localStorage.setItem(STORAGE_KEY, active.code);
    } catch {
      // 存不下也不影响本次会话
    }
  }, [active.code]);

  const setLocale = useCallback((code: string) => {
    setLocaleState(code);
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => {
      const text = active.messages[key] ?? zhCN[key] ?? key;
      return format(text, vars);
    },
    [active],
  );

  const value = useMemo<I18nValue>(
    () => ({
      locale: active.code,
      localeName: active.name,
      packs,
      setLocale,
      t,
      localeDir,
      reloadLocales,
      skipped,
    }),
    [active, packs, setLocale, t, localeDir, reloadLocales, skipped],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n 必须在 I18nProvider 内使用");
  return value;
}
