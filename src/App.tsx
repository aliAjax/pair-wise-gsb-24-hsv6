import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./styles.css";
import {
  FIELD_LABELS,
  activeRecords,
  computeDashboard,
  filterRecords,
  normalizeCode,
  validateCandidate,
  validateRestore,
  validateVoid,
} from "./engine";
import { loadArchive, saveArchive } from "./storage";
import { SEED_RECORDS } from "./seed";
import { FEATURE_TYPES } from "./types";
import type { FieldError, FormState, RecordItem, VoidSnapshot } from "./types";

const EMPTY_FORM: FormState = {
  site: "hxwl-10",
  trench: "",
  layer: "",
  featureCode: "",
  featureType: "",
  depth: "",
  soilColor: "",
  coord: "",
  finds: "",
};

interface Conflict {
  title: string;
  errors: FieldError[];
  focusRecordId?: string;
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

function toForm(record: RecordItem): FormState {
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

function App() {
  const [booted] = useState(() => {
    const loaded = loadArchive(SEED_RECORDS);
    return loaded;
  });
  const [records, setRecords] = useState<RecordItem[]>(booted.records);
  const [filters, setFilters] = useState<string[]>(booted.filters);
  const [trenchQuery, setTrenchQuery] = useState(booted.trenchQuery);
  const [showVoided, setShowVoided] = useState(false);
  const [lastVoid, setLastVoid] = useState<VoidSnapshot | null>(booted.lastVoid);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const inputRefs = useRef<Partial<Record<keyof FormState, HTMLElement>>>({});
  const recordRefs = useRef<Map<string, HTMLElement>>(new Map());

  // 只有通过校验的变更才进入 records，因此每次落盘的都是合法档案
  useEffect(() => {
    try {
      saveArchive({ version: 1, records, filters, trenchQuery, lastVoid });
    } catch {
      setToast("本地档案写入失败，请检查浏览器存储权限后重试；本次变更仅保留在内存中。");
    }
  }, [records, filters, trenchQuery, lastVoid]);

  const filtered = useMemo(
    () => filterRecords(records, filters, trenchQuery, showVoided),
    [records, filters, trenchQuery, showVoided]
  );
  const dashboard = useMemo(() => computeDashboard(filtered), [filtered]);

  const fieldError = (field: keyof FormState): string | undefined =>
    errors.find((e) => e.field === field)?.message;

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => prev.filter((e) => e.field !== key));
    setConflict(null);
  }

  function focusFirstError(list: FieldError[]) {
    const first = list.find((e) => e.field !== "root" && inputRefs.current[e.field as keyof FormState]);
    if (first) inputRefs.current[first.field as keyof FormState]?.focus();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // 同一批内容一次性校验：任一冲突整体拒绝，表单未提交内容原样保留
    const found = validateCandidate(form, records, editingId);
    if (found.length > 0) {
      setErrors(found);
      setConflict(null);
      focusFirstError(found);
      return;
    }

    const now = Date.now();
    if (editingId) {
      setRecords((prev) =>
        prev.map((r) =>
          r.id === editingId
            ? {
                ...r,
                site: form.site.trim(),
                trench: normalizeCode(form.trench),
                layer: Number(form.layer),
                featureCode: normalizeCode(form.featureCode),
                featureType: form.featureCode.trim() ? form.featureType : "",
                depth: Number(form.depth),
                soilColor: form.soilColor.trim(),
                coord: normalizeCode(form.coord),
                finds: form.finds.trim(),
              }
            : r
        )
      );
    } else {
      const record: RecordItem = {
        id: createId(),
        site: form.site.trim(),
        trench: normalizeCode(form.trench),
        layer: Number(form.layer),
        featureCode: normalizeCode(form.featureCode),
        featureType: form.featureCode.trim() ? form.featureType : "",
        depth: Number(form.depth),
        soilColor: form.soilColor.trim(),
        coord: normalizeCode(form.coord),
        finds: form.finds.trim(),
        createdAt: now,
      };
      setRecords((prev) => [...prev, record]);
    }

    setForm(EMPTY_FORM);
    setEditingId(null);
    setErrors([]);
    setConflict(null);
  }

  function startEdit(record: RecordItem) {
    if (record.voided) return;
    setForm(toForm(record));
    setEditingId(record.id);
    setErrors([]);
    setConflict(null);
    inputRefs.current.trench?.focus();
    document.getElementById("record-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelEdit() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setErrors([]);
  }

  function handleVoid(record: RecordItem) {
    const reason = window.prompt(`作废 ${record.trench} · ${record.coord} 的记录，请填写作废原因：`, "");
    if (reason === null) return; // 用户取消，不产生任何变更
    const trimmed = reason.trim() || "未填写作废原因";

    const found = validateVoid(record, records);
    if (found.length > 0) {
      setConflict({
        title: `作废被整体拒绝：${record.trench} ${record.coord}（第${record.layer}层）`,
        errors: found,
        focusRecordId: record.id,
      });
      const node = recordRefs.current.get(record.id);
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const snapshot: VoidSnapshot = {
      record: { ...record },
      voidedAt: Date.now(),
      voidReason: trimmed,
    };
    setRecords((prev) =>
      prev.map((r) =>
        r.id === record.id ? { ...r, voided: true, voidedAt: snapshot.voidedAt, voidReason: trimmed } : r
      )
    );
    setLastVoid(snapshot);
    if (editingId === record.id) cancelEdit();
  }

  function handleUndoVoid() {
    if (!lastVoid) return;
    // 作废期间档案可能已变化，恢复必须重新通过全部规则
    const found = validateRestore(lastVoid.record, records);
    if (found.length > 0) {
      setConflict({
        title: `无法撤销作废：${lastVoid.record.trench} ${lastVoid.record.coord} 与现行档案冲突`,
        errors: found,
      });
      return;
    }
    const restored = { ...lastVoid.record };
    setRecords((prev) => prev.map((r) => (r.id === restored.id ? restored : r)));
    setLastVoid(null);
    setConflict(null);
  }

  function toggleFilter(type: string) {
    setFilters((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  }

  const metrics = [
    { label: "探方数", value: dashboard.trenchCount },
    { label: "地层数", value: dashboard.layerCount },
    { label: "出土物记录", value: dashboard.findsCount },
    { label: "空关联数量", value: dashboard.emptyLinkCount, danger: dashboard.emptyLinkCount > 0 },
    {
      label: "跨层异常",
      value: dashboard.anomalies.length,
      danger: dashboard.anomalies.length > 0,
    },
  ];

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-10 · 离线记录台 · port 5110</p>
          <h1>考古探方记录</h1>
          <p className="subtitle">遗址探方、地层关系与出土物坐标档案。数据仅存于本机浏览器，离线可用。</p>
        </div>
        <div className="stack-card">
          <span>当前活动记录 / 全部记录</span>
          <strong>
            {activeRecords(records).length} / {records.length} 条
          </strong>
          <span>所有新增、编辑、作废均经规则引擎校验后才写入本地档案</span>
        </div>
      </section>

      {toast && (
        <div className="toast" role="alert">
          <span>{toast}</span>
          <button onClick={() => setToast(null)}>知道了</button>
        </div>
      )}

      {lastVoid && (
        <section className="void-banner" aria-live="polite">
          <div>
            <strong>最近一次作废（刷新后仍保留）：</strong>
            {lastVoid.record.trench} · {lastVoid.record.coord}（第{lastVoid.record.layer}层） ·{" "}
            {lastVoid.voidReason} · {formatTime(lastVoid.voidedAt)}
          </div>
          <div className="void-actions">
            <button className="primary-action" onClick={handleUndoVoid}>
              撤销该次作废
            </button>
            <button onClick={() => setLastVoid(null)}>关闭提示（作废仍保留）</button>
          </div>
        </section>
      )}

      {conflict && (
        <section className="conflict-box" role="alert">
          <h3>{conflict.title}</h3>
          <ul>
            {conflict.errors.map((e, i) => (
              <li key={i}>
                <em>【{FIELD_LABELS[e.field]}】</em>
                {e.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="metrics-grid metrics-grid-5">
        {metrics.map((m) => (
          <article key={m.label} className={`metric-card${m.danger ? " metric-danger" : ""}`}>
            <span>{m.label}</span>
            <strong>{String(m.value)}</strong>
            <i className={m.danger ? "status-danger" : "status-ok"} />
          </article>
        ))}
      </section>

      <section className="panel anomaly-panel">
        <div className="section-heading">
          <div>
            <p>随当前筛选实时重算</p>
            <h2>跨层异常清单</h2>
          </div>
          <span className="result-count">
            筛选命中 {filtered.filter((r) => !r.voided).length} 条活动记录
          </span>
        </div>
        {dashboard.anomalies.length === 0 ? (
          <p className="anomaly-empty">当前筛选范围内未发现跨层异常；空关联数量见上方看板。</p>
        ) : (
          <ul className="anomaly-list">
            {dashboard.anomalies.map((a, i) => (
              <li key={i} className={a.kind === "depth-inversion" ? "anomaly-depth" : "anomaly-unit"}>
                <span className="anomaly-tag">{a.kind === "depth-inversion" ? "深度逆行" : "单位跨层"}</span>
                {a.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>遗迹类型筛选</h2>
          <div className="chips">
            {FEATURE_TYPES.map((type) => (
              <button
                key={type}
                className={filters.includes(type) ? "chip-active" : ""}
                onClick={() => toggleFilter(type)}
                aria-pressed={filters.includes(type)}
              >
                {type}
              </button>
            ))}
          </div>
          <h2>探方检索</h2>
          <label className="filter-search">
            <span>探方编号</span>
            <input
              value={trenchQuery}
              placeholder="如 T0203"
              onChange={(e) => setTrenchQuery(e.target.value)}
            />
          </label>
          <div className="filter-toggle">
            <label>
              <input
                type="checkbox"
                checked={showVoided}
                onChange={(e) => setShowVoided(e.target.checked)}
              />
              <span>同时查看已作废记录</span>
            </label>
          </div>
          {(filters.length > 0 || trenchQuery.trim() !== "") && (
            <button
              className="clear-filters"
              onClick={() => {
                setFilters([]);
                setTrenchQuery("");
              }}
            >
              清空全部筛选
            </button>
          )}
        </aside>

        <section className="panel" id="record-form">
          <div className="section-heading">
            <div>
              <p>{editingId ? "编辑模式" : "新增模式"}</p>
              <h2>{editingId ? "编辑探方记录" : "新增探方记录"}</h2>
            </div>
            {editingId && <button onClick={cancelEdit}>放弃编辑</button>}
          </div>
          <form onSubmit={handleSubmit} noValidate>
            <div className="field-grid">
              <label className={fieldError("site") ? "field-invalid" : ""}>
                <span>遗址 *</span>
                <input
                  ref={(el) => {
                    if (el) inputRefs.current.site = el;
                  }}
                  value={form.site}
                  onChange={(e) => updateForm("site", e.target.value)}
                  placeholder="如 hxwl-10"
                />
                {fieldError("site") && <small className="error-text">{fieldError("site")}</small>}
              </label>

              <label className={fieldError("trench") ? "field-invalid" : ""}>
                <span>探方编号 *</span>
                <input
                  ref={(el) => {
                    if (el) inputRefs.current.trench = el;
                  }}
                  value={form.trench}
                  onChange={(e) => updateForm("trench", e.target.value)}
                  placeholder="如 T0203"
                />
                {fieldError("trench") && <small className="error-text">{fieldError("trench")}</small>}
              </label>

              <label className={fieldError("layer") ? "field-invalid" : ""}>
                <span>地层（第1层为最新地表层，层号越大越深）*</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  ref={(el) => {
                    if (el) inputRefs.current.layer = el;
                  }}
                  value={form.layer}
                  onChange={(e) => updateForm("layer", e.target.value)}
                  placeholder="如 3"
                />
                {fieldError("layer") && <small className="error-text">{fieldError("layer")}</small>}
              </label>

              <label className={fieldError("depth") ? "field-invalid" : ""}>
                <span>距地表深度（厘米）*</span>
                <input
                  type="number"
                  min={1}
                  step="1"
                  ref={(el) => {
                    if (el) inputRefs.current.depth = el;
                  }}
                  value={form.depth}
                  onChange={(e) => updateForm("depth", e.target.value)}
                  placeholder="如 85"
                />
                {fieldError("depth") && <small className="error-text">{fieldError("depth")}</small>}
              </label>

              <label className={fieldError("featureCode") ? "field-invalid" : ""}>
                <span>遗迹单位编号（纯地层记录留空）</span>
                <input
                  ref={(el) => {
                    if (el) inputRefs.current.featureCode = el;
                  }}
                  value={form.featureCode}
                  onChange={(e) => updateForm("featureCode", e.target.value)}
                  placeholder="如 H12、F2"
                />
                {fieldError("featureCode") && (
                  <small className="error-text">{fieldError("featureCode")}</small>
                )}
              </label>

              <label className={fieldError("featureType") ? "field-invalid" : ""}>
                <span>单位类型</span>
                <select
                  ref={(el) => {
                    if (el) inputRefs.current.featureType = el;
                  }}
                  value={form.featureType}
                  onChange={(e) => updateForm("featureType", e.target.value as FormState["featureType"])}
                >
                  <option value="">— 无遗迹单位 —</option>
                  {FEATURE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                {fieldError("featureType") && (
                  <small className="error-text">{fieldError("featureType")}</small>
                )}
              </label>

              <label className={fieldError("soilColor") ? "field-invalid" : ""}>
                <span>土色 / 土质 *</span>
                <input
                  ref={(el) => {
                    if (el) inputRefs.current.soilColor = el;
                  }}
                  value={form.soilColor}
                  onChange={(e) => updateForm("soilColor", e.target.value)}
                  placeholder="如 灰褐土"
                />
                {fieldError("soilColor") && (
                  <small className="error-text">{fieldError("soilColor")}</small>
                )}
              </label>

              <label className={fieldError("coord") ? "field-invalid" : ""}>
                <span>坐标点（同探方唯一）*</span>
                <input
                  ref={(el) => {
                    if (el) inputRefs.current.coord = el;
                  }}
                  value={form.coord}
                  onChange={(e) => updateForm("coord", e.target.value)}
                  placeholder="如 E3N4"
                />
                {fieldError("coord") && <small className="error-text">{fieldError("coord")}</small>}
              </label>

              <label className={`field-wide ${fieldError("finds") ? "field-invalid" : ""}`}>
                <span>出土物（登记出土物必须关联有效遗迹单位；留空计为空关联）</span>
                <textarea
                  rows={2}
                  ref={(el) => {
                    if (el) inputRefs.current.finds = el;
                  }}
                  value={form.finds}
                  onChange={(e) => updateForm("finds", e.target.value)}
                  placeholder="如 陶片12件；无出土物则留空"
                />
                {fieldError("finds") && <small className="error-text">{fieldError("finds")}</small>}
              </label>
            </div>
            <div className="form-actions">
              <button type="submit" className="primary-action">
                {editingId ? "保存编辑" : "提交新记录"}
              </button>
              <button type="button" onClick={() => setForm(EMPTY_FORM)} disabled={editingId !== null}>
                清空表单
              </button>
              {errors.length > 0 && (
                <span className="form-reject-hint">共 {errors.length} 处冲突，已整体拒绝，未提交内容已保留</span>
              )}
            </div>
          </form>
        </section>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>本地档案</p>
            <h2>探方记录{filters.length > 0 || trenchQuery ? "（已筛选）" : ""}</h2>
          </div>
        </div>
        {filtered.length === 0 ? (
          <p className="anomaly-empty">没有符合当前筛选的记录。</p>
        ) : (
          <div className="record-list">
            {filtered.map((record) => (
              <article
                key={record.id}
                ref={(el) => {
                  if (el) recordRefs.current.set(record.id, el);
                }}
                className={`record-card ${record.voided ? "record-voided" : ""} ${
                  conflict?.focusRecordId === record.id ? "record-conflict" : ""
                }`}
              >
                <div className="record-index">L{record.layer}</div>
                <div className="record-body">
                  <div className="record-title">
                    <h3>
                      {record.trench} · {record.coord}
                    </h3>
                    {record.voided && <span className="badge badge-void">已作废</span>}
                    {!record.voided && record.finds.trim() === "" && (
                      <span className="badge badge-empty">空关联</span>
                    )}
                    {!record.voided && record.featureCode && (
                      <span className="badge badge-unit">
                        {record.featureCode} · {record.featureType}
                      </span>
                    )}
                  </div>
                  <dl className="record-meta">
                    <div>
                      <dt>遗址</dt>
                      <dd>{record.site}</dd>
                    </div>
                    <div>
                      <dt>地层</dt>
                      <dd>第{record.layer}层</dd>
                    </div>
                    <div>
                      <dt>深度</dt>
                      <dd>{record.depth} cm</dd>
                    </div>
                    <div>
                      <dt>土色</dt>
                      <dd>{record.soilColor}</dd>
                    </div>
                    <div className="meta-wide">
                      <dt>出土物</dt>
                      <dd>{record.finds.trim() === "" ? "—（空关联）" : record.finds}</dd>
                    </div>
                    {record.voided && (
                      <div className="meta-wide">
                        <dt>作废</dt>
                        <dd>
                          {record.voidReason} · {record.voidedAt ? formatTime(record.voidedAt) : ""}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {!record.voided && (
                    <div className="record-actions">
                      <button onClick={() => startEdit(record)}>编辑</button>
                      <button className="danger-action" onClick={() => handleVoid(record)}>
                        作废
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
