import React, { useEffect, useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { fetchCollection } from '../services/firestore';
import { Attempt, User } from '../types';
import { EXAM_CLASSIFICATIONS } from '../constants';
import { useExamSession, ModalConfig } from '../hooks/useExamSession';
import ExamRunner from './ExamRunner';
import ResumeSessionBanner from './ResumeSessionBanner';
import { BookOpen, ArrowRight } from 'lucide-react';

interface PracticeViewProps {
  currentGradeFilter: string;
  currentUser: User | null;
  preSelectedExamId?: string | null;
  preSelectedAnswers?: { [qNum: string]: string } | null;
  onClearPreSelections: () => void;
  onShowModal: (config: ModalConfig) => void;
  onUserUpdate?: (patch: Partial<User>) => void;
}

export default function PracticeView({
  currentGradeFilter,
  currentUser,
  preSelectedExamId,
  preSelectedAnswers,
  onClearPreSelections,
  onShowModal,
  onUserUpdate,
}: PracticeViewProps) {
  const session = useExamSession(currentUser, currentGradeFilter, onShowModal, onUserUpdate);
  const { exams, loading, examActive, activeExam } = session;

  const [selectedClassificationFilter, setSelectedClassificationFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [doneFilter, setDoneFilter] = useState<'all' | 'done' | 'not_done'>('all');
  const [userAttempts, setUserAttempts] = useState<Attempt[]>([]);

  useEffect(() => {
    if (!currentUser) {
      setUserAttempts([]);
      return;
    }
    fetchCollection<Attempt>('attempts', where('userId', '==', currentUser.id))
      .then(setUserAttempts)
      .catch(err => console.error(err));
  }, [currentUser]);

  useEffect(() => {
    if (preSelectedExamId && exams.length > 0) {
      const found = exams.find(e => e.id === preSelectedExamId);
      if (found) {
        if (preSelectedAnswers) {
          session.startExamForReview(found, preSelectedAnswers);
        } else {
          session.startDirectExam(found);
        }
      }
      onClearPreSelections();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preSelectedExamId, exams]);

  const classificationFilteredExams = useMemo(
    () => exams.filter(e => selectedClassificationFilter === 'all' || e.classification === selectedClassificationFilter),
    [exams, selectedClassificationFilter]
  );

  // Years present in the current exam bank, newest first, for the year filter.
  const availableYears = useMemo(() => {
    const years: number[] = [];
    exams.forEach(e => {
      if (typeof e.year === 'number' && !years.includes(e.year)) years.push(e.year);
    });
    return years.sort((a, b) => b - a);
  }, [exams]);

  // Set of exam ids/codes the student has already attempted (drives the
  // "đã làm / chưa làm" filter and the per-card stats below).
  const attemptedKeys = useMemo(() => {
    const keys = new Set<string>();
    userAttempts.forEach(a => {
      if (a.examId) keys.add(a.examId);
      if (a.examCode) keys.add(`code:${a.examCode}`);
    });
    return keys;
  }, [userAttempts]);

  const filteredExams = useMemo(() => {
    const searchLower = searchQuery.toLowerCase().trim();
    return classificationFilteredExams.filter(e => {
      if (yearFilter !== 'all' && String(e.year) !== yearFilter) return false;
      if (doneFilter !== 'all') {
        const isDone = attemptedKeys.has(e.id) || (e.examCode ? attemptedKeys.has(`code:${e.examCode}`) : false);
        if (doneFilter === 'done' && !isDone) return false;
        if (doneFilter === 'not_done' && isDone) return false;
      }
      if (!searchLower) return true;
      const titleMatch = e.title && e.title.toLowerCase().includes(searchLower);
      const codeMatch = e.examCode && e.examCode.toLowerCase().includes(searchLower);
      return titleMatch || codeMatch;
    });
  }, [classificationFilteredExams, searchQuery, yearFilter, doneFilter, attemptedKeys]);

  if (loading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (examActive && activeExam) {
    return <ExamRunner session={session} />;
  }

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-200">
      {/* Offer to restore an interrupted fixed-exam session (custom/SRS saves
          are offered in CustomTrainingView instead) */}
      {session.pendingResume && session.pendingResume.examCode !== 'RANDOM' && session.pendingResume.examCode !== 'SRS' && (
        <ResumeSessionBanner
          pending={session.pendingResume}
          onResume={session.resumeSavedSession}
          onDiscard={session.discardSavedSession}
        />
      )}

      <div className="bg-white rounded-3xl border border-slate-200/60 shadow-xs p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 border-b pb-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-indigo-600" />
            <h3 className="text-slate-900 font-bold font-display tracking-tight text-base md:text-lg">Danh sách đề thi theo phân nhóm</h3>
          </div>

          <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setSelectedClassificationFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${selectedClassificationFilter === 'all' ? 'bg-white text-indigo-600 shadow-3xs' : 'text-slate-500 hover:text-slate-800'}`}
            >
              Tất cả
            </button>
            {EXAM_CLASSIFICATIONS.map(cls => (
              <button
                key={cls}
                type="button"
                onClick={() => setSelectedClassificationFilter(cls)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${selectedClassificationFilter === cls ? 'bg-white text-indigo-600 shadow-3xs' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {cls === 'Đề thi chính thức các năm' ? 'Đề chính thức' : cls === 'Đề thi thử từ các đơn vị' ? 'Đề thi thử' : 'Đề minh họa'}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Tìm kiếm đề thi bằng tiêu đề hoặc mã đề..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pl-11 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 transition-all font-sans"
            />
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-400 absolute left-4 top-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <div className="flex gap-2 shrink-0">
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              title="Lọc theo năm phát hành đề"
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="all">Mọi năm</option>
              {availableYears.map(y => (
                <option key={y} value={String(y)}>Năm {y}</option>
              ))}
            </select>

            <select
              value={doneFilter}
              onChange={(e) => setDoneFilter(e.target.value as 'all' | 'done' | 'not_done')}
              title="Lọc theo trạng thái luyện tập của bạn"
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="not_done">Chưa làm lần nào</option>
              <option value="done">Đã từng làm</option>
            </select>
          </div>
        </div>

        {exams.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            Không tìm thấy đề thi chính thức nào cho Lớp hiện tại. Vui lòng bấm vào "Quản lý đề thi" để nạp dữ liệu mẫu/JSON.
          </div>
        ) : classificationFilteredExams.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            Không tìm thấy đề thi nào thuộc phân loại "<b>{selectedClassificationFilter}</b>" cho Lớp hiện tại.
          </div>
        ) : filteredExams.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            Không tìm thấy đề thi nào phù hợp với từ khóa "<b>{searchQuery}</b>".
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredExams.map((exam) => {
              const examAttempts = userAttempts.filter(a => (a.examCode && exam.examCode && a.examCode === exam.examCode) || a.examId === exam.id);
              const attemptCount = examAttempts.length;
              const avgScore = attemptCount > 0
                ? (examAttempts.reduce((sum, a) => sum + (a.score || 0), 0) / attemptCount).toFixed(1)
                : '--';

              return (
                <div key={exam.id} className="p-5 border border-slate-200/60 rounded-2xl hover:border-indigo-500 hover:shadow-xs transition-all flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <span className="bg-indigo-50 text-indigo-700 text-[10px] font-bold px-2.5 py-0.5 rounded-md uppercase">Khóa: Lớp {exam.grade}</span>
                      <span className="bg-slate-50 text-slate-600 text-[10px] px-2.5 py-0.5 rounded-md font-semibold font-mono">Năm: {exam.year}</span>
                      {exam.classification && (
                        <span className="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-100/50">{exam.classification}</span>
                      )}
                    </div>

                    <h4 className="font-bold font-display tracking-tight text-slate-900 text-sm leading-snug line-clamp-2 md:mr-2">
                      {exam.examName || exam.title}
                    </h4>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 font-medium">
                      <span>Số câu: <b className="font-bold text-slate-700">{exam.numQuestions} câu</b></span>
                      <span>Thời gian: <b className="font-bold text-slate-700">{exam.duration} phút</b></span>
                      <span>Đơn vị: <b className="font-bold text-slate-700">{exam.publisher || "Chưa rõ"}</b></span>
                    </div>

                    <div className="mt-2 flex items-center justify-between bg-slate-50 p-2 rounded-lg text-xs border border-slate-100">
                      <div className="flex flex-col">
                        <span className="text-slate-400 font-medium">Số lần làm</span>
                        <span className="font-bold text-indigo-700 text-sm">{attemptCount}</span>
                      </div>
                      <div className="flex flex-col text-right">
                        <span className="text-slate-400 font-medium">Điểm trung bình</span>
                        <span className="font-bold text-emerald-600 text-sm">{avgScore} <span className="text-[10px] text-slate-400 font-normal">/ 10</span></span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => session.startDirectExam(exam)}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white hover:bg-slate-800 text-xs font-bold py-2.5 px-3 rounded-xl active:scale-97 transition-all flex items-center justify-center gap-1.5 mt-5 cursor-pointer shadow-xs"
                  >
                    Vào luyện đề <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
