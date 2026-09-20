import type { PersistShape, RecordItem, VoidSnapshot } from "./types";

const STORAGE_KEY = "hxwl-10.archive.v1";
const STORAGE_VERSION = 1;

/**
 * 读取本地档案。仅返回结构完整的数据；任何损坏内容一律忽略，
 * 保证非法记录不会进入本地档案后又被加载。
 */
export function loadArchive(fallback: RecordItem[]): PersistShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded: PersistShape = {
        version: STORAGE_VERSION,
        records: fallback,
        filters: [],
        trenchQuery: "",
        lastVoid: null,
      };
      return seeded;
    }
    const parsed = JSON.parse(raw) as Partial<PersistShape>;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.records)) {
      return {
        version: STORAGE_VERSION,
        records: fallback,
        filters: [],
        trenchQuery: "",
        lastVoid: null,
      };
    }
    return {
      version: STORAGE_VERSION,
      records: parsed.records.filter((item) => isRecord(item)),
      filters: Array.isArray(parsed.filters) ? parsed.filters.filter((f) => typeof f === "string") : [],
      trenchQuery: typeof parsed.trenchQuery === "string" ? parsed.trenchQuery : "",
      lastVoid: isVoidSnapshot(parsed.lastVoid) ? parsed.lastVoid : null,
    };
  } catch {
    return {
      version: STORAGE_VERSION,
      records: fallback,
      filters: [],
      trenchQuery: "",
      lastVoid: null,
    };
  }
}

/**
 * 整体写入本地档案。调用方必须保证 records 已通过规则引擎校验，
 * 写失败（隐私模式/配额）时抛出，由上层提示，不会造成内存与档案不一致之外的静默丢失。
 */
export function saveArchive(data: PersistShape): void {
  const payload: PersistShape = {
    version: STORAGE_VERSION,
    records: data.records,
    filters: data.filters,
    trenchQuery: data.trenchQuery,
    lastVoid: data.lastVoid,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function isRecord(item: unknown): item is RecordItem {
  if (!item || typeof item !== "object") return false;
  const r = item as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.site === "string" &&
    typeof r.trench === "string" &&
    typeof r.layer === "number" &&
    typeof r.featureCode === "string" &&
    typeof r.featureType === "string" &&
    typeof r.depth === "number" &&
    typeof r.soilColor === "string" &&
    typeof r.coord === "string" &&
    typeof r.finds === "string" &&
    typeof r.createdAt === "number"
  );
}

function isVoidSnapshot(item: unknown): item is VoidSnapshot {
  if (!item || typeof item !== "object") return false;
  const s = item as Record<string, unknown>;
  return isRecord(s.record) && typeof s.voidedAt === "number" && typeof s.voidReason === "string";
}
