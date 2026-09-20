export type FeatureType = "灰坑" | "墓葬" | "房址" | "沟状遗迹";

export const FEATURE_TYPES: FeatureType[] = ["灰坑", "墓葬", "房址", "沟状遗迹"];

/** 一条探方记录：可能是纯地层记录，也可能定义/引用一个遗迹单位 */
export interface RecordItem {
  id: string;
  site: string;
  /** 探方编号，如 T0203 */
  trench: string;
  /** 地层，如 第3层 */
  layer: number;
  /** 遗迹单位编号，如 H12；纯地层记录为空串 */
  featureCode: string;
  /** 遗迹单位类型；纯地层记录为空串 */
  featureType: "" | FeatureType;
  /** 距地表深度（厘米） */
  depth: number;
  soilColor: string;
  /** 坐标点，如 E3N4，同一探方内必须唯一 */
  coord: string;
  /** 出土物描述；为空表示该单位无出土登记（空关联） */
  finds: string;
  createdAt: number;
  voided?: boolean;
  voidedAt?: number;
  voidReason?: string;
}

export type FormState = {
  site: string;
  trench: string;
  layer: string;
  featureCode: string;
  featureType: "" | FeatureType;
  depth: string;
  soilColor: string;
  coord: string;
  finds: string;
};

/** 字段级错误：field 指向表单对应字段（作废冲突指向关联单位字段） */
export interface FieldError {
  field: keyof FormState | "root";
  message: string;
}

export interface VoidSnapshot {
  record: RecordItem;
  voidedAt: number;
  voidReason: string;
}

export interface PersistShape {
  version: number;
  records: RecordItem[];
  filters: string[];
  trenchQuery: string;
  lastVoid: VoidSnapshot | null;
}
