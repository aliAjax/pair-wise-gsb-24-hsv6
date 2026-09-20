// @ts-nocheck
import "./dom-env";
import { dom } from "./dom-env";
import assert from "node:assert";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";

const container = document.getElementById("root")!;

let promptValue: string | null = null;
dom.window.prompt = () => promptValue;

function render() {
  act(() => {
    createRoot(container).render(React.createElement(App));
  });
}

const $ = (sel: string) => container.querySelector(sel)!;
const $$ = (sel: string) => Array.from(container.querySelectorAll(sel));

function labelControl(text: string): HTMLElement {
  const scope = container.querySelector("form") ?? container;
  const label = Array.from(scope.querySelectorAll("label")).find(
    (l) => l.querySelector("span")?.textContent?.startsWith(text)
  );
  assert(label, `未找到字段: ${text}`);
  return label.querySelector("input,textarea,select") as HTMLElement;
}

function setValue(el: HTMLElement, value: string) {
  act(() => {
    const input = el as HTMLInputElement;
    const proto =
      el.tagName === "TEXTAREA"
        ? dom.window.HTMLTextAreaElement.prototype
        : el.tagName === "SELECT"
          ? dom.window.HTMLSelectElement.prototype
          : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

function clickButton(name: RegExp | string) {
  const btn = $$("button").find((b) =>
    typeof name === "string" ? b.textContent?.trim() === name : name.test(b.textContent ?? "")
  );
  assert(btn, `未找到按钮: ${name}`);
  act(() => (btn as HTMLButtonElement).click());
}

function metric(label: string): number {
  const card = $$(".metric-card").find((c) => c.querySelector("span")?.textContent === label)!;
  return Number(card.querySelector("strong")!.textContent);
}

function fillForm(data: Record<string, string>) {
  for (const [label, value] of Object.entries(data)) setValue(labelControl(label), value);
}

const BASE_FIELDS: Record<string, string> = {
  "遗址": "hxwl-10",
  "探方编号": "T0203",
  "地层": "4",
  "距地表深度": "100",
  "土色": "黄土",
  "坐标点": "E9N9",
};

// ---------- 1. 坐标重复整体拒绝，内容保留 ----------
render();
fillForm({ ...BASE_FIELDS, "坐标点": "e3 n4" });
clickButton("提交新记录");
assert($$(".error-text").some((e) => e.textContent?.includes("坐标 E3N4")), "应显示坐标冲突");
assert((labelControl("探方编号") as HTMLInputElement).value === "T0203", "未提交内容保留");
assert(JSON.parse(localStorage.getItem("hxwl-10.archive.v1")!).records.length === 3, "非法记录未写入档案");
console.log("✓ 坐标重复拒绝/字段定位/内容保留/不落地");

// ---------- 2. 深度逆行 ----------
setValue(labelControl("坐标点"), "E9N9");
setValue(labelControl("地层"), "2");
setValue(labelControl("距地表深度"), "100"); // T0203 第3层 85cm，第2层 100cm 逆行
clickButton("提交新记录");
assert($$(".error-text").some((e) => e.textContent?.includes("深度逆行")), "应显示深度逆行");
console.log("✓ 深度逆行拒绝并指向深度字段");

// ---------- 3. 出土物无有效单位 ----------
setValue(labelControl("地层"), "4");
setValue(labelControl("出土物"), "石斧1件");
clickButton("提交新记录");
assert($$(".error-text").some((e) => e.textContent?.includes("有效遗迹单位")), "应提示关联单位");
console.log("✓ 出土物必须关联有效遗迹单位");

// ---------- 4. 合法新增（T0204 第5层引用 H12）----------
fillForm({
  "遗址": "hxwl-10",
  "探方编号": "T0204",
  "地层": "5",
  "距地表深度": "130",
  "土色": "灰土",
  "坐标点": "E8N8",
  "遗迹单位编号": "H12",
  "出土物": "石斧1件",
});
(labelControl("单位类型") as HTMLSelectElement);
act(() => {
  const sel = labelControl("单位类型") as HTMLSelectElement;
  Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, "灰坑");
  sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
});
clickButton("提交新记录");
assert($$(".error-text").length === 0 && container.querySelectorAll(".record-card").length === 4, "合法记录应入库");
const stored1 = JSON.parse(localStorage.getItem("hxwl-10.archive.v1")!);
assert(stored1.records.length === 4, "合法记录应写入本地档案");
console.log("✓ 合法新增写入本地档案");

// ---------- 5. 看板实时重算：H12 跨层 + 空关联 ----------
assert(metric("跨层异常") >= 1, "应检出 H12 跨层");
assert($$(".anomaly-list li").some((li) => li.textContent?.includes("H12")), "异常清单列出 H12");
assert(metric("空关联数量") >= 1, "空关联数量 ≥1");
console.log("✓ 看板：跨层异常与空关联统计");

// ---------- 6. 筛选实时重算 ----------
clickButton("房址");
assert($$(".anomaly-list li").every((li) => !li.textContent?.includes("H12")), "筛选房址后 H12 异常消失");
clickButton("房址");
setValue($$("aside input")[0] as HTMLInputElement, "T0204");
assert(container.querySelectorAll(".record-card").length === 2, "T0204 检索命中 2 条");
setValue($$("aside input")[0] as HTMLInputElement, "");
const filtersStored = JSON.parse(localStorage.getItem("hxwl-10.archive.v1")!);
assert(filtersStored.trenchQuery === "", "筛选状态持久化");
console.log("✓ 筛选实时驱动看板与列表并持久化");

// ---------- 7. 作废 H12 开口记录被拒（E8N8 仍有出土物依赖）----------
promptValue = "测试作废";
const e1n2Card = $$(".record-card").find((c) => c.textContent?.includes("E1N2"))!;
act(() => (e1n2Card.querySelector("button.danger-action") as HTMLButtonElement).click());
assert(container.querySelector(".conflict-box"), "应弹作废冲突框");
assert($$(".conflict-box li").some((li) => li.textContent?.includes("E8N8")), "冲突指向 E8N8 关联记录");
console.log("✓ 作废有效单位开口被整体拒绝并指向关联");

// ---------- 8. 作废非锚点记录 E8N8 ----------
const e8n8Card = $$(".record-card").find((c) => c.textContent?.includes("E8N8"))!;
act(() => (e8n8Card.querySelector("button.danger-action") as HTMLButtonElement).click());
assert(container.querySelector(".void-banner")?.textContent?.includes("测试作废"), "横幅应显示最近作废");
console.log("✓ 作废成功并记录最近一次作废");

// ---------- 9. 刷新恢复（重新挂载 + 重新读 localStorage）----------
act(() => {
  container.innerHTML = "";
});
render();
assert(container.querySelector(".void-banner")?.textContent?.includes("测试作废"), "刷新后最近作废恢复");
assert(container.querySelectorAll(".record-card").length === 3, "默认隐藏已作废，剩 3 条");
act(() => (container.querySelector(".filter-toggle input") as HTMLInputElement).click());
assert($$(".record-card").some((c) => c.textContent?.includes("已作废")), "勾选后可见作废记录");
console.log("✓ 刷新恢复记录、筛选与最近作废");

// ---------- 9b. 筛选条件跨刷新恢复 ----------
act(() => (container.querySelector(".filter-toggle input") as HTMLInputElement).click()); // 取消作废视图
clickButton("灰坑");
setValue($$("aside input")[0] as HTMLInputElement, "t0204");
act(() => {
  container.innerHTML = "";
});
render();
assert(
  ($$("aside .chips button").find((b) => b.textContent?.trim() === "灰坑") as HTMLButtonElement)
    ?.classList.contains("chip-active"),
  "灰坑筛选刷新后应恢复"
);
assert(($$("aside input")[0] as HTMLInputElement).value === "t0204", "探方检索刷新后应恢复");
assert(
  $$(".record-card").every((c) => c.textContent?.includes("灰坑")) &&
    $$(".record-card").every((c) => c.textContent?.includes("T0204")),
  "恢复后列表应继续按筛选展示"
);
console.log("✓ 筛选条件跨刷新恢复");
// 清掉筛选继续后续步骤
clickButton("灰坑");
setValue($$("aside input")[0] as HTMLInputElement, "");

// ---------- 10. 撤销作废 ----------
clickButton("撤销该次作废");
assert(!container.querySelector(".void-banner"), "撤销后横幅消失");
act(() => container.innerHTML = "");
render();
assert(!container.querySelector(".void-banner"), "刷新后撤销保持");
const stored2 = JSON.parse(localStorage.getItem("hxwl-10.archive.v1")!);
const restored = stored2.records.find((r: any) => r.coord === "E8N8");
assert(restored && !restored.voided, "档案中 E8N8 恢复有效");
console.log("✓ 撤销作废并跨刷新保持");

// ---------- 11. 撤销冲突：作废期间坐标被占用则拒绝 ----------
// 先再次作废 E8N8
act(() => (container.querySelector(".filter-toggle input") as HTMLInputElement).click());
const card = $$(".record-card").find((c) => c.textContent?.includes("E8N8"))!;
act(() => (card.querySelector("button.danger-action") as HTMLButtonElement).click());
// 在其作废期间，新增一条占用 E8N8 的记录
fillForm({
  "遗址": "hxwl-10",
  "探方编号": "T0204",
  "地层": "6",
  "距地表深度": "160",
  "土色": "淤土",
  "坐标点": "E8N8",
});
clickButton("提交新记录");
assert($$(".record-card").some((c) => c.textContent?.includes("第6层")), "占用坐标的新记录入库");
// 撤销旧作废应被拒绝
clickButton("撤销该次作废");
assert(container.querySelector(".conflict-box")?.textContent?.includes("E8N8"), "撤销应因坐标冲突被拒");
const stored3 = JSON.parse(localStorage.getItem("hxwl-10.archive.v1")!);
const oldOne = stored3.records.find((r: any) => r.id === restored.id);
assert(oldOne.voided === true, "撤销被拒后旧记录仍保持作废，非法恢复不落地");
console.log("✓ 撤销作废遇冲突整体拒绝，非法恢复不落地");

// ---------- 12. 编辑自身记录不冲突 ----------
const f2 = $$(".record-card").find((c) => c.textContent?.includes("F2 · 房址"))!;
act(() => (f2.querySelector("button:not(.danger-action)") as HTMLButtonElement).click());
assert((labelControl("坐标点") as HTMLInputElement).value === "E5N7", "编辑表单回填");
setValue(labelControl("土色"), "夯土面（复核）");
clickButton("保存编辑");
assert($$(".error-text").length === 0, "编辑自身不应冲突");
console.log("✓ 编辑回填与保存");

console.log("\n全部端到端测试通过");
