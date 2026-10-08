import type { Item } from "../shared";
import { readWork, saveWork, hasWork, type EditorWork } from "./workspace";
import { confirm } from "./ui";

/** Reviewing never clears the current draft before the user starts the new list. */
export async function prepareReview(items: Item[], title: string) {
  if (!items.length) return false;
  if (
    hasWork(readWork<EditorWork>("new-draft")) &&
    !(await confirm(
      "替换未开始的新清单？",
      "本机还有一份新清单正在准备。替换后，上次已保存的清单和听写进度仍保留。",
      "准备复习",
    ))
  )
    return false;
  saveWork<EditorWork>("new-draft", {
    draft: {
      title,
      items: items.map((item) => ({ ...item, marked: false, hint: false })),
      materials: [],
    },
    input: "",
  });
  wx.navigateTo({ url: "/pages/editor/index?new=1" });
  return true;
}
