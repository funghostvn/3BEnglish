import React from 'react';
import { History, Play, X } from 'lucide-react';
import { PendingResume } from '../hooks/useExamSession';

// Lobby banner offering to restore an in-progress exam session that was
// interrupted (refresh/closed tab). Rendered by PracticeView and
// CustomTrainingView, each filtering for its own kind of session.
export default function ResumeSessionBanner({
  pending,
  onResume,
  onDiscard,
}: {
  pending: PendingResume;
  onResume: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-2xl px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex items-start gap-3 min-w-0">
        <span className="p-2 bg-indigo-100 rounded-xl text-indigo-600 shrink-0">
          <History className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-indigo-900 text-sm font-bold truncate" title={pending.examTitle}>
            Bạn có bài làm chưa hoàn thành: {pending.examTitle}
          </p>
          <p className="text-indigo-600/80 text-xs font-semibold mt-0.5">
            Đã trả lời {pending.answeredCount}/{pending.totalCount} câu · lưu lúc {new Date(pending.savedAt).toLocaleTimeString('vi-VN')}. Tiếp tục làm bài?
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onResume}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer shadow-xs"
        >
          <Play className="h-3.5 w-3.5" /> Tiếp tục làm bài
        </button>
        <button
          type="button"
          onClick={onDiscard}
          title="Bỏ bài làm dở này"
          className="bg-white border border-indigo-200 hover:bg-indigo-100 text-indigo-500 text-xs font-bold p-2 rounded-xl active:scale-95 transition-all cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
