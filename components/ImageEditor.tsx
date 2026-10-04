"use client";
import { useEffect, useRef, useState } from "react";
import {
  Crop,
  RotateCw,
  Undo2,
  Redo2,
  Trash2,
  Plus,
  ScanLine,
  Move,
  MousePointer2,
} from "lucide-react";
import { Picture, Point, Region, Item } from "@/lib/types";
import { bounds, crop, mergePictures, readPicture, rotate } from "@/lib/images";
import { api } from "@/lib/client";
import type { Material, ContentMode } from "@/lib/materials";
export default function ImageEditor({
  pictures,
  setPictures,
  onRecognized,
  notify,
}: {
  pictures: Picture[];
  setPictures: (p: Picture[]) => void;
  onRecognized: (materials: Material[], items: Item[]) => Promise<void>;
  notify: (s: string) => void;
}) {
  const [selected, setSelected] = useState(0),
    [tool, setTool] = useState("rect"),
    [zoom, setZoom] = useState(1),
    [draft, setDraft] = useState<Point[]>([]),
    [busy, setBusy] = useState(false),
    [past, setPast] = useState<Picture[][]>([]),
    [future, setFuture] = useState<Picture[][]>([]),
    [contentMode, setContentMode] = useState<ContentMode>("auto"),
    [provider, setProvider] = useState<"default" | "tencent" | "xfyun">(
      "default",
    );
  const svg = useRef<SVGSVGElement>(null);
  const scrollBox = useRef<HTMLDivElement>(null);
  const pan = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const start = useRef<Point | null>(null);
  const dragRegion = useRef<string | null>(null);
  const p = pictures[selected];
  const currentPictures = useRef(pictures);
  currentPictures.current = pictures;
  function commit(next: Picture[]) {
    setPast((v) => [...v.slice(-19), currentPictures.current]);
    setFuture([]);
    currentPictures.current = next;
    setPictures(next);
  }
  async function upload(files: File[]) {
    try {
      const next = await Promise.all(files.map(readPicture));
      const merged = mergePictures(currentPictures.current, next);
      const added = merged.length - currentPictures.current.length;
      if (added) commit(merged);
      if (next[0])
        setSelected(
          merged.findIndex((p) => p.id === next[0].id || p.url === next[0].url),
        );
      if (added < next.length) notify("相同图片已在当前清单中，未重复添加");
    } catch (e) {
      notify(String(e));
    }
  }
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files || []);
      if (f.length) void upload(f);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  });
  useEffect(() => () => abort.current?.abort(), []);
  function point(e: React.PointerEvent): Point {
    const rect = svg.current!.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(p.width, ((e.clientX - rect.left) / rect.width) * p.width),
      ),
      y: Math.max(
        0,
        Math.min(p.height, ((e.clientY - rect.top) / rect.height) * p.height),
      ),
    };
  }
  function down(e: React.PointerEvent) {
    if (!p) return;
    const q = point(e);
    if (tool === "pan") {
      pan.current = {
        x: e.clientX,
        y: e.clientY,
        left: scrollBox.current!.scrollLeft,
        top: scrollBox.current!.scrollTop,
      };
      svg.current!.setPointerCapture(e.pointerId);
      return;
    }
    start.current = q;
    svg.current!.setPointerCapture(e.pointerId);
    if (tool === "move") {
      const t = e.target as SVGElement;
      dragRegion.current = t.dataset.id || null;
    } else setDraft([q]);
  }
  function moving(e: React.PointerEvent) {
    if (pan.current) {
      scrollBox.current!.scrollLeft =
        pan.current.left - (e.clientX - pan.current.x);
      scrollBox.current!.scrollTop =
        pan.current.top - (e.clientY - pan.current.y);
      return;
    }
    if (!start.current || tool === "move") return;
    const q = point(e);
    if (tool === "rect") {
      const a = start.current;
      setDraft([a, { x: q.x, y: a.y }, q, { x: a.x, y: q.y }]);
    } else setDraft((v) => [...v, q]);
  }
  function up(e: React.PointerEvent) {
    pan.current = null;
    if (!start.current) return;
    if (tool === "move" && dragRegion.current) {
      const q = point(e),
        dx = q.x - start.current.x,
        dy = q.y - start.current.y;
      const r = p.regions.find((v) => v.id === dragRegion.current)!;
      const b = bounds(r.points);
      const x = Math.max(-b.x, Math.min(dx, p.width - b.x - b.width)),
        y = Math.max(-b.y, Math.min(dy, p.height - b.y - b.height));
      commit(
        pictures.map((v) =>
          v.id === p.id
            ? {
                ...v,
                regions: v.regions.map((r) =>
                  r.id === dragRegion.current
                    ? {
                        ...r,
                        points: r.points.map((a) => ({
                          x: a.x + x,
                          y: a.y + y,
                        })),
                      }
                    : r,
                ),
              }
            : v,
        ),
      );
    } else if (draft.length >= 3) {
      const b = bounds(draft);
      if (b.width > 8 && b.height > 8) {
        const r: Region = { id: crypto.randomUUID(), points: draft };
        commit(
          pictures.map((v) =>
            v.id === p.id
              ? {
                  ...v,
                  regions: [...v.regions, r].sort(
                    (a, b) =>
                      bounds(a.points).y - bounds(b.points).y ||
                      bounds(a.points).x - bounds(b.points).x,
                  ),
                }
              : v,
          ),
        );
      }
    }
    start.current = null;
    dragRegion.current = null;
    setDraft([]);
  }
  async function recognize() {
    setBusy(true);
    const c = new AbortController();
    abort.current = c;
    try {
      const materials: Material[] = [];
      const imported: Item[] = [];
      for (const pic of pictures) {
        const regions = pic.regions.length ? pic.regions : [undefined];
        for (const [i, r] of regions.entries()) {
          c.signal.throwIfAborted();
          const data = await crop(pic, r);
          const source = `${pic.name} (${pic.id}) / ${r ? `选区 ${i + 1} (${r.id})` : "整张图片"}`;
          const result = await api(
            "ocr",
            {
              image: data,
              source,
              mode: contentMode,
              provider: provider === "default" ? undefined : provider,
            },
            c.signal,
          );
          materials.push({
            ...result.material,
            sourceImageId: pic.id,
            sourceRegion: r,
          });
          imported.push(...result.items);
        }
      }
      c.signal.throwIfAborted();
      if (currentPictures.current !== pictures)
        throw Error("图片或选区已变化，请重新识别；原清单未修改");
      await onRecognized(materials, imported);
      notify("识别完成，请对照原图检查文字；模糊或截断内容请调整后重试。");
    } catch (e) {
      notify(c.signal.aborted ? "已取消识别，原清单未修改" : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="image-layout">
      <section className="panel">
        <div className="section-title">
          <h2>圈出这次想听写的内容</h2>
          <span className="badge">{pictures.length} 张图片</span>
        </div>
        <p className="muted">
          框选或自由圈选，可添加多个选区。不圈选时识别整张图片。
        </p>
        <label>
          听写单位
          <select
            aria-label="图片听写单位"
            value={contentMode}
            onChange={(e) => setContentMode(e.target.value as ContentMode)}
          >
            <option value="auto">自动判断 · 词表逐词拆分</option>
            <option value="words">英文单词 · 每词一项</option>
            <option value="phrases">词语短语 · 每格一项</option>
            <option value="sentences">句子 · 每句一项</option>
          </select>
        </label>
        <label>
          识别服务
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as typeof provider)}
          >
            <option value="default">使用网页中配置的默认服务</option>
            <option value="tencent">腾讯高精度 · 保留文字位置</option>
            <option value="xfyun">兼容接口 · 图片识别模型</option>
          </select>
        </label>
        <p className="note">
          词表需要列位置，推荐腾讯版面识别。识别文本会保留以便核查。
        </p>
        <div className="toolbar">
          <button onClick={() => input.current?.click()}>
            <Plus size={17} />
            添加图片
          </button>
          <button onClick={() => cam.current?.click()}>拍照</button>
          <button
            disabled={!past.length}
            onClick={() => {
              setFuture((v) => [pictures, ...v]);
              setPictures(past.at(-1)!);
              setPast((v) => v.slice(0, -1));
            }}
            aria-label="撤销"
          >
            <Undo2 size={18} />
          </button>
          <button
            disabled={!future.length}
            onClick={() => {
              setPast((v) => [...v, pictures]);
              setPictures(future[0]);
              setFuture((v) => v.slice(1));
            }}
            aria-label="重做"
          >
            <Redo2 size={18} />
          </button>
        </div>
        <input
          hidden
          ref={input}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => void upload(Array.from(e.target.files || []))}
        />
        <input
          hidden
          ref={cam}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => void upload(Array.from(e.target.files || []))}
        />
        <div className="thumbnails">
          {pictures.map((pic, i) => (
            <div
              key={pic.id}
              className={i === selected ? "thumb active" : "thumb"}
            >
              <button
                onClick={() => {
                  setSelected(i);
                  setZoom(1);
                }}
              >
                <img src={pic.url} alt={pic.name} />
                <span>
                  {i + 1}. {pic.name}
                </span>
              </button>
              <div className="row">
                <button
                  disabled={i === 0}
                  onClick={() => {
                    const n = [...pictures];
                    [n[i - 1], n[i]] = [n[i], n[i - 1]];
                    commit(n);
                    setSelected(i - 1);
                  }}
                >
                  上移
                </button>
                <button
                  aria-label={`删除图片 ${i + 1}`}
                  onClick={() => {
                    commit(pictures.filter((v) => v.id !== pic.id));
                    setSelected(0);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel image-main">
        <div className="toolbar">
          <button
            className={tool === "rect" ? "selected" : ""}
            onClick={() => setTool("rect")}
          >
            <Crop size={18} />
            矩形
          </button>
          <button
            className={tool === "free" ? "selected" : ""}
            onClick={() => setTool("free")}
          >
            <MousePointer2 size={18} />
            自由圈选
          </button>
          <button
            className={tool === "move" ? "selected" : ""}
            onClick={() => setTool("move")}
          >
            <Move size={18} />
            移动选区
          </button>
          <button
            className={tool === "pan" ? "selected" : ""}
            onClick={() => setTool("pan")}
          >
            平移图片
          </button>
          <button
            disabled={!p}
            onClick={async () => {
              const rotated = await rotate(p);
              commit(pictures.map((v) => (v.id === p.id ? rotated : v)));
            }}
          >
            <RotateCw size={18} />
            旋转
          </button>
          <label>
            缩放{" "}
            <input
              aria-label="图片缩放"
              type="range"
              min=".5"
              max="3"
              step=".1"
              value={zoom}
              onChange={(e) => setZoom(+e.target.value)}
            />
          </label>
        </div>
        <div
          ref={scrollBox}
          className="canvas-scroll"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void upload(Array.from(e.dataTransfer.files));
          }}
        >
          {p ? (
            <svg
              ref={svg}
              viewBox={`0 0 ${p.width} ${p.height}`}
              style={{
                width: `${zoom * 100}%`,
                minWidth: `${zoom * 100}%`,
                touchAction: "none",
              }}
              onPointerDown={down}
              onPointerMove={moving}
              onPointerUp={up}
              onPointerCancel={() => {
                start.current = null;
                setDraft([]);
              }}
            >
              <image href={p.url} width={p.width} height={p.height} />
              {p.regions.map((r, i) => (
                <g key={r.id}>
                  <polygon
                    data-id={r.id}
                    points={r.points.map((a) => `${a.x},${a.y}`).join(" ")}
                    fill="#4d806d30"
                    stroke="#35745d"
                    strokeWidth={Math.max(2, p.width / 300)}
                  />
                  <text
                    x={bounds(r.points).x + 6}
                    y={bounds(r.points).y + Math.max(22, p.width / 35)}
                    fontSize={Math.max(20, p.width / 35)}
                    fill="#1c513b"
                  >
                    {i + 1}
                  </text>
                </g>
              ))}
              <polygon
                points={draft.map((a) => `${a.x},${a.y}`).join(" ")}
                fill="#4d806d30"
                stroke="#35745d"
                strokeWidth={p.width / 300}
              />
            </svg>
          ) : (
            <div className="empty">
              拖入图片，或粘贴剪贴板中的图片
              <br />
              <small>支持 JPG、PNG、WebP · 每张不超过 12 MB</small>
            </div>
          )}
        </div>
        {p?.regions.map((r, i) => (
          <div className="region-row" key={r.id}>
            <span>选区 {i + 1}</span>
            <label>
              宽{" "}
              <input
                type="number"
                value={Math.round(bounds(r.points).width)}
                onChange={(e) => {
                  const b = bounds(r.points),
                    width = Math.max(
                      10,
                      Math.min(+e.target.value, p.width - b.x),
                    );
                  commit(
                    pictures.map((v) =>
                      v.id === p.id
                        ? {
                            ...v,
                            regions: v.regions.map((a) =>
                              a.id === r.id
                                ? {
                                    ...a,
                                    points: a.points.map((q) => ({
                                      ...q,
                                      x: b.x + ((q.x - b.x) * width) / b.width,
                                    })),
                                  }
                                : a,
                            ),
                          }
                        : v,
                    ),
                  );
                }}
              />
            </label>
            <label>
              高{" "}
              <input
                aria-label={`选区 ${i + 1} 高度`}
                type="number"
                value={Math.round(bounds(r.points).height)}
                onChange={(e) => {
                  const b = bounds(r.points),
                    height = Math.max(
                      10,
                      Math.min(+e.target.value, p.height - b.y),
                    );
                  commit(
                    pictures.map((v) =>
                      v.id === p.id
                        ? {
                            ...v,
                            regions: v.regions.map((a) =>
                              a.id === r.id
                                ? {
                                    ...a,
                                    points: a.points.map((q) => ({
                                      ...q,
                                      y:
                                        b.y + ((q.y - b.y) * height) / b.height,
                                    })),
                                  }
                                : a,
                            ),
                          }
                        : v,
                    ),
                  );
                }}
              />
            </label>
            <button
              disabled={!i}
              onClick={() => {
                const regions = [...p.regions];
                [regions[i - 1], regions[i]] = [regions[i], regions[i - 1]];
                commit(
                  pictures.map((v) => (v.id === p.id ? { ...v, regions } : v)),
                );
              }}
            >
              上移
            </button>
            <button
              onClick={() =>
                commit(
                  pictures.map((v) =>
                    v.id === p.id
                      ? {
                          ...v,
                          regions: v.regions.filter((a) => a.id !== r.id),
                        }
                      : v,
                  ),
                )
              }
            >
              删除
            </button>
          </div>
        ))}
        <p className="note">
          请留意选区边缘：被截断的文字可能无法识别。自由圈选会遮蔽圈外内容。
        </p>
        <button
          className="primary"
          disabled={!pictures.length || busy}
          onClick={recognize}
        >
          <ScanLine size={18} />
          {busy ? "正在识别…" : "识别选中内容"}
        </button>
        {busy && (
          <button onClick={() => abort.current?.abort()}>取消识别</button>
        )}
      </section>
    </div>
  );
}
