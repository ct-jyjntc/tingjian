import { z } from "zod";
import {
  extractMaterial,
  isMaterial,
  itemIssue,
  buildMaterial,
  type Material,
  type RawMaterial,
  type ExtractionOptions,
  splitExistingItems,
} from "./materials";
import { newItem, type Item } from "./types";
export type AgentSource = {
  id: string;
  source: string;
  image: string;
  sourceImageId?: string;
};
export type AgentTrace = {
  tool: string;
  label: string;
  status: "success" | "error";
  detail: string;
};
export type AgentContext = {
  materials: Material[];
  items: Item[];
  sources: AgentSource[];
  allowGenerate: boolean;
  proposal?: Item[];
  updatedMaterials: Material[];
  inspected: boolean;
};
export const prepareArgs = z
  .object({
    materialIds: z.array(z.string()).max(30).optional(),
    mode: z.enum(["auto", "words", "phrases", "sentences"]),
    scope: z.enum(["materials", "current"]).optional(),
    columns: z.array(z.number().int().min(1).max(100)).max(20).optional(),
    blockIds: z.array(z.string()).max(500).optional(),
    language: z.enum(["all", "english", "chinese"]).optional(),
    deduplicate: z.boolean().optional(),
    limit: z.number().int().min(1).max(300).optional(),
  })
  .strict();
export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "inspect_material",
      description:
        "查看真实材料、行列概览。detail=full 可查看所有文字框。必须先查看再提取。",
      parameters: {
        type: "object",
        properties: { detail: { type: "string", enum: ["overview", "full"] } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recognize_source",
      description:
        "重新识别用户本次提供的来源图片，获取文字坐标。仅对提供的 sourceId 有效。不得猜测或读取其他文件。",
      parameters: {
        type: "object",
        properties: { sourceId: { type: "string" } },
        required: ["sourceId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prepare_dictation",
      description:
        "从已查看的真实材料提取听写草稿。words 每个英文单词一项（拆开括号/逗号词形），phrases 每个文字框一项，sentences 按句；columns 是每份材料从左到右的 1 起始列号，可以同时选2和4。默认保留重复，只有用户要求去重才设deduplicate=true。不生成新文字、不直接开始或保存听写。",
      parameters: {
        type: "object",
        properties: {
          materialIds: { type: "array", items: { type: "string" } },
          scope: {
            type: "string",
            enum: ["materials", "current"],
            description:
              "筛选原图列用 materials；去重或拆分当前编辑清单用 current，不恢复已删除项目",
          },
          mode: {
            type: "string",
            enum: ["auto", "words", "phrases", "sentences"],
          },
          columns: { type: "array", items: { type: "integer", minimum: 1 } },
          blockIds: { type: "array", items: { type: "string" } },
          language: { type: "string", enum: ["all", "english", "chinese"] },
          deduplicate: { type: "boolean" },
          limit: { type: "integer", minimum: 1, maximum: 300 },
        },
        required: ["mode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "select_passages",
      description:
        "提取原文片段或配对提示与答案。每个片段必须逐字存在于指定文字框；可用于成语、去题号、双语配对。表格文字框ID需先inspect_material(detail=full)。",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              properties: {
                materialId: { type: "string" },
                spokenBlockId: { type: "string" },
                answerBlockId: { type: "string" },
                spoken: { type: "string" },
                answer: { type: "string" },
              },
              required: [
                "materialId",
                "spokenBlockId",
                "answerBlockId",
                "spoken",
                "answer",
              ],
              additionalProperties: false,
            },
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
    },
  },
];
export const generateTool = {
  type: "function",
  function: {
    name: "propose_exercises",
    description:
      "只在用户选择AI辅助出题模式时可用。生成新练习草稿，全部标记AI生成并等待用户确认。",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              spoken: { type: "string" },
              answer: { type: "string" },
              language: {
                type: "string",
                enum: ["Chinese", "English", "Auto"],
              },
            },
            required: ["spoken", "answer", "language"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
};
export function contextMaterials(
  raw: RawMaterial[],
  items: Item[],
): Material[] {
  const materials = raw.filter(isMaterial);
  if (materials.length) {
    const activeIds = new Set(items.map((i) => i.materialId).filter(Boolean));
    const active = materials.filter((m) => activeIds.has(m.id));
    const latest = Array.from(
      new Map(materials.map((m) => [m.source, m])).values(),
    );
    const manual = items.filter(
      (i) => !i.materialId && i.source === "手动输入",
    );
    return [
      ...(active.length ? active : latest),
      ...(manual.length
        ? [
            buildMaterial({
              id: "manual-list",
              source: "手动输入",
              provider: "editor",
              blocks: manual.map((i) => ({ id: i.id, text: i.answer })),
              mode: "phrases",
            }),
          ]
        : []),
    ];
  }
  if (raw.length)
    return raw.map((v, i) =>
      buildMaterial({
        id: `legacy-${i}`,
        source: v.source,
        provider: "legacy-text",
        text: v.text,
        blocks: v.text
          .split("\n")
          .filter((t) => t.trim())
          .map((text, j) => ({ id: `legacy-${i}-${j}`, text })),
        mode: "phrases",
      }),
    );
  if (!items.length) return [];
  return [
    buildMaterial({
      id: "manual-list",
      source: "当前编辑清单",
      provider: "editor",
      blocks: items.map((v) => ({ id: v.id, text: v.original || v.answer })),
      mode: "phrases",
    }),
  ];
}
export function inspectMaterials(
  ctx: AgentContext,
  detail: "overview" | "full" = "overview",
) {
  ctx.inspected = true;
  return {
    materials: ctx.materials.map((m) => ({
      id: m.id,
      source: m.source.slice(0, 120),
      provider: m.provider,
      kind: m.kind,
      defaultMode: m.mode,
      warnings: m.warnings,
      rowCount: new Set(m.blocks.map((b) => b.row).filter(Boolean)).size,
      columns: [...new Set(m.blocks.map((b) => b.column).filter(Boolean))].map(
        (column) => ({
          column,
          count: m.blocks.filter((b) => b.column === column).length,
          samples: m.blocks
            .filter((b) => b.column === column)
            .slice(0, 5)
            .map((b) => b.text),
        }),
      ),
      ...(detail === "full" || m.kind === "text"
        ? {
            blockFields: ["id", "row", "column", "text"],
            blocks: m.blocks.map((b) => [
              b.id,
              b.row || 0,
              b.column || 0,
              b.text,
            ]),
          }
        : {
            note: "这是表格概览；按列可直接prepare_dictation。若需逐行内容，可inspect_material(detail=full)。",
          }),
    })),
    imageSources: ctx.sources.map((v) => ({
      id: v.id,
      source: v.source.slice(0, 120),
    })),
    currentList: {
      count: ctx.items.length,
      preview: ctx.items.slice(0, 5).map((v) => v.spoken),
    },
    rules: "去重当前清单用scope=current。草稿需要用户确认。",
  };
}
export function prepareDictation(ctx: AgentContext, input: unknown) {
  if (!ctx.inspected)
    throw Error("请先调用 inspect_material，查看真实行列再提取。");
  const args = prepareArgs.parse(input);
  if (
    args.scope === "current" &&
    (args.columns?.length || args.blockIds?.length || args.materialIds?.length)
  )
    throw Error("当前清单筛选不能混用原图列或文字框，请选择 materials 范围。");
  const selected = args.materialIds?.length
    ? ctx.materials.filter((m) => args.materialIds!.includes(m.id))
    : ctx.materials;
  if (
    !selected.length ||
    args.materialIds?.some((id) => !ctx.materials.some((m) => m.id === id))
  )
    throw Error("材料 ID 不存在，请重新查看材料。");
  if (
    selected.some(
      (m) =>
        m.provider === "legacy-text" &&
        m.warnings.some((w) => w.includes("编码")),
    )
  )
    throw Error("旧识别结果包含乱码，请先重新识别来源图片。");
  if (
    args.columns?.length &&
    selected.some((m) => !m.blocks.some((b) => b.column))
  )
    throw Error("这份材料没有列坐标，不能猜测过去式或原形列，请重新识别原图。");
  if (
    args.columns?.some(
      (c) => !selected.some((m) => m.blocks.some((b) => b.column === c)),
    )
  )
    throw Error("所选列不存在。");
  if (
    args.blockIds?.some(
      (id) => !selected.some((m) => m.blocks.some((b) => b.id === id)),
    )
  )
    throw Error("所选文字框不存在。");
  if (args.blockIds?.length && selected.length > 1)
    throw Error("按文字框筛选时请先限定一份材料，避免跨图同名文字框混淆。");
  const useCurrent =
    args.scope === "current" ||
    (args.scope !== "materials" &&
      args.deduplicate &&
      !args.columns?.length &&
      !args.blockIds?.length &&
      !args.materialIds?.length);
  const currentItems = ctx.items.filter((i) =>
    args.language === "english"
      ? /[a-z]/i.test(i.answer) && !/[\u3400-\u9fff]/.test(i.answer)
      : args.language === "chinese"
        ? /[\u3400-\u9fff]/.test(i.answer)
        : true,
  );
  let proposal = useCurrent
    ? args.mode === "words" || args.mode === "sentences"
      ? splitExistingItems(currentItems, args.mode)
      : currentItems.map((v) => ({ ...v, id: crypto.randomUUID() }))
    : selected.flatMap((m) =>
        extractMaterial(m, {
          ...args,
          deduplicate: false,
          limit: undefined,
        } as ExtractionOptions),
      );
  if (args.deduplicate) {
    const seen = new Set<string>();
    proposal = proposal.filter((i) => {
      const k = i.answer.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  if (args.limit) proposal = proposal.slice(0, args.limit);
  if (!proposal.length) throw Error("没有匹配的听写内容，请调整筛选条件。");
  if (proposal.length > 300)
    throw Error("清单超过300项，请先选择列、选区或限定数量。");
  ctx.proposal = proposal;
  return {
    count: proposal.length,
    mode: args.mode,
    columns: args.columns || "all",
    requiresConfirmation: true,
    reviewCount: proposal.filter((v) => itemIssue(v)).length,
    preview: proposal
      .slice(0, 16)
      .map((v) => ({ spoken: v.spoken, answer: v.answer, source: v.source })),
    summary: "已根据真实文字建立待确认草稿；尚未开始听写或改变用户进度。",
  };
}
export function selectPassages(ctx: AgentContext, input: unknown) {
  if (!ctx.inspected) throw Error("请先查看真实材料。");
  const data = z
    .object({
      items: z
        .array(
          z
            .object({
              materialId: z.string(),
              spokenBlockId: z.string(),
              answerBlockId: z.string(),
              spoken: z.string().trim().min(1).max(1000),
              answer: z.string().trim().min(1).max(1000),
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict()
    .parse(input);
  const proposal = data.items.map((entry) => {
    const material = ctx.materials.find((m) => m.id === entry.materialId);
    const spoken = material?.blocks.find((b) => b.id === entry.spokenBlockId);
    const answer = material?.blocks.find((b) => b.id === entry.answerBlockId);
    if (
      !material ||
      !spoken ||
      !answer ||
      !spoken.text.includes(entry.spoken) ||
      !answer.text.includes(entry.answer)
    )
      throw Error("片段无法在对应原文中核查，请重新查看材料。");
    const original =
      spoken === answer ? spoken.text : `${spoken.text}\n${answer.text}`;
    const issues = extractMaterial(
      { ...material, blocks: [spoken, answer] },
      { mode: "phrases" },
    );
    return {
      ...newItem(entry.spoken, material.source),
      original,
      answer: entry.answer,
      materialId: material.id,
      blockId: spoken.id,
      unit: "phrases" as const,
      reviewReason: issues.find((i) => i.reviewReason)?.reviewReason,
    };
  });
  ctx.proposal = proposal;
  return {
    count: proposal.length,
    requiresConfirmation: true,
    preview: proposal
      .slice(0, 10)
      .map((i) => ({ spoken: i.spoken, answer: i.answer })),
  };
}
export function proposeExercises(ctx: AgentContext, input: unknown) {
  if (!ctx.allowGenerate) throw Error("按原文模式禁止新增练习。");
  const data = z
    .object({
      items: z
        .array(
          z
            .object({
              spoken: z.string().min(1).max(1000),
              answer: z.string().min(1).max(1000),
              language: z.enum(["Chinese", "English", "Auto"]),
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict()
    .parse(input);
  ctx.proposal = data.items.map((v) => ({
    ...newItem(v.spoken, "AI 辅助出题"),
    ...v,
    generated: true,
    unit: "phrases" as const,
  }));
  return {
    count: ctx.proposal.length,
    requiresConfirmation: true,
    generated: true,
    preview: ctx.proposal.slice(0, 10),
  };
}
