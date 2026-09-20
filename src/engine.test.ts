import assert from "node:assert";
import {
  computeDashboard,
  filterRecords,
  validateCandidate,
  validateRestore,
  validateVoid,
} from "./engine";
import { SEED_RECORDS } from "./seed";
import type { FormState } from "./types";

const form: FormState = {
  site: "hxwl-10",
  trench: "T0203",
  layer: "4",
  featureCode: "",
  featureType: "",
  depth: "100",
  soilColor: "黄土",
  coord: "E9N9",
  finds: "",
};

let errs = validateCandidate(form, SEED_RECORDS, null);
assert.deepEqual(errs, [], "合法新记录应通过");

// 规则1：同探方坐标唯一
errs = validateCandidate({ ...form, coord: "e3 n4" }, SEED_RECORDS, null);
assert(errs.some((e) => e.field === "coord"), "同探方重复坐标（忽略大小写空格）必须拒绝");
assert.equal(errs[0].field, "coord");

// 规则2：深度不能逆行（第2层比第3层浅，但填了更深）
errs = validateCandidate({ ...form, layer: "2", depth: "90", coord: "E9N8" }, SEED_RECORDS, null);
assert(errs.some((e) => e.field === "depth"), "深度逆行必须拒绝并指向深度字段");

// 规则3：出土物必须关联有效遗迹单位
errs = validateCandidate({ ...form, layer: "5", depth: "130", finds: "石斧1件" }, SEED_RECORDS, null);
assert(errs.some((e) => e.field === "featureCode"), "无单位的出土物必须拒绝");

// 出土物关联有效单位合法
errs = validateCandidate(
  { ...form, trench: "T0204", layer: "5", depth: "130", coord: "E8N8", featureCode: "H12", featureType: "灰坑", finds: "石斧1件" },
  SEED_RECORDS,
  null
);
assert.deepEqual(errs, [], "关联同遗址有效单位应通过");

// 单位类型冲突
errs = validateCandidate(
  { ...form, trench: "T0204", layer: "5", depth: "130", coord: "E8N8", featureCode: "H12", featureType: "墓葬", finds: "石斧1件" },
  SEED_RECORDS,
  null
);
assert(errs.some((e) => e.field === "featureType"), "单位类型冲突必须拒绝");

// 作废：作废唯一单位定义时，出土物仍关联它 -> 拒绝
const voidDef = SEED_RECORDS.find((r) => r.featureCode === "H12")!;
errs = validateVoid(voidDef, SEED_RECORDS);
// H12 记录本身有 finds，作废后无其他 H12 定义，但其自身是被删除者，不再是 holder => 0悬空，允许
assert.deepEqual(errs, [], "作废自带出土物的唯一定义，删除后无悬空关联，应允许");

// 构造：第二条 H12 引用记录有出土物，作废定义则悬空
const refs: typeof SEED_RECORDS = [
  ...SEED_RECORDS,
  {
    id: "x1", site: "hxwl-10", trench: "T0204", layer: 5, featureCode: "H12", featureType: "灰坑",
    depth: 150, soilColor: "灰土", coord: "E2N2", finds: "骨锥", createdAt: 4,
  },
];
errs = validateVoid(voidDef, refs);
assert(errs.length === 1 && errs[0].field === "featureCode", "作废导致悬空出土物关联必须拒绝");

// 作废纯地层记录不影响关联
errs = validateVoid(SEED_RECORDS[0], refs);
assert.deepEqual(errs, [], "作废无单位记录应允许");

// 撤销作废：坐标在作废期间被占用 -> 拒绝
const voided = { ...SEED_RECORDS[0], voided: true, voidedAt: 9, voidReason: "x" };
const occupied = refs.filter((r) => r.id !== voided.id);
errs = validateRestore(voided, [
  ...occupied,
  {
    id: "x2", site: "hxwl-10", trench: "T0203", layer: 4, featureCode: "", featureType: "",
    depth: 100, soilColor: "x", coord: "E3N4", finds: "", createdAt: 5,
  },
]);
assert(errs.some((e) => e.field === "coord"), "撤销作废时坐标被占用必须拒绝");

// 看板：空关联统计 + 单位跨层异常
const dash = computeDashboard(filterRecords(refs, [], "", false));
assert(dash.emptyLinkCount >= 1, "空关联数量应统计无出土物记录");
assert(dash.anomalies.some((a) => a.kind === "unit-cross-layer"), "H12 跨第4/5层应报跨层异常");

// 深度逆行异常
const inverted: typeof SEED_RECORDS = [
  { ...SEED_RECORDS[0] },
  {
    id: "y1", site: "hxwl-10", trench: "T0203", layer: 2, featureCode: "", featureType: "",
    depth: 200, soilColor: "x", coord: "E9N1", finds: "", createdAt: 5,
  },
];
const dash2 = computeDashboard(filterRecords(inverted, [], "", false));
assert(dash2.anomalies.some((a) => a.kind === "depth-inversion"), "应检出深度逆行对");

// 看板随筛选：只看房址则灰坑跨层不计入
const dash3 = computeDashboard(filterRecords(refs, ["房址"], "", false));
assert(!dash3.anomalies.some((a) => a.message.includes("H12")), "筛选房址后不应出现 H12 异常");

console.log("全部引擎测试通过");
