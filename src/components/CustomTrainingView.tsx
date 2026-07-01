import React, { useEffect, useState } from 'react';
import { VOCABULARY_THEMES, GRAMMAR_THEMES, DIFFICULTY_LEVELS, User } from '../types';
import { useExamSession, ModalConfig } from '../hooks/useExamSession';
import ExamRunner from './ExamRunner';
import { ArrowRight, Sparkles, RefreshCw, Clock } from 'lucide-react';

interface CustomTrainingViewProps {
  currentGradeFilter: string;
  currentUser: User | null;
  preSelectedExamId?: string | null;
  preSelectedAnswers?: { [qNum: string]: string } | null;
  preSelectedVocab?: string | null;
  preSelectedGrammar?: string | null;
  onClearPreSelections: () => void;
  onShowModal: (config: ModalConfig) => void;
}

export default function CustomTrainingView({
  currentGradeFilter,
  currentUser,
  preSelectedExamId,
  preSelectedAnswers,
  preSelectedVocab,
  preSelectedGrammar,
  onClearPreSelections,
  onShowModal,
}: CustomTrainingViewProps) {
  const session = useExamSession(currentUser, currentGradeFilter, onShowModal);
  const { exams, loading, examActive, activeExam, srsItems } = session;

  const [customVocab, setCustomVocab] = useState('all');
  const [customGrammar, setCustomGrammar] = useState('all');
  const [customDiff, setCustomDiff] = useState('all');
  const [customSize, setCustomSize] = useState('40'); // '40' (50min) or '10' (15min)

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

  useEffect(() => {
    if (preSelectedVocab || preSelectedGrammar) {
      if (preSelectedVocab) setCustomVocab(preSelectedVocab);
      if (preSelectedGrammar) setCustomGrammar(preSelectedGrammar);
      onClearPreSelections();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preSelectedVocab, preSelectedGrammar]);

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

      {/* Top action cards (Custom Generator & SRS) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Custom Test Generator Module */}
        <div className="bg-gradient-to-br from-indigo-900 to-slate-900 text-white p-6 rounded-3xl border border-indigo-950 shadow-xl flex flex-col justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 bg-indigo-500/25 border border-indigo-500/30 px-3 py-1 rounded-full text-indigo-300 text-xs font-bold uppercase tracking-wider mb-4">
              <Sparkles className="h-3.5 w-3.5" /> AI Custom Quiz Generator
            </div>
            <h3 className="text-2xl font-bold mb-2">Tự tạo đề ngẫu nhiên 🎯</h3>
            <p className="text-slate-300 text-xs leading-relaxed mb-6">
              Hệ thống tự động lọc các câu hỏi phù hợp nhất từ database dựa trên tiêu chí bạn yêu thích và tổ chức theo tiêu chuẩn thi quốc tế.
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-indigo-300 uppercase tracking-wider block mb-1">Chủ đề từ vựng:</label>
                <select
                  value={customVocab}
                  onChange={(e) => setCustomVocab(e.target.value)}
                  className="w-full text-sm bg-indigo-950/60 border border-indigo-800 text-slate-100 p-2.5 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-indigo-400"
                >
                  <option value="all">Tất cả từ vựng</option>
                  {VOCABULARY_THEMES.map(theme => (
                    <option key={theme} value={theme}>{theme}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-indigo-300 uppercase tracking-wider block mb-1">Chủ điểm ngữ pháp:</label>
                <select
                  value={customGrammar}
                  onChange={(e) => setCustomGrammar(e.target.value)}
                  className="w-full text-sm bg-indigo-950/60 border border-indigo-800 text-slate-100 p-2.5 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-indigo-400"
                >
                  <option value="all">Tất cả cấu trúc ngữ pháp</option>
                  {GRAMMAR_THEMES.map(theme => (
                    <option key={theme} value={theme}>{theme}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-indigo-300 uppercase tracking-wider block mb-1">Khung mức độ khó (CEFR):</label>
                <select
                  value={customDiff}
                  onChange={(e) => setCustomDiff(e.target.value)}
                  className="w-full text-sm bg-indigo-950/60 border border-indigo-800 text-slate-100 p-2.5 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-indigo-400"
                >
                  <option value="all">Tất cả cấp độ khó (A1 - C2)</option>
                  {DIFFICULTY_LEVELS.map(diff => (
                    <option key={diff} value={diff}>{diff}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-indigo-300 uppercase tracking-wider block mb-1">Thời lượng & Số câu hỏi:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCustomSize('40')}
                    className={`p-2.5 rounded-xl border text-xs font-bold text-center transition-all cursor-pointer ${customSize === '40' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-indigo-950/60 border-indigo-800 text-indigo-300 hover:bg-indigo-950'}`}
                  >
                    40 Câu / 50 phút
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomSize('10')}
                    className={`p-2.5 rounded-xl border text-xs font-bold text-center transition-all cursor-pointer ${customSize === '10' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-indigo-950/60 border-indigo-800 text-indigo-300 hover:bg-indigo-950'}`}
                  >
                    10 Câu / 15 phút
                  </button>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={() => session.generateCustomQuiz({ vocab: customVocab, grammar: customGrammar, diff: customDiff, size: customSize })}
            className="w-full bg-white hover:bg-slate-100 text-slate-900 font-bold py-3 px-4 rounded-xl text-sm transition-all focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 flex items-center justify-center gap-1.5 active:scale-[0.98] mt-8 cursor-pointer font-sans"
          >
            Bắt đầu sinh đề ngẫu nhiên <ArrowRight className="h-4 w-4 text-indigo-600" />
          </button>
        </div>

        {/* SRS Test Generator Module */}
        <div className="bg-gradient-to-br from-emerald-900 to-slate-900 text-white p-6 rounded-3xl border border-emerald-950 shadow-xl flex flex-col justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 bg-emerald-500/25 border border-emerald-500/30 px-3 py-1 rounded-full text-emerald-300 text-xs font-bold uppercase tracking-wider mb-4">
              <RefreshCw className="h-3.5 w-3.5" /> Spaced Repetition (SRS)
            </div>
            <h3 className="text-2xl font-bold mb-2">Ôn luyện chuyên sâu 🧠</h3>
            <p className="text-slate-300 text-xs leading-relaxed mb-6">
              Hệ thống tự động lặp lại các câu hỏi trả lời sai theo chu kỳ nhịp não (3-7-15-30 ngày) để giúp bạn thành thạo thực sự. Tính năng "Spaced Repetition For Wrong Answers".
            </p>

            <div className="space-y-4">
              <div className="bg-emerald-950/50 p-4 rounded-xl border border-emerald-800/50">
                <h4 className="text-emerald-300 text-xs font-bold tracking-wider uppercase mb-3">Tình trạng ghi nhớ của bạn:</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[3, 7, 15, 30].map(interval => {
                    const countDue = srsItems.filter(i => i.interval === interval && i.status === 'pending' && new Date(i.nextReviewDate) <= new Date()).length;
                    const countPending = srsItems.filter(i => i.interval === interval && i.status === 'pending').length;
                    return (
                      <button
                        key={interval}
                        onClick={() => session.generateSrsQuiz(interval)}
                        disabled={countPending === 0}
                        className="flex flex-col text-left justify-between items-start bg-black/20 hover:bg-black/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all px-3 py-2.5 rounded-lg border border-transparent hover:border-emerald-500/50 cursor-pointer"
                      >
                        <div className="flex justify-between w-full items-center mb-1">
                          <span className="font-semibold">Chu kỳ {interval} ngày</span>
                          <span className="font-bold text-emerald-300">{countPending}</span>
                        </div>
                        {countDue > 0 ? (
                          <div className="text-[10px] text-amber-300 font-bold flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {countDue} câu đến hạn
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-400">Chưa có câu đến hạn</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bg-emerald-600/20 p-3 rounded-xl border border-emerald-500/30 flex items-center justify-between text-xs">
                <span className="text-emerald-200">Đã thành thạo:</span>
                <span className="text-emerald-300 font-bold px-2 py-0.5 bg-emerald-900 rounded">{srsItems.filter(i => i.status === 'mastered').length} câu hỏi</span>
              </div>
            </div>
          </div>

          <button
            onClick={() => session.generateSrsQuiz()}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3 px-4 rounded-xl text-sm transition-all focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 flex items-center justify-center gap-1.5 active:scale-[0.98] mt-8 cursor-pointer font-sans"
          >
            Làm bài với các câu đến hạn ({srsItems.filter(i => i.status === 'pending' && new Date(i.nextReviewDate) <= new Date()).length}) <ArrowRight className="h-4 w-4 text-emerald-950" />
          </button>
        </div>
      </div>

    </div>
  );
}
