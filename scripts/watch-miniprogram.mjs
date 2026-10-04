import { watch } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
let running = false;
let queued = false;
let timer;
let child;
let stopping = false;

function rebuild() {
  if (stopping) return;
  if (running) {
    queued = true;
    return;
  }
  running = true;
  child = spawn(process.execPath, ["scripts/build-miniprogram.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
  child.on("error", (error) => console.error("无法启动构建：", error.message));
  child.on("close", (code) => {
    running = false;
    if (stopping) return;
    console.log(
      code === 0
        ? "源码已同步到预览目录，继续监听 wechat/…"
        : "构建失败，请修复后保存；监听继续。",
    );
    if (queued) {
      queued = false;
      rebuild();
    }
  });
}

const watcher = watch(
  new URL("../wechat/", import.meta.url),
  { recursive: true },
  (_event, name) => {
    if (!name || !/\.(ts|wxml|wxss|json|svg)$/.test(name)) return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, 300);
  },
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    clearTimeout(timer);
    watcher.close();
    child?.kill();
  });
}
console.log("监听 wechat/ 源码。修改或还原源码后自动重新构建；Ctrl+C 停止。");
rebuild();
