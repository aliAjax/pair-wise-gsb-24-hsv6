// 离线考古探方记录台：数据模型、校验规则、看板统计与本地档案持久化

export type RecordStatus = "active" | "void";

export interface TrenchRecord {
  id: string;
  site: string; // 遗址
  trench: string; // 探方
  layer: string; // 地层（第N层）
  unit: string; // 遗迹单位，如 H12灰坑 / F2房址
  depth: number; // 深度（米）
  soil: string; // 土色
  coord: string; // 坐标点，如 E3N4
  artifacts: string; // 出土物
  artifactUnit: string; // 出土物关联的遗迹单位编号，如 H12
  status: RecordStatus;
  createdAt: number;
  updatedAt: number;
}

/** 表单草稿，全部用字符串承载，校验通过后才落成记录 */
export interface Draft {
  site: string;
  trench: string;
  layer: string;
  unit: string;
  depth: string;
  soil: string;
  coord: string;
  artifacts: string;
  artifactUnit: string;
}

export type FieldKey = keyof Draft;

export const FIELD_LABELS: Record<FieldKey, string> = {
  site: "遗址",
  trench: "探方",
  layer: "地层",
  unit: "遗迹单位",
  depth: "深度",
  soil: "土色",
  coord: "坐标点",
  artifacts: "出土物",
  artifactUnit: "关联遗迹单位",
};

export interface Conflict {
  field: FieldKey;
  message: string;
}

export interface LastVoid {
  recordId: string;
  at: number;
}

export interface Anomaly {
  id: string;
  text: string;
}

export interface Board {
  trenches: number;
  layers: number;
  artifacts: number;
  untidy: number;
  crossLayer: Anomaly[];
  emptyLinks: Anomaly[];
}

export const FILTERS = [
  { key: "H", label: "灰坑" },
  { key: "M", label: "墓葬" },
  { key: "F", label: "房址" },
  { key: "G", label: "沟状遗迹" },
] as const;

export type FilterKey = (typeof FILTERS)[number]["key"];

// ---------------------------------------------------------------------------
// 解析工具

export function parseLayer(layer: string): number | null {
  const m = layer.match(/第\s*(\d+)\s*层/);
  return m ? Number(m[1]) : null;
}

/** 从“遗迹单位”文本中提取编号，如 “H12灰坑” -> “H12” */
export function unitCodeOf(text: string): string | null {
  const m = text.toUpperCase().match(/([HMFG])\s*0*(\d+)/);
  return m ? m[1] + m[2] : null;
}

export function unitPrefixOf(text: string): FilterKey | null {
  const code = unitCodeOf(text);
  return code ? (code[0] as FilterKey) : null;
}

function norm(text: string): string {
  return text.trim().toUpperCase().replace(/\s+/g, "");
}

export function emptyDraft(site = ""): Draft {
  return {
    site,
    trench: "",
    layer: "",
    unit: "",
    depth: "",
    soil: "",
    coord: "",
    artifacts: "",
    artifactUnit: "",
  };
}

export function draftFromRecord(rec: TrenchRecord): Draft {
  return {
    site: rec.site,
    trench: rec.trench,
    layer: rec.layer,
    unit: rec.unit,
    depth: String(rec.depth),
    soil: rec.soil,
    coord: rec.coord,
    artifacts: rec.artifacts,
    artifactUnit: rec.artifactUnit,
  };
}

// ---------------------------------------------------------------------------
// 校验：任一冲突整体拒绝，不落档

/**
 * 新增 / 编辑 / 撤销作废时共用的入库校验。
 * selfId：编辑或恢复时排除自身。
 */
export function validateDraft(
  draft: Draft,
  records: TrenchRecord[],
  selfId: string | null
): Conflict[] {
  const conflicts: Conflict[] = [];
  const others = records.filter((r) => r.status === "active" && r.id !== selfId);

  // 必填与格式
  if (!draft.site.trim()) conflicts.push({ field: "site", message: "遗址不能为空" });
  if (!draft.trench.trim()) conflicts.push({ field: "trench", message: "探方号不能为空" });

  const layerNo = parseLayer(draft.layer);
  if (!draft.layer.trim()) {
    conflicts.push({ field: "layer", message: "地层不能为空" });
  } else if (layerNo === null) {
    conflicts.push({ field: "layer", message: "地层格式应为“第N层”，如 第3层" });
  }

  const depth = Number(draft.depth);
  if (!draft.depth.trim()) {
    conflicts.push({ field: "depth", message: "深度不能为空" });
  } else if (!Number.isFinite(depth) || depth < 0) {
    conflicts.push({ field: "depth", message: "深度应为不小于 0 的数字（米）" });
  }

  if (!draft.coord.trim()) conflicts.push({ field: "coord", message: "坐标点不能为空" });

  if (conflicts.length > 0) return conflicts; // 基础信息不合法时不做档案比对

  const trench = norm(draft.trench);
  const sameTrench = others.filter((r) => norm(r.trench) === trench);

  // 规则一：同一探方内坐标点唯一
  const coordClash = sameTrench.find((r) => norm(r.coord) === norm(draft.coord));
  if (coordClash) {
    conflicts.push({
      field: "coord",
      message: `探方 ${draft.trench.trim()} 已存在坐标 ${coordClash.coord} 的记录（${coordClash.layer}），同一探方坐标必须唯一`,
    });
  }

  // 规则二：深度不得逆行地层顺序（同探方内，层位越深编号越大、深度应越大）
  if (layerNo !== null && Number.isFinite(depth)) {
    for (const r of sameTrench) {
      const rl = parseLayer(r.layer);
      if (rl === null) continue;
      if (rl < layerNo && r.depth > depth) {
        conflicts.push({
          field: "depth",
          message: `深度 ${depth}m 逆行地层顺序：${r.layer}（更浅层位）已记录深度 ${r.depth}m`,
        });
      }
      if (rl > layerNo && r.depth < depth) {
        conflicts.push({
          field: "depth",
          message: `深度 ${depth}m 逆行地层顺序：${r.layer}（更深层位）已记录深度 ${r.depth}m`,
        });
      }
    }
  }

  // 规则三：出土物只能关联有效（存在且未作废）的遗迹单位
  const linkRaw = draft.artifactUnit.trim();
  if (linkRaw) {
    const code = unitCodeOf(linkRaw);
    if (!code) {
      conflicts.push({
        field: "artifactUnit",
        message: `关联遗迹单位“${linkRaw}”编号无效，应形如 H12 / F2 / M3 / G5`,
      });
    } else {
      const selfCode = unitCodeOf(draft.unit);
      const exists = selfCode === code || others.some((r) => unitCodeOf(r.unit) === code);
      if (!exists) {
        conflicts.push({
          field: "artifactUnit",
          message: `关联的遗迹单位 ${code} 不存在或已作废，出土物只能关联有效遗迹单位`,
        });
      }
    }
  }

  // 编辑时若改动遗迹单位编号，不得让既有出土物关联落空
  if (selfId) {
    const before = records.find((r) => r.id === selfId);
    const oldCode = before ? unitCodeOf(before.unit) : null;
    const newCode = unitCodeOf(draft.unit);
    if (before && before.status === "active" && oldCode && oldCode !== newCode) {
      const dependents = others.filter((r) => unitCodeOf(r.artifactUnit) === oldCode);
      if (dependents.length > 0) {
        conflicts.push({
          field: "unit",
          message: `遗迹单位 ${oldCode} 仍被 ${dependents
            .map((r) => `${r.trench}·${r.layer}`)
            .join("、")} 的出土物关联，不能改号`,
        });
      }
    }
  }

  return conflicts;
}

/** 作废校验：被其他出土物关联的遗迹单位不得作废 */
export function validateVoid(target: TrenchRecord, records: TrenchRecord[]): string | null {
  const code = unitCodeOf(target.unit);
  if (!code) return null;
  const dependents = records.filter(
    (r) => r.status === "active" && r.id !== target.id && unitCodeOf(r.artifactUnit) === code
  );
  if (dependents.length > 0) {
    return `遗迹单位 ${code} 仍被 ${dependents
      .map((r) => `${r.trench}·${r.layer} 的出土物`)
      .join("、")} 关联，作废被拒绝`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 看板：随筛选实时重算

export function computeBoard(active: TrenchRecord[]): Board {
  const trenches = new Set(active.map((r) => norm(r.trench))).size;
  const layers = new Set(active.map((r) => r.layer.trim())).size;
  const artifacts = active.filter((r) => r.artifacts.trim() !== "").length;
  const untidy = active.filter(
    (r) => !r.unit.trim() || !r.coord.trim() || !r.soil.trim()
  ).length;

  // 跨层异常：同探方内层位与深度倒置的记录对
  const crossMap = new Map<string, Set<string>>();
  const byTrench = new Map<string, TrenchRecord[]>();
  for (const r of active) {
    const key = norm(r.trench);
    byTrench.set(key, [...(byTrench.get(key) ?? []), r]);
  }
  for (const group of byTrench.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const la = parseLayer(a.layer);
        const lb = parseLayer(b.layer);
        if (la === null || lb === null || la === lb) continue;
        const [shallow, deep] = la < lb ? [a, b] : [b, a];
        if (shallow.depth > deep.depth) {
          const note = `浅于 ${shallow.layer}（${shallow.depth}m）`;
          const note2 = `深于 ${deep.layer}（${deep.depth}m）`;
          crossMap.set(deep.id, (crossMap.get(deep.id) ?? new Set()).add(note));
          crossMap.set(shallow.id, (crossMap.get(shallow.id) ?? new Set()).add(note2));
        }
      }
    }
  }
  const crossLayer: Anomaly[] = [...crossMap.entries()].flatMap(([id, notes]) => {
    const rec = active.find((r) => r.id === id);
    return rec
      ? [{ id, text: `${rec.trench} ${rec.layer} 深 ${rec.depth}m：${[...notes].join("；")}` }]
      : [];
  });

  // 空关联：登记了出土物但未关联遗迹单位，或关联的单位不存在 / 已作废
  const liveCodes = new Set(
    active.map((r) => unitCodeOf(r.unit)).filter((c): c is string => c !== null)
  );
  const emptyLinks: Anomaly[] = active
    .filter((r) => r.artifacts.trim() !== "")
    .flatMap((r) => {
      const link = r.artifactUnit.trim();
      if (!link) {
        return [
          { id: r.id, text: `${r.trench} ${r.layer}「${r.artifacts}」未关联任何遗迹单位` },
        ];
      }
      const code = unitCodeOf(link);
      if (!code || !liveCodes.has(code)) {
        return [
          {
            id: r.id,
            text: `${r.trench} ${r.layer}「${r.artifacts}」关联的单位 ${link} 不存在或已作废`,
          },
        ];
      }
      return [];
    });

  return { trenches, layers, artifacts, untidy, crossLayer, emptyLinks };
}

// ---------------------------------------------------------------------------
// 本地档案（localStorage）：非法记录永远不会走到这里

const REC_KEY = "hxwl10.records.v1";
const FLT_KEY = "hxwl10.filters.v1";
const VOID_KEY = "hxwl10.lastVoid.v1";

function isRecord(x: unknown): x is TrenchRecord {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.trench === "string" &&
    typeof r.layer === "string" &&
    typeof r.depth === "number" &&
    (r.status === "active" || r.status === "void")
  );
}

export function loadRecords(): TrenchRecord[] {
  try {
    const raw = localStorage.getItem(REC_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(isRecord)) return parsed;
    }
  } catch {
    // 档案损坏时回退到初始样本
  }
  return seedRecords();
}

export function loadFilters(): FilterKey[] {
  try {
    const raw = localStorage.getItem(FLT_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((k): k is FilterKey =>
          FILTERS.some((f) => f.key === k)
        );
      }
    }
  } catch {
    // ignore
  }
  return [];
}

export function loadLastVoid(): LastVoid | null {
  try {
    const raw = localStorage.getItem(VOID_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LastVoid>;
      if (typeof parsed.recordId === "string" && typeof parsed.at === "number") {
        return { recordId: parsed.recordId, at: parsed.at };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveArchive(
  records: TrenchRecord[],
  filters: FilterKey[],
  lastVoid: LastVoid | null
): void {
  try {
    localStorage.setItem(REC_KEY, JSON.stringify(records));
    localStorage.setItem(FLT_KEY, JSON.stringify(filters));
    if (lastVoid) {
      localStorage.setItem(VOID_KEY, JSON.stringify(lastVoid));
    } else {
      localStorage.removeItem(VOID_KEY);
    }
  } catch {
    // 存储不可用时保持内存态，不阻断记录台工作
  }
}

// ---------------------------------------------------------------------------
// 初始样本档案（含一组跨层异常与两条空关联，便于看板演示）

function seedRecords(): TrenchRecord[] {
  const now = Date.now();
  const mk = (
    i: number,
    rec: Omit<TrenchRecord, "id" | "status" | "createdAt" | "updatedAt">
  ): TrenchRecord => ({
    ...rec,
    id: `seed-${i}`,
    status: "active",
    createdAt: now - (12 - i) * 3600_000,
    updatedAt: now - (12 - i) * 3600_000,
  });
  return [
    mk(1, {
      site: "后洼遗址",
      trench: "T0203",
      layer: "第1层",
      unit: "",
      depth: 0.3,
      soil: "灰褐土",
      coord: "E1N1",
      artifacts: "陶片3件",
      artifactUnit: "",
    }),
    mk(2, {
      site: "后洼遗址",
      trench: "T0203",
      layer: "第2层",
      unit: "H12灰坑",
      depth: 0.9,
      soil: "灰褐土",
      coord: "E3N4",
      artifacts: "陶片12件",
      artifactUnit: "H12",
    }),
    mk(3, {
      site: "后洼遗址",
      trench: "T0203",
      layer: "第3层",
      unit: "",
      depth: 1.6,
      soil: "黄褐土",
      coord: "E5N2",
      artifacts: "",
      artifactUnit: "",
    }),
    mk(4, {
      site: "后洼遗址",
      trench: "T0204",
      layer: "第1层",
      unit: "",
      depth: 0.4,
      soil: "灰褐土",
      coord: "E1N3",
      artifacts: "瓷片2件",
      artifactUnit: "H9",
    }),
    mk(5, {
      site: "后洼遗址",
      trench: "T0204",
      layer: "第2层",
      unit: "H7灰坑",
      depth: 1.2,
      soil: "黑褐土",
      coord: "E4N4",
      artifacts: "兽骨、炭屑",
      artifactUnit: "H7",
    }),
    mk(6, {
      site: "后洼遗址",
      trench: "T0204",
      layer: "第3层",
      unit: "",
      depth: 0.8,
      soil: "黄褐土",
      coord: "E6N1",
      artifacts: "",
      artifactUnit: "",
    }),
    mk(7, {
      site: "后洼遗址",
      trench: "T0301",
      layer: "第2层",
      unit: "F2房址",
      depth: 1.0,
      soil: "夯土",
      coord: "E2N5",
      artifacts: "瓦当1件",
      artifactUnit: "F2",
    }),
    mk(8, {
      site: "后洼遗址",
      trench: "T0301",
      layer: "第3层",
      unit: "M1墓葬",
      depth: 1.5,
      soil: "灰黄土",
      coord: "E3N5",
      artifacts: "随葬陶罐2件",
      artifactUnit: "M1",
    }),
  ];
}
