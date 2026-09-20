import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  Board,
  Conflict,
  Draft,
  FIELD_LABELS,
  FILTERS,
  FieldKey,
  FilterKey,
  LastVoid,
  TrenchRecord,
  computeBoard,
  draftFromRecord,
  emptyDraft,
  loadFilters,
  loadLastVoid,
  loadRecords,
  saveArchive,
  unitPrefixOf,
  validateDraft,
  validateVoid,
} from "./lib/archive";

const FIELD_ORDER: FieldKey[] = [
  "site",
  "trench",
  "layer",
  "unit",
  "depth",
  "soil",
  "coord",
  "artifacts",
  "artifactUnit",
];

const FIELD_HINTS: Record<FieldKey, string> = {
  site: "如 后洼遗址",
  trench: "如 T0203",
  layer: "如 第3层",
  unit: "如 H12灰坑，可留空",
  depth: "米，如 1.25",
  soil: "如 灰褐土",
  coord: "如 E3N4，同探方内唯一",
  artifacts: "如 陶片12件，可留空",
  artifactUnit: "出土物归属单位编号，如 H12",
};

const project = {
  id: "hxwl-10",
  port: 5110,
  title: "考古探方记录台",
  subtitle: "离线可用的探方、地层与出土物档案：冲突整体拒绝，刷新自动恢复",
  users: ["发掘队员", "领队", "资料整理员"],
};

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function fmtTime(at: number): string {
  return new Date(at).toLocaleString("zh-CN", { hour12: false });
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "watch" | "danger";
}) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={`status-${tone}`} />
    </article>
  );
}

function App() {
  // 本地档案：刷新后从此恢复
  const [records, setRecords] = useState<TrenchRecord[]>(loadRecords);
  const [filters, setFilters] = useState<FilterKey[]>(loadFilters);
  const [lastVoid, setLastVoid] = useState<LastVoid | null>(loadLastVoid);

  // 未提交内容：校验失败时原样保留
  const [draft, setDraft] = useState<Draft>(() => emptyDraft("后洼遗址"));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [voidError, setVoidError] = useState<{ id: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    saveArchive(records, filters, lastVoid);
  }, [records, filters, lastVoid]);

  const filtered = useMemo(() => {
    if (filters.length === 0) return records;
    return records.filter((r) => {
      const prefix = unitPrefixOf(r.unit);
      return prefix !== null && filters.includes(prefix);
    });
  }, [records, filters]);

  const board: Board = useMemo(
    () => computeBoard(filtered.filter((r) => r.status === "active")),
    [filtered]
  );

  const fieldErrors = useMemo(() => {
    const map = {} as Record<FieldKey, string | undefined>;
    for (const c of conflicts) {
      if (!map[c.field]) map[c.field] = c.message;
    }
    return map;
  }, [conflicts]);

  function focusField(field: FieldKey) {
    requestAnimationFrame(() => {
      const el = document.getElementById(`f-${field}`);
      if (el instanceof HTMLInputElement) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.focus();
      }
    });
  }

  function rejectWith(next: Conflict[]) {
    // 整体拒绝：不写档案、不清草稿，只指向冲突字段
    setConflicts(next);
    setNotice(null);
    focusField(next[0].field);
  }

  function submitDraft() {
    const problems = validateDraft(draft, records, editingId);
    if (problems.length > 0) {
      rejectWith(problems);
      return;
    }
    const now = Date.now();
    if (editingId) {
      setRecords((prev) =>
        prev.map((r) =>
          r.id === editingId
            ? {
                ...r,
                site: draft.site.trim(),
                trench: draft.trench.trim(),
                layer: draft.layer.trim(),
                unit: draft.unit.trim(),
                depth: Number(draft.depth),
                soil: draft.soil.trim(),
                coord: draft.coord.trim(),
                artifacts: draft.artifacts.trim(),
                artifactUnit: draft.artifactUnit.trim(),
                updatedAt: now,
              }
            : r
        )
      );
      setNotice("修改已写入本地档案");
    } else {
      const rec: TrenchRecord = {
        id: newId(),
        site: draft.site.trim(),
        trench: draft.trench.trim(),
        layer: draft.layer.trim(),
        unit: draft.unit.trim(),
        depth: Number(draft.depth),
        soil: draft.soil.trim(),
        coord: draft.coord.trim(),
        artifacts: draft.artifacts.trim(),
        artifactUnit: draft.artifactUnit.trim(),
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      setRecords((prev) => [rec, ...prev]);
      setNotice("新记录已写入本地档案");
    }
    setDraft(emptyDraft(draft.site));
    setEditingId(null);
    setConflicts([]);
  }

  function startEdit(rec: TrenchRecord) {
    setEditingId(rec.id);
    setDraft(draftFromRecord(rec));
    setConflicts([]);
    setNotice(null);
    focusField("trench");
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft("后洼遗址"));
    setConflicts([]);
  }

  function voidRecord(rec: TrenchRecord) {
    const message = validateVoid(rec, records);
    if (message) {
      // 作废冲突：整体拒绝并指向该记录的遗迹单位
      setVoidError({ id: rec.id, message });
      setNotice(null);
      return;
    }
    setVoidError(null);
    setNotice(null);
    setRecords((prev) =>
      prev.map((r) => (r.id === rec.id ? { ...r, status: "void", updatedAt: Date.now() } : r))
    );
    setLastVoid({ recordId: rec.id, at: Date.now() });
    if (editingId === rec.id) cancelEdit();
  }

  function undoLastVoid() {
    if (!lastVoid) return;
    const rec = records.find((r) => r.id === lastVoid.recordId);
    if (!rec || rec.status !== "void") {
      setLastVoid(null);
      return;
    }
    // 恢复同样要过入库校验，避免把冲突带回档案
    const problems = validateDraft(draftFromRecord(rec), records, rec.id);
    if (problems.length > 0) {
      setVoidError({
        id: rec.id,
        message: `撤销作废被拒绝：${problems.map((p) => p.message).join("；")}`,
      });
      return;
    }
    setVoidError(null);
    setRecords((prev) =>
      prev.map((r) => (r.id === rec.id ? { ...r, status: "active", updatedAt: Date.now() } : r))
    );
    setLastVoid(null);
    setNotice("已撤销最近一次作废，记录恢复为有效");
  }

  function toggleFilter(key: FilterKey) {
    setFilters((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function exportSummary() {
    const payload = {
      exportedAt: new Date().toISOString(),
      filters,
      board: {
        探方数: board.trenches,
        地层数: board.layers,
        出土物: board.artifacts,
        未整理记录: board.untidy,
        跨层异常: board.crossLayer.length,
        空关联: board.emptyLinks.length,
      },
      records: filtered,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `探方记录摘要-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const lastVoidRecord = lastVoid
    ? records.find((r) => r.id === lastVoid.recordId) ?? null
    : null;

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">
            {project.id} · port {project.port} · 离线档案
          </p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>入库规则</span>
          <strong>同探方坐标唯一 · 深度顺地层 · 出土物关联有效单位</strong>
          <span>任一冲突整体拒绝，非法记录不写入本地档案</span>
        </div>
      </section>

      <section className="metrics-grid" aria-label="看板">
        <MetricCard label="探方数" value={board.trenches} tone="ok" />
        <MetricCard label="地层数" value={board.layers} tone="ok" />
        <MetricCard label="出土物" value={board.artifacts} tone="watch" />
        <MetricCard
          label="未整理记录"
          value={board.untidy}
          tone={board.untidy > 0 ? "watch" : "ok"}
        />
        <MetricCard
          label="跨层异常"
          value={board.crossLayer.length}
          tone={board.crossLayer.length > 0 ? "danger" : "ok"}
        />
        <MetricCard
          label="空关联"
          value={board.emptyLinks.length}
          tone={board.emptyLinks.length > 0 ? "danger" : "ok"}
        />
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>角色</h2>
          <div className="chips">
            {project.users.map((user) => (
              <span key={user}>{user}</span>
            ))}
          </div>
          <h2>筛选（按遗迹类型）</h2>
          <div className="chips filters">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={filters.includes(f.key) ? "active" : ""}
                onClick={() => toggleFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <p className="aside-note">
            看板与记录列表随筛选实时重算；筛选条件会随档案一起保存，刷新后自动恢复。
          </p>

          {(board.crossLayer.length > 0 || board.emptyLinks.length > 0) && (
            <>
              <h2>异常明细</h2>
              {board.crossLayer.length > 0 && (
                <div className="anomaly-block">
                  <h3>跨层异常 {board.crossLayer.length}</h3>
                  <ul className="anomaly-list">
                    {board.crossLayer.map((a) => (
                      <li key={a.id}>{a.text}</li>
                    ))}
                  </ul>
                </div>
              )}
              {board.emptyLinks.length > 0 && (
                <div className="anomaly-block">
                  <h3>空关联 {board.emptyLinks.length}</h3>
                  <ul className="anomaly-list">
                    {board.emptyLinks.map((a) => (
                      <li key={a.id}>{a.text}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>考古发掘 · 离线记录台</p>
              <h2>{editingId ? "编辑记录" : "新增记录"}</h2>
            </div>
            {editingId && (
              <button type="button" onClick={cancelEdit}>
                取消编辑
              </button>
            )}
          </div>

          {conflicts.length > 0 && (
            <div className="conflict-banner" role="alert">
              <strong>提交被整体拒绝，未写入档案。请修正以下冲突：</strong>
              <ul>
                {conflicts.map((c, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => focusField(c.field)}>
                      【{FIELD_LABELS[c.field]}】{c.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {notice && <div className="notice-banner">{notice}</div>}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitDraft();
            }}
          >
            <div className="field-grid">
              {FIELD_ORDER.map((key) => (
                <label key={key} className={fieldErrors[key] ? "has-error" : ""}>
                  <span>
                    {FIELD_LABELS[key]}
                    {["site", "trench", "layer", "depth", "coord"].includes(key) && (
                      <em className="required">*</em>
                    )}
                  </span>
                  <input
                    id={`f-${key}`}
                    className={fieldErrors[key] ? "invalid" : ""}
                    placeholder={FIELD_HINTS[key]}
                    value={draft[key]}
                    inputMode={key === "depth" ? "decimal" : undefined}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  />
                  {fieldErrors[key] && <small className="field-error">{fieldErrors[key]}</small>}
                </label>
              ))}
            </div>
            <div className="form-actions">
              <button type="submit" className="primary-action">
                {editingId ? "保存修改" : "提交记录"}
              </button>
              <span className="form-tip">校验通过后才会写入本地档案</span>
            </div>
          </form>
        </section>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>本地档案 · {filtered.length} 条{filters.length > 0 ? "（已筛选）" : ""}</p>
            <h2>探方记录</h2>
          </div>
          <button type="button" onClick={exportSummary}>
            导出摘要
          </button>
        </div>

        {lastVoidRecord && (
          <div className="void-banner">
            <span>
              最近一次作废：{lastVoidRecord.trench} · {lastVoidRecord.layer}（
              {fmtTime(lastVoid!.at)}），刷新后仍可撤销。
            </span>
            <button type="button" className="undo-action" onClick={undoLastVoid}>
              撤销作废
            </button>
          </div>
        )}
        {voidError && (
          <div className="conflict-banner" role="alert">
            <strong>操作被拒绝：</strong>
            {voidError.message}
          </div>
        )}

        <div className="record-list">
          {filtered.length === 0 && <p className="empty-tip">当前筛选下暂无记录</p>}
          {filtered.map((rec, index) => (
            <article
              key={rec.id}
              className={[
                "record-card",
                rec.status === "void" ? "voided" : "",
                voidError?.id === rec.id ? "conflict" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="record-index">{String(index + 1).padStart(2, "0")}</div>
              <div>
                <h3>
                  {rec.trench} · {rec.layer}
                  {rec.unit && <span className="unit-tag">{rec.unit}</span>}
                  {rec.status === "void" && <span className="badge-void">已作废</span>}
                </h3>
                <p>
                  {rec.site} · 深 {rec.depth}m · {rec.soil || "土色未录"} · 坐标{" "}
                  {rec.coord || "未录"}
                </p>
                {rec.artifacts && (
                  <p>
                    出土物：{rec.artifacts}
                    {rec.artifactUnit ? `（关联 ${rec.artifactUnit}）` : "（未关联单位）"}
                  </p>
                )}
              </div>
              <div className="card-actions">
                {rec.status === "active" ? (
                  <>
                    <button type="button" onClick={() => startEdit(rec)}>
                      编辑
                    </button>
                    <button type="button" className="danger" onClick={() => voidRecord(rec)}>
                      作废
                    </button>
                  </>
                ) : (
                  lastVoid?.recordId === rec.id && (
                    <button type="button" className="undo-action" onClick={undoLastVoid}>
                      撤销作废
                    </button>
                  )
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
