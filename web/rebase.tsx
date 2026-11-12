import { useEffect, useState } from 'react';
import {
  entityData,
  entityLabel,
  type ChangeRequest,
  type Entity,
  type EntityData,
  type RebaseInput,
  type RebasePreview,
} from '../shared/schema';
import { api, ApiError, errorText } from './api';
import { label, Modal, RecordDetails } from './components';

export function RebaseDialog({
  request,
  entities,
  requestId,
  onBack,
  onGenerated,
}: {
  request: ChangeRequest;
  entities: Entity[];
  requestId: (key: string) => string;
  onBack: () => void;
  onGenerated: (value: ChangeRequest) => Promise<void>;
}) {
  const [preview, setPreview] = useState<RebasePreview | null>(null);
  const [choices, setChoices] = useState<Record<string, 'current' | 'proposed'>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setPreview(null);
    setChoices({});
    setError('');
    setStale(false);
    void api
      .previewRebase(request.id)
      .then((value) => {
        if (active) setPreview(value);
      })
      .catch((err) => {
        if (active) setError(errorText(err));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [request.id, refresh]);
  const conflicts =
    preview?.items.flatMap((item) =>
      item.conflicts.map((field) => ({
        id: item.operation.id!,
        field,
      })),
    ) ?? [];
  const unresolved = conflicts.some(({ id, field }) => !choices[id + ':' + field]);
  async function generate() {
    if (!preview) return;
    setBusy(true);
    setError('');
    const resolutions: RebaseInput['resolutions'] = conflicts.map(({ id, field }) => ({
      id,
      field,
      choice: choices[id + ':' + field],
    }));
    const payload = { previewToken: preview.token, resolutions };
    try {
      const result = await api.rebase(request.id, {
        ...payload,
        requestId: requestId('rebase:' + request.id + ':' + JSON.stringify(payload)),
      });
      await onGenerated(result);
    } catch (err) {
      const details =
        err instanceof ApiError && err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)
          ? err.details.map((item: { message: string }) => item.message).join('；')
          : '';
      setError(details ? '合并结果需要调整：' + details : errorText(err));
      if (err instanceof ApiError && err.code === 'REBASE_CHANGED') setStale(true);
    } finally {
      setBusy(false);
    }
  }
  const value = (data: EntityData | null, field: string) => {
    const raw = data ? (data as unknown as Record<string, string>)[field] : '';
    if (!raw) return '（空）';
    if (field.endsWith('Id')) {
      const target = entities.find((entity) => entity.id === raw);
      return target ? entityLabel(target) : raw;
    }
    return ['status', 'environmentStatus', 'priority', 'kind'].includes(field) ? label(raw) : raw;
  };
  return (
    <Modal
      title="重新合并提案"
      description="以最新记录为基础保留双方不冲突的修改。请逐项选择冲突内容；生成后仍需单独确认应用。"
      busy={busy}
      onClose={onBack}
    >
      <div className="review-content">
        {busy && !preview && <p role="status">正在读取最新记录…</p>}
        {preview && (
          <>
            <p className="warning">
              不冲突的修改已自动整合。同一字段同时修改时需要选择；未选择的冲突暂在预览中显示最新值。
            </p>
            {preview.blockers.map((blocker) => (
              <p className="alert" role="alert" key={blocker.id + blocker.message}>
                {blocker.message}
                <br />
                <small>记录编号：{blocker.id}</small>
              </p>
            ))}
            {preview.items.map((item, index) => {
              const op = item.operation;
              const proposed = 'entity' in op ? op.entity : null;
              const target = proposed ?? item.current ?? item.base;
              const base = item.base ? entityData(item.base) : null;
              const current = item.current ? entityData(item.current) : null;
              const merged = item.merged
                ? ({ ...item.merged } as unknown as Record<string, string>)
                : null;
              for (const field of item.conflicts)
                if (merged && choices[op.id + ':' + field] === 'proposed')
                  merged[field] = (proposed as unknown as Record<string, string>)[field];
              const keep = choices[op.id + ':$delete'] === 'current';
              return (
                <section className="proposal" key={op.id}>
                  <h3>
                    {label(op.action)}「{target ? entityLabel(target) : op.id}」
                  </h3>
                  <p className="small muted">
                    {item.base && `原基准修订 ${item.base.revision} · `}
                    {item.current
                      ? `最新修订 ${item.current.revision}`
                      : op.action === 'create'
                        ? '新记录'
                        : '记录已不存在'}
                  </p>
                  {item.conflicts.map((field) => (
                    <fieldset className="rebase-conflict" key={field} disabled={busy}>
                      <legend>
                        {field === '$delete' ? '记录已修改，是否仍要删除？' : `${label(field)}冲突`}
                      </legend>
                      {field !== '$delete' && (
                        <p className="rebase-base">原始值：{value(base, field)}</p>
                      )}
                      <label>
                        <input
                          type="radio"
                          name={`conflict-${index}-${field}`}
                          value="current"
                          checked={choices[op.id + ':' + field] === 'current'}
                          onChange={() =>
                            setChoices({ ...choices, [op.id + ':' + field]: 'current' })
                          }
                        />
                        <span>
                          {field === '$delete' ? '保留最新记录，取消这项删除' : '保留最新值'}
                          {field !== '$delete' && (
                            <span className="rebase-value">{value(current, field)}</span>
                          )}
                        </span>
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`conflict-${index}-${field}`}
                          value="proposed"
                          checked={choices[op.id + ':' + field] === 'proposed'}
                          onChange={() =>
                            setChoices({ ...choices, [op.id + ':' + field]: 'proposed' })
                          }
                        />
                        <span>
                          {field === '$delete' ? '仍然删除最新记录' : '采用提案值'}
                          {field !== '$delete' && (
                            <span className="rebase-value">{value(proposed, field)}</span>
                          )}
                        </span>
                      </label>
                    </fieldset>
                  ))}
                  <div className="diff-grid">
                    <section>
                      <h4>最新记录</h4>
                      <RecordDetails entity={item.current} entities={entities} />
                    </section>
                    <section>
                      <h4>合并后预览</h4>
                      {op.action === 'delete' ? (
                        keep ? (
                          <p>保留最新记录，不执行这项删除。</p>
                        ) : (
                          <p>确认后删除最新记录。</p>
                        )
                      ) : merged ? (
                        <RecordDetails entity={merged as EntityData} entities={entities} />
                      ) : (
                        <p>无法安全合并。</p>
                      )}
                    </section>
                  </div>
                </section>
              );
            })}
            {!conflicts.length && !preview.blockers.length && (
              <p role="status">没有字段冲突，已保留最新记录中的修改。</p>
            )}
            {unresolved && <p role="status">请选择全部冲突后生成新提案。</p>}
          </>
        )}
        {error && (
          <div className="alert" role="alert" tabIndex={-1} ref={(node) => node?.focus()}>
            {error}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button className="secondary" disabled={busy} onClick={onBack}>
          返回原提案
        </button>
        <button className="secondary" disabled={busy} onClick={() => setRefresh(refresh + 1)}>
          重新读取最新记录
        </button>
        <button
          disabled={busy || !preview || stale || unresolved || !!preview.blockers.length}
          onClick={() => void generate()}
        >
          {busy ? '正在处理…' : '生成新提案'}
        </button>
      </div>
    </Modal>
  );
}
