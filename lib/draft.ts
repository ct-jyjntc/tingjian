import type { Item } from "./types";
import type { Material, RawMaterial } from "./materials";

export function replaceRecognition(
  items: Item[],
  raw: RawMaterial[],
  materials: Material[],
  imported: Item[],
) {
  const imageIds = new Set(
    materials.map((m) => m.sourceImageId).filter(Boolean),
  );
  const sources = new Set(materials.map((m) => m.source));
  const replaced = raw.filter(
    (m) =>
      sources.has(m.source) ||
      (m.sourceImageId && imageIds.has(m.sourceImageId)),
  );
  const materialIds = new Set(replaced.map((m) => m.id).filter(Boolean));
  for (const material of replaced) sources.add(material.source);
  const isReplaced = (item: Item) =>
    sources.has(item.source) ||
    (item.materialId && materialIds.has(item.materialId));
  const first = items.findIndex(isReplaced);
  const retained = items.filter((item) => !isReplaced(item));
  // Replace the source as a group, preserving its position and legitimate repeated words.
  const position =
    first < 0
      ? retained.length
      : items.slice(0, first).filter((item) => !isReplaced(item)).length;
  return {
    items: [
      ...retained.slice(0, position),
      ...imported,
      ...retained.slice(position),
    ],
    raw: [...raw.filter((m) => !replaced.includes(m)), ...materials],
  };
}
