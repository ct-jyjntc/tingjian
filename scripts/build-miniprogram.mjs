import { loadEnvFile } from "node:process";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  copyFile,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import sharp from "sharp";

const root = fileURLToPath(new URL("..", import.meta.url));
try {
  loadEnvFile(path.join(root, ".env.local"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const source = path.join(root, "wechat"),
  output = path.join(root, "miniprogram");
const release = process.argv.includes("--release");
const base = (process.env.MINI_API_BASE_URL || "").replace(/\/+$/, "");
if (base) {
  const url = new URL(base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw Error(
      "MINI_API_BASE_URL 只能填写服务域名，例如 https://study.example.com",
    );
  if (
    release &&
    (url.protocol !== "https:" ||
      /^(localhost|127\.|\[::1\])/.test(url.hostname))
  )
    throw Error("发布包必须使用真实 HTTPS 服务域名");
}
const projectPath = path.join(root, "project.config.json");
const project = JSON.parse(await readFile(projectPath, "utf8"));
const appId = process.env.WECHAT_APP_ID || project.appid;
if (release && (!/^wx[a-f0-9]{16}$/.test(appId || "") || !base))
  throw Error("发布前需填写 WECHAT_APP_ID 和 MINI_API_BASE_URL");
if (
  release &&
  (!process.env.MINI_OPERATOR ||
    !process.env.MINI_CONTACT ||
    !process.env.MINI_AI_PROCESSORS)
)
  throw Error("发布前需填写运营者、联系方式和实际 AI 服务处理方");
async function walk(directory) {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map((entry) => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(file) : [file];
      }),
    )
  ).flat();
}
const files = await walk(source);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files.filter(
  (file) => /\.(json|wxml|wxss)$/.test(file) && !file.endsWith("tsconfig.json"),
)) {
  const destination = path.join(output, path.relative(source, file));
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(file, destination);
}
await build({
  entryPoints: files.filter(
    (file) => file.endsWith(".ts") && !file.endsWith(".d.ts"),
  ),
  outdir: output,
  outbase: source,
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2018",
  minify: true,
  legalComments: "none",
  define: { __MINI_API_BASE_URL__: JSON.stringify(base) },
  plugins: [
    {
      name: "native-local-modules",
      setup(builder) {
        builder.onResolve({ filter: /^\./ }, (args) => {
          const resolved = path.resolve(args.resolveDir, args.path);
          if (resolved.startsWith(source + path.sep))
            return { path: args.path, external: true };
        });
      },
    },
  ],
});
const icons = {
  home: '<path d="M7 22 24 7l17 15M11 20v22h10V30h6v12h10V20"/>',
  book: '<path d="M6 9c8-2 13 0 18 4 5-4 10-6 18-4v31c-8-2-13 0-18 4-5-4-10-6-18-4V9Zm18 4v31"/>',
  user: '<circle cx="24" cy="15" r="8"/><path d="M8 42c0-11 6-17 16-17s16 6 16 17"/>',
};
await mkdir(path.join(output, "assets"), { recursive: true });
for (const [name, shapes] of Object.entries(icons))
  for (const [suffix, color] of [
    ["", "#9699aa"],
    ["-active", "#5368b9"],
  ]) {
    await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="81" height="81" viewBox="0 0 48 48"><g fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${shapes}</g></svg>`,
      ),
    )
      .png()
      .toFile(path.join(output, "assets", `${name}${suffix}.png`));
  }
project.appid = appId;
project.setting.urlCheck = true;
await writeFile(projectPath, JSON.stringify(project, null, 2) + "\n");
const generated = await walk(output),
  size = (
    await Promise.all(generated.map(async (file) => (await stat(file)).size))
  ).reduce((a, b) => a + b, 0);
if (size > 2 * 1024 * 1024) throw Error(`主包超过 2 MiB：${size} 字节`);
console.log(
  `小程序已生成：${generated.length} 个文件，${(size / 1024).toFixed(1)} KiB。`,
);
console.log(
  base
    ? "已写入公开服务域名。"
    : "尚未配置服务域名；可预览界面，登录和 AI 功能需配置后重新构建。",
);
console.log("在微信开发者工具中导入项目根目录。真实密钥不会打入小程序包。");
