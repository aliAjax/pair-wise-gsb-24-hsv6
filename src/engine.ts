import type { FieldError, FormState, RecordItem } from "./types";

export const FIELD_LABELS: Record<keyof FormState | "root", string> = {
  site: "遗址",
  trench: "探方",
  layer: "地层",
  featureCode: "遗迹单位",
  featureType: "单位类型",
  depth: "深度",
  soilColor: "土色",
  coord: "坐标点",
  finds: "出土物",
  root: "整体",
};

export function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function toFormState(record: RecordItem): FormState {
  return {
    site: record.site,
    trench: record.trench,
    layer: String(record.layer),
    featureCode: record.featureCode,
    featureType: record.featureType,
    depth: String(record.depth),
    soilColor: record.soilColor,
    coord: record.coord,
    finds: record.finds,
  };
}

/** 活动记录：作废记录不参与任何唯一性、深度与关联校验 */
export function activeRecords(records: RecordItem[]): RecordItem[] {
  return records.filter((r) => !r.voided);
}

interface ParsedCandidate {
  site: string;
  trench: string;
  layer: number;
  featureCode: string;
  featureType: "" | RecordItem["featureType"];
  depth: number;
  soilColor: string;
  coord: string;
  finds: string;
}

/**
 * 新增/编辑的事务性校验。任一规则不通过都会返回字段级错误，
 * 调用方必须整体拒绝提交、保留表单未提交内容。
 */
export function validateCandidate(
  form: FormState,
  allRecords: RecordItem[],
  editingId: string | null
): FieldError[] {
  const errors: FieldError[] = [];
  const active = activeRecords(allRecords).filter((r) => r.id !== editingId);

  // ---- 基础字段 ----
  const site = form.site.trim();
  const trench = normalizeCode(form.trench);
  const coord = normalizeCode(form.coord);
  const featureCode = normalizeCode(form.featureCode);
  const finds = form.finds.trim();
  const soilColor = form.soilColor.trim();

  if (!site) errors.push({ field: "site", message: "遗址名称不能为空" });
  if (!trench) errors.push({ field: "trench", message: "探方编号不能为空" });

  const layer = Number(form.layer);
  if (!form.layer.trim() || !Number.isInteger(layer) || layer < 1) {
    errors.push({ field: "layer", message: "地层必须为不小于 1 的整数（第1层为地表最新层）" });
  }

  const depth = Number(form.depth);
  if (!form.depth.trim() || !Number.isFinite(depth) || depth <= 0) {
    errors.push({ field: "depth", message: "深度必须为大于 0 的厘米数" });
  }

  if (!soilColor) errors.push({ field: "soilColor", message: "土色描述不能为空" });
  if (!coord) errors.push({ field: "coord", message: "坐标点不能为空" });

  if (featureCode && !form.featureType) {
    errors.push({ field: "featureType", message: "登记遗迹单位必须选择单位类型" });
  }
  if (!featureCode && form.featureType) {
    errors.push({ field: "featureCode", message: "选择了单位类型，需同时填写遗迹单位编号" });
  }

  // 结构性字段非法时后续比较无意义，直接返回
  if (errors.length > 0) return errors;

  const candidate: ParsedCandidate = {
    site,
    trench,
    layer,
    featureCode,
    featureType: featureCode ? form.featureType : "",
    depth,
    soilColor,
    coord,
    finds,
  };

  // ---- 规则 1：同一探方坐标唯一（作废坐标已释放，可重新使用） ----
  const coordTaken = active.some(
    (r) => normalizeCode(r.trench) === trench && normalizeCode(r.coord) === coord
  );
  if (coordTaken) {
    errors.push({
      field: "coord",
      message: `坐标 ${coord} 在探方 ${trench} 中已存在，同一探方坐标必须唯一`,
    });
  }

  // ---- 规则 2：深度不能逆行地层顺序（层号越大越深，深度必须严格递增） ----
  for (const other of active.filter((r) => normalizeCode(r.trench) === trench)) {
    if (other.layer < layer && !(other.depth < depth)) {
      errors.push({
        field: "depth",
        message: `深度逆行：第${other.layer}层（${other.depth}cm）比第${layer}层更浅，本层深度须大于 ${other.depth}cm`,
      });
    }
    if (other.layer > layer && !(other.depth > depth)) {
      errors.push({
        field: "depth",
        message: `深度逆行：第${other.layer}层（${other.depth}cm）比第${layer}层更深，本层深度须小于 ${other.depth}cm`,
      });
    }
  }

  // ---- 规则 3：出土物只能关联有效遗迹单位 ----
  if (finds && !featureCode) {
    errors.push({
      field: "featureCode",
      message: "登记了出土物，必须关联一个有效遗迹单位编号",
    });
  }

  if (featureCode) {
    // 同遗址下该单位的有效定义
    const definitions = active.filter(
      (r) => r.site.trim() === site && normalizeCode(r.featureCode) === featureCode
    );
    if (definitions.length > 0) {
      const established = definitions[0];
      if (established.featureType !== candidate.featureType) {
        errors.push({
          field: "featureType",
          message: `单位 ${featureCode} 已登记为「${established.featureType}」，类型不能冲突`,
        });
      }
      if (normalizeCode(established.trench) !== trench) {
        errors.push({
          field: "featureCode",
          message: `单位 ${featureCode} 已位于探方 ${established.trench}，不能登记到其他探方`,
        });
      }
    }
    // 新单位：本条记录自身即构成有效定义，出土物关联合法
  }

  return dedupeErrors(errors);
}

/**
 * 作废前置校验。遗迹单位的有效性锚定于该单位的开口记录
 * （所在地层最浅者；同层时取最早登记）：作废开口记录时，若仍有
 * 携带出土物的同单位记录（更深层位中的堆积）依赖它，则冲突并指向
 * 被作废记录的「遗迹单位」字段。
 */
export function validateVoid(target: RecordItem, allRecords: RecordItem[]): FieldError[] {
  if (target.voided) return [{ field: "root", message: "该记录已是作废状态" }];
  if (!target.featureCode) return [];

  const sameUnit = activeRecords(allRecords)
    .filter(
      (r) =>
        r.site.trim() === target.site.trim() &&
        normalizeCode(r.featureCode) === normalizeCode(target.featureCode)
    )
    .sort((a, b) =>
      a.layer !== b.layer
        ? a.layer - b.layer
        : a.createdAt !== b.createdAt
          ? a.createdAt - b.createdAt
          : a.id.localeCompare(b.id)
    );
  const anchor = sameUnit[0];
  if (!anchor || anchor.id !== target.id) return [];

  const dependents = sameUnit.filter((r) => r.id !== target.id && r.finds.trim() !== "");
  if (dependents.length === 0) return [];
  return dedupeErrors(
    dependents.map((holder) => ({
      field: "featureCode" as const,
      message: `该记录是单位 ${target.featureCode} 的开口登记（有效定义），记录 ${holder.trench} ${holder.coord}（第${holder.layer}层）仍有出土物关联它，请先处理关联出土物后再作废`,
    }))
  );
}

/**
 * 撤销作废前重新走完整事务校验：作废期间坐标可能已被占用、
 * 地层深度可能已被新记录改写，冲突时同样整体拒绝。
 */
export function validateRestore(record: RecordItem, allRecords: RecordItem[]): FieldError[] {
  const others = allRecords.filter((r) => r.id !== record.id);
  return validateCandidate(toFormState(record), others, record.id);
}

function dedupeErrors(errors: FieldError[]): FieldError[] {
  const seen = new Set<string>();
  return errors.filter((e) => {
    const key = e.field + "|" + e.message;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface CrossLayerAnomaly {
  kind: "unit-cross-layer" | "depth-inversion";
  message: string;
}

export interface DashboardStats {
  trenchCount: number;
  layerCount: number;
  findsCount: number;
  emptyLinkCount: number;
  anomalies: CrossLayerAnomaly[];
}

/** 看板随筛选结果实时重算：统计与跨层异常都只基于当前筛选出的活动记录 */
export function computeDashboard(records: RecordItem[]): DashboardStats {
  const active = activeRecords(records);
  const trenches = new Set<string>();
  const layers = new Set<string>();
  let findsCount = 0;
  let emptyLinkCount = 0;

  for (const r of active) {
    const trench = normalizeCode(r.trench);
    trenches.add(trench);
    layers.add(`${trench}#${r.layer}`);
    if (r.finds.trim() !== "") findsCount += 1;
    else emptyLinkCount += 1;
  }

  const anomalies: CrossLayerAnomaly[] = [];

  // 异常一：同一遗迹单位跨多个地层
  const unitLayers = new Map<string, { site: string; layers: Set<number> }>();
  for (const r of active.filter((x) => x.featureCode)) {
    const key = `${r.site.trim()}::${normalizeCode(r.featureCode)}`;
    const entry = unitLayers.get(key) ?? { site: r.site.trim(), layers: new Set<number>() };
    entry.layers.add(r.layer);
    unitLayers.set(key, entry);
  }
  for (const [key, entry] of unitLayers) {
    if (entry.layers.size > 1) {
      const code = key.split("::")[1];
      const order = [...entry.layers].sort((a, b) => a - b);
      anomalies.push({
        kind: "unit-cross-layer",
        message: `遗迹单位 ${code} 跨层：出现于第 ${order.join("、")} 层，请核对层位关系`,
      });
    }
  }

  // 异常二：同探方内地层与深度逆行的记录对
  const byTrench = new Map<string, RecordItem[]>();
  for (const r of active) {
    const trench = normalizeCode(r.trench);
    byTrench.set(trench, [...(byTrench.get(trench) ?? []), r]);
  }
  for (const [trench, list] of byTrench) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const shallow = a.layer < b.layer ? a : b;
        const deep = a.layer < b.layer ? b : a;
        if (shallow.layer !== deep.layer && shallow.depth > deep.depth) {
          anomalies.push({
            kind: "depth-inversion",
            message: `探方 ${trench}：第${shallow.layer}层 ${shallow.coord}（${shallow.depth}cm）深于第${deep.layer}层 ${deep.coord}（${deep.depth}cm）`,
          });
        }
      }
    }
  }

  return { trenchCount: trenches.size, layerCount: layers.size, findsCount, emptyLinkCount, anomalies };
}

/** 按单位类型与探方关键字筛选；作废记录默认隐藏，可通过开关查看 */
export function filterRecords(
  records: RecordItem[],
  typeFilters: string[],
  trenchQuery: string,
  includeVoided: boolean
): RecordItem[] {
  const query = normalizeCode(trenchQuery);
  return records
    .filter((r) => (includeVoided ? true : !r.voided))
    .filter((r) => (typeFilters.length === 0 ? true : typeFilters.includes(r.featureType)))
    .filter((r) => (query === "" ? true : normalizeCode(r.trench).includes(query)))
    .sort((a, b) => {
      const trench = normalizeCode(a.trench).localeCompare(normalizeCode(b.trench));
      if (trench !== 0) return trench;
      if (a.layer !== b.layer) return a.layer - b.layer;
      return b.createdAt - a.createdAt;
    });
}
