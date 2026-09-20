import type { RecordItem } from "./types";

/** 内置示例记录：仅作为首次打开时的种子数据，之后一切以本地档案为准 */
export const SEED_RECORDS: RecordItem[] = [
  {
    id: "seed-t0203-l3",
    site: "hxwl-10",
    trench: "T0203",
    layer: 3,
    featureCode: "",
    featureType: "",
    depth: 85,
    soilColor: "灰褐土",
    coord: "E3N4",
    finds: "陶片12件",
    createdAt: 1,
  },
  {
    id: "seed-t0204-h12",
    site: "hxwl-10",
    trench: "T0204",
    layer: 4,
    featureCode: "H12",
    featureType: "灰坑",
    depth: 120,
    soilColor: "黑褐土",
    coord: "E1N2",
    finds: "夹炭屑，见动物骨",
    createdAt: 2,
  },
  {
    id: "seed-t0301-f2",
    site: "hxwl-10",
    trench: "T0301",
    layer: 2,
    featureCode: "F2",
    featureType: "房址",
    depth: 60,
    soilColor: "夯土面",
    coord: "E5N7",
    finds: "",
    createdAt: 3,
  },
];
