import { existsSync } from "node:fs";
import { resolve } from "node:path";

// 数据库用的是 Node.js 内置的 node:sqlite，版本太低时底层报错看不懂，这里先检查
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 24) {
  console.error(
    `需要 Node.js 24 或更高版本，当前是 ${process.version}。请安装 Node.js 24 LTS 后重新执行 npm ci。`,
  );
  process.exit(1);
}

const { createApp } = await import("./app.js");
const { createStore } = await import("./db.js");

const store = createStore(process.env.DB_PATH || resolve("data/workbench.sqlite"));
const port = Number(process.env.PORT || 4318);

// 只监听本机回环地址，不对局域网开放
const server = createApp(store).listen(port, "127.0.0.1", (error) => {
  if (error) {
    const inUse = (error as NodeJS.ErrnoException).code === "EADDRINUSE";
    console.error(
      inUse
        ? `端口 ${port} 已被占用，可能已经有一个 AI 办公助手在运行。请先关闭它，或用 PORT 环境变量换一个端口。`
        : `启动失败：${error.message}`,
    );
    store.db.close();
    process.exit(1);
  }
  console.log(`AI 办公助手已启动：http://127.0.0.1:${port}`);
  if (!existsSync(resolve("dist/index.html")))
    console.warn(
      "未找到前端页面 dist/：正式使用请先执行 npm run build；开发模式（npm run dev）请打开 http://127.0.0.1:5178",
    );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      store.db.close();
      process.exit(0);
    });
  });
}
