import React, { useEffect, useMemo, useState } from 'react';
import { buildOmbreConfirmedFinalPreflight } from '../../utils/ombre/ombreConfirmedWritePreflight';
import type { OmbreConfirmedWriteQueueItem } from '../../utils/ombre/ombreConfirmedWriteQueue';

interface OmbreMemoryReviewCardProps {
    item: OmbreConfirmedWriteQueueItem | null;
    onEdit: (content: string) => void;
    onApprove: () => void;
    onReject: () => void;
}

const formatSource = (item: OmbreConfirmedWriteQueueItem): string => {
    const source = item.memoryPlan.source;
    const ids = source?.messageIds?.length ? source.messageIds.join(', ') : 'unknown';
    return `${source?.feature || 'unknown'} #${ids}`;
};

const riskFlags = (item: OmbreConfirmedWriteQueueItem): string[] => (
    item.confirmedPreview.ok ? item.confirmedPreview.audit.dryRunRiskFlags : item.confirmedPreview.riskFlags
);

const preflightBlockedCopy = (status: string): string => {
    if (status === 'candidate-not-approved') return '请先确认候选';
    if (status === 'candidate-preview-invalid') return '候选预览无效';
    if (status === 'final-confirmation-required') return '请勾选正式记忆确认';
    return '暂无可检查候选';
};

const OmbreMemoryReviewCard: React.FC<OmbreMemoryReviewCardProps> = ({
    item,
    onEdit,
    onApprove,
    onReject,
}) => {
    const [finalConfirmed, setFinalConfirmed] = useState(false);
    const [finalStatus, setFinalStatus] = useState('');
    const finalPreflight = useMemo(
        () => buildOmbreConfirmedFinalPreflight({ item, finalConfirmed }),
        [item, finalConfirmed],
    );
    const auditPreviewPreflight = useMemo(
        () => buildOmbreConfirmedFinalPreflight({ item, finalConfirmed: true }),
        [item],
    );
    const blockedStatus = finalPreflight.ok ? '' : preflightBlockedCopy(finalPreflight.status);

    useEffect(() => {
        setFinalConfirmed(false);
        setFinalStatus('');
    }, [item?.id, item?.status]);

    if (!item || item.status === 'rejected') return null;

    const preview = item.confirmedPreview;
    const request = preview.ok ? preview.request : null;
    const canApprove = item.status === 'pending' && preview.ok;

    return (
        <section className="mx-3 mb-2 rounded-lg border border-slate-200 bg-white/95 shadow-sm text-slate-700 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-100">
                <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-800 truncate">候选记忆</div>
                    <div className="text-[11px] text-slate-500 truncate">
                        <span className="font-medium">来源</span> {formatSource(item)}
                    </div>
                </div>
                {item.status === 'approved' && (
                    <div className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                        已确认候选，尚未写入
                    </div>
                )}
            </div>

            <div className="space-y-2 px-3 py-3">
                <label className="block text-[11px] font-semibold text-slate-500">编辑</label>
                <textarea
                    value={item.draftContent}
                    onChange={(event) => onEdit(event.target.value)}
                    disabled={item.status !== 'pending'}
                    className="min-h-[74px] w-full resize-y rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700 outline-none focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100 disabled:opacity-70"
                />

                <div className="grid gap-2 text-[11px] sm:grid-cols-2">
                    <div className="rounded-md bg-slate-50 px-2.5 py-2">
                        <div className="font-semibold text-slate-500">风险</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                            {riskFlags(item).map(flag => (
                                <span key={flag} className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">{flag}</span>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-md bg-slate-50 px-2.5 py-2">
                        <div className="space-y-1 break-words">
                            <div><span className="font-semibold text-slate-500">tags</span> {request?.tags || '-'}</div>
                            <div><span className="font-semibold text-slate-500">importance</span> {request?.importance ?? '-'}</div>
                            <div><span className="font-semibold text-slate-500">pinned</span> {String(request?.pinned ?? false)}</div>
                            <div><span className="font-semibold text-slate-500">why</span> {request?.why_remembered || '-'}</div>
                            <div><span className="font-semibold text-slate-500">meaning</span> {request?.meaning || '-'}</div>
                        </div>
                    </div>
                </div>

                {item.status === 'pending' && (
                    <div className="space-y-2">
                        <div className="rounded-md bg-amber-50 px-2.5 py-2 text-[11px] font-semibold text-amber-700">
                            请先确认候选
                        </div>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={onReject}
                                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                            >
                                拒绝
                            </button>
                            <button
                                type="button"
                                onClick={onApprove}
                                disabled={!canApprove}
                                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                            >
                                确认候选
                            </button>
                        </div>
                    </div>
                )}

                {item.status === 'failed' && (
                    <div className="rounded-md bg-rose-50 px-2.5 py-2 text-[11px] font-semibold text-rose-700">
                        候选预览无效
                    </div>
                )}

                {item.status === 'approved' && (
                    <div className="space-y-2 border-t border-slate-100 pt-3">
                        <div>
                            <div className="text-xs font-bold text-slate-800">写入前检查</div>
                            <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                                本页只完成正式写入前检查，不会写入 Ombre。
                            </div>
                        </div>

                        <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-700">
                            <input
                                type="checkbox"
                                checked={finalConfirmed}
                                onChange={(event) => setFinalConfirmed(event.target.checked)}
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-slate-900"
                            />
                            <span className="min-w-0 break-words">
                                我确认这是正式小乖记忆，不是测试内容、临时提示词、Sully 角色壳或 API 密钥。
                            </span>
                        </label>

                        <div className={`rounded-md px-2.5 py-2 text-[11px] font-semibold ${finalPreflight.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                            {finalPreflight.ok ? '写入前检查可提交，尚未写入 Ombre' : blockedStatus}
                        </div>

                        {auditPreviewPreflight.ok && (
                            <div className="rounded-md border border-slate-100 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600">
                                <div className="mb-1 font-semibold text-slate-700">audit preview</div>
                                <div className="grid gap-1 break-words">
                                    <div><span className="font-semibold text-slate-500">source message id(s)</span> {auditPreviewPreflight.auditPreview.sourceMessageIds.join(', ') || '-'}</div>
                                    <div><span className="font-semibold text-slate-500">feature</span> {auditPreviewPreflight.auditPreview.feature}</div>
                                    <div><span className="font-semibold text-slate-500">content preview</span> <span className="whitespace-pre-wrap">{auditPreviewPreflight.auditPreview.contentPreview || '-'}</span></div>
                                    <div><span className="font-semibold text-slate-500">content hash</span> {auditPreviewPreflight.auditPreview.contentHash}</div>
                                    <div><span className="font-semibold text-slate-500">risk flags</span> {auditPreviewPreflight.auditPreview.riskFlags.join(', ') || '-'}</div>
                                    <div><span className="font-semibold text-slate-500">readback status</span> {auditPreviewPreflight.auditPreview.readbackStatus}</div>
                                </div>
                            </div>
                        )}

                        {finalStatus && (
                            <div className="rounded-md bg-emerald-50 px-2.5 py-2 text-[11px] font-semibold text-emerald-700">
                                {finalStatus}
                            </div>
                        )}

                        <div className="flex justify-end">
                            <button
                                type="button"
                                disabled={!finalPreflight.ok}
                                onClick={() => {
                                    if (!finalPreflight.ok) return;
                                    setFinalStatus('写入前检查已通过，尚未写入 Ombre');
                                }}
                                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                            >
                                完成写入前检查（不写入）
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
};

export default OmbreMemoryReviewCard;
