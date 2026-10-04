import { Picture, Region, Point } from "./types";
export const bounds = (p: Point[]) => ({
  x: Math.min(...p.map((v) => v.x)),
  y: Math.min(...p.map((v) => v.y)),
  width: Math.max(...p.map((v) => v.x)) - Math.min(...p.map((v) => v.x)),
  height: Math.max(...p.map((v) => v.y)) - Math.min(...p.map((v) => v.y)),
});
export function image(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
}
export async function crop(pic: Picture, r?: Region) {
  const img = await image(pic.url);
  const b = r
    ? bounds(r.points)
    : { x: 0, y: 0, width: pic.width, height: pic.height };
  const c = document.createElement("canvas");
  c.width = Math.ceil(b.width);
  c.height = Math.ceil(b.height);
  const x = c.getContext("2d")!;
  x.fillStyle = "white";
  x.fillRect(0, 0, c.width, c.height);
  if (r) {
    x.beginPath();
    r.points.forEach((p, i) =>
      i ? x.lineTo(p.x - b.x, p.y - b.y) : x.moveTo(p.x - b.x, p.y - b.y),
    );
    x.closePath();
    x.clip();
  }
  x.drawImage(img, -b.x, -b.y);
  return c.toDataURL("image/jpeg", 0.9);
}
export async function rotate(pic: Picture): Promise<Picture> {
  const img = await image(pic.url);
  const c = document.createElement("canvas");
  c.width = pic.height;
  c.height = pic.width;
  const x = c.getContext("2d")!;
  x.translate(c.width, 0);
  x.rotate(Math.PI / 2);
  x.drawImage(img, 0, 0);
  return {
    ...pic,
    width: c.width,
    height: c.height,
    url: c.toDataURL("image/jpeg", 0.95),
    regions: pic.regions.map((r) => ({
      ...r,
      points: r.points.map((p) => ({ x: pic.height - p.y, y: p.x })),
    })),
  };
}
export async function readPicture(file: File): Promise<Picture> {
  if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024)
    throw Error("请上传 12 MB 以下的图片");
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const img = await image(url);
  if (img.width * img.height > 40000000)
    throw Error("图片像素过大，请缩小后上传");
  return {
    id: await pictureId(file),
    name: file.name,
    url,
    width: img.width,
    height: img.height,
    regions: [],
  };
}
export async function pictureId(file: Blob): Promise<string> {
  if (!crypto.subtle) return crypto.randomUUID();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return `image-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
export function mergePictures(
  current: Picture[],
  incoming: Picture[],
): Picture[] {
  const result = [...current];
  for (const picture of incoming) {
    if (
      !result.some(
        (existing) =>
          existing.id === picture.id || existing.url === picture.url,
      )
    )
      result.push(picture);
  }
  return result;
}
