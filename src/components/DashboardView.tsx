import React, { useEffect, useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { Exam, Attempt, User, SRSItem, CategoryPerf, VOCABULARY_THEMES, GRAMMAR_THEMES } from '../types';
import { fetchCollection } from '../services/firestore';
import { estimateCefrFromPerf, CEFR_PASS_ACCURACY, CEFR_MIN_QUESTIONS_SOLID, CEFR_MIN_QUESTIONS_PROVISIONAL } from '../utils/cefr';
import ScoreTrendChart from './ScoreTrendChart';
import DiamondRedeemModal from './DiamondRedeemModal';
import {
  BarChart, BookOpen, Clock, Award, History, RotateCcw, TrendingUp, Trophy,
  RefreshCw, Flame, Target, Layers, AlertTriangle, Lock, Sparkles, Gem
} from 'lucide-react';

interface LeaderboardEntry {
  id: string;
  name: string;
  username: string;
  grade: string;
  attemptsCount: number;
  totalTime: number;
  latestScore: number | null;
  monthAvg: number | null;
}

interface DashboardViewProps {
  currentGradeFilter: string;
  currentUser: User | null;
  onRetakeExam: (examId: string, savedAnswers?: { [qNum: string]: string }) => void;
  onShowModal: (config: { type: 'success' | 'warning' | 'danger' | 'info'; title: string; message: string }) => void;
  onSelectWeakArea?: (type: 'vocab' | 'grammar', value: string) => void;
  onGoToSrsReview?: () => void;
  onUserUpdate?: (patch: Partial<User>) => void;
}

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const MILESTONES = [5, 10, 25, 50, 100, 200];

function aggregatePerf(attempts: Attempt[], pick: (a: Attempt) => { [k: string]: CategoryPerf } | undefined) {
  const agg: { [k: string]: CategoryPerf } = {};
  let hasData = false;
  attempts.forEach(att => {
    const perf = pick(att);
    if (!perf) return;
    hasData = true;
    Object.entries(perf).forEach(([k, v]) => {
      if (!agg[k]) agg[k] = { correct: 0, wrong: 0 };
      agg[k].correct += v.correct;
      agg[k].wrong += v.wrong;
    });
  });
  return { agg, hasData };
}

export default function DashboardView({
  currentGradeFilter,
  currentUser,
  onRetakeExam,
  onShowModal,
  onSelectWeakArea,
  onGoToSrsReview,
  onUserUpdate,
}: DashboardViewProps) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [srsItems, setSrsItems] = useState<SRSItem[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [sortBy, setSortBy] = useState<'attemptsCount' | 'totalTime' | 'monthAvg' | 'latestScore'>('totalTime');
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
    fetchDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGradeFilter, currentUser]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const parsedGradeFilter = currentGradeFilter === 'all' ? null : parseInt(currentGradeFilter, 10);
      const hasValidGradeFilter = parsedGradeFilter !== null && !isNaN(parsedGradeFilter);

      const examList = await fetchCollection<Exam>('exams');
      setExams(examList);

      let allAttemptsList = await fetchCollection<Attempt>('attempts');
      allAttemptsList = allAttemptsList.filter(att => (att.timeSpent || 0) >= 120);

      const attemptsByUser: { [userId: string]: Attempt[] } = {};
      allAttemptsList.forEach(att => {
        if (!attemptsByUser[att.userId]) {
          attemptsByUser[att.userId] = [];
        }
        attemptsByUser[att.userId].push(att);
      });

      const personalAttempts = allAttemptsList.filter(att => {
        if (currentUser?.role === 'admin') {
          return true;
        } else if (currentUser) {
          return att.userId === currentUser.id;
        } else {
          return att.userId === 'guest';
        }
      });

      // Grade filter only scopes the admin's own aggregate view (grade tabs);
      // a student/guest's personal history always shows every attempt they
      // made, regardless of which grade's exam it was on — otherwise it can
      // silently diverge from the leaderboard's unfiltered per-user count.
      const filteredAttempts = personalAttempts.filter(att => {
        if (currentUser?.role !== 'admin') return true;
        if (!hasValidGradeFilter) return true;
        return att.grade === parsedGradeFilter;
      });

      filteredAttempts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setAttempts(filteredAttempts);

      const [userList, srsList] = await Promise.all([
        fetchCollection<User>('users'),
        fetchCollection<SRSItem>('srs_items', where('userId', '==', currentUser?.id || 'guest')),
      ]);
      setSrsItems(srsList);

      const now = new Date();
      const curYear = now.getFullYear();
      const curMonth = now.getMonth();

      const leaderboardData: LeaderboardEntry[] = userList
        .filter(u => u.role !== 'admin')
        .map(u => {
          const userAttempts = attemptsByUser[u.id] || [];
          const attemptsCount = userAttempts.length;
          const totalTime = userAttempts.reduce((sum, att) => sum + (att.timeSpent || 0), 0);

          let latestScore: number | null = null;
          if (userAttempts.length > 0) {
            const sortedAttempts = [...userAttempts].sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
            latestScore = sortedAttempts[0].score;
          }

          const monthAttempts = userAttempts.filter(att => {
            const d = new Date(att.createdAt);
            return d.getFullYear() === curYear && d.getMonth() === curMonth;
          });

          const monthAvg = monthAttempts.length > 0
            ? monthAttempts.reduce((sum, att) => sum + att.score, 0) / monthAttempts.length
            : null;

          return {
            id: u.id,
            name: u.name,
            username: u.username,
            grade: u.grade,
            attemptsCount,
            totalTime,
            latestScore,
            monthAvg
          };
        })
        .filter(item => item.attemptsCount > 0);

      setLeaderboard(leaderboardData);
    } catch (err) {
      console.error(err);
      onShowModal({ type: 'danger', title: 'Lỗi tải bảng điều khiển', message: 'Không thể tải dữ liệu thống kê. Vui lòng kiểm tra kết nối mạng và tải lại trang.' });
    } finally {
      setLoading(false);
    }
  };

  const dashboardStats = useMemo(() => {
    let questionCount = 0;
    const vocabStats: { [theme: string]: number } = {};
    const grammarStats: { [theme: string]: number } = {};
    const diffStats: { [level: string]: number } = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 };
    const gradeStats: { [key: number]: number } = { 6: 0, 10: 0, 12: 0 };

    VOCABULARY_THEMES.forEach(theme => { vocabStats[theme] = 0; });
    GRAMMAR_THEMES.forEach(theme => { grammarStats[theme] = 0; });

    exams.forEach(ex => {
      if (ex.grade === 6 || ex.grade === 10 || ex.grade === 12) {
        gradeStats[ex.grade] = (gradeStats[ex.grade] || 0) + 1;
      }
      (ex.passages || []).forEach(pass => {
        const vocabCat = pass.vocabularyCategory || "Khác";
        (pass.questions || []).forEach(q => {
          questionCount++;
          if (q.difficulty && diffStats[q.difficulty] !== undefined) {
            diffStats[q.difficulty]++;
          }
          if (q.grammarCategory && grammarStats[q.grammarCategory] !== undefined) {
            grammarStats[q.grammarCategory]++;
          } else {
            grammarStats["Other grammar"]++;
          }
          if (vocabCat && vocabStats[vocabCat] !== undefined) {
            vocabStats[vocabCat]++;
          }
        });
      });
    });

    return {
      totalQuestionsCount: questionCount,
      vocabThemeStats: vocabStats,
      grammarThemeStats: grammarStats,
      difficultyStats: diffStats,
      examsByGrade: gradeStats,
    };
  }, [exams]);

  const totalQuestionsCount: number = dashboardStats.totalQuestionsCount;
  const difficultyStats: Record<string, number> = dashboardStats.difficultyStats;
  const examsByGrade: Record<number, number> = dashboardStats.examsByGrade;
  const totalExamsCount = exams.length;

  const totalCompletedCount = attempts.length;
  const averageCorrectionRate = totalCompletedCount > 0
    ? Math.round((attempts.reduce((sum, att) => sum + att.score, 0) / totalCompletedCount) * 10)
    : 0;

  const trendPoints = useMemo(() => {
    return attempts.slice(0, 12).slice().reverse().map(att => ({
      label: new Date(att.createdAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
      score: att.score,
    }));
  }, [attempts]);

  const weakAreas = useMemo(() => {
    const { agg: grammarAgg, hasData: hasGrammarPerf } = aggregatePerf(attempts, a => a.grammarPerf);
    const { agg: vocabAgg, hasData: hasVocabPerf } = aggregatePerf(attempts, a => a.vocabPerf);

    const rankByRate = (agg: { [k: string]: CategoryPerf }) => Object.entries(agg)
      .map(([key, v]) => ({ key, total: v.correct + v.wrong, wrong: v.wrong, rate: v.wrong / (v.correct + v.wrong) }))
      .filter(x => x.total >= 2)
      .sort((a, b) => b.rate - a.rate || b.wrong - a.wrong)
      .slice(0, 3)
      .map(x => x.key);

    const rankByCount = (list: string[][]) => {
      const counts: { [k: string]: number } = {};
      list.forEach(arr => arr.forEach(k => { counts[k] = (counts[k] || 0) + 1; }));
      return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
    };

    return {
      weakGrammar: hasGrammarPerf ? rankByRate(grammarAgg) : rankByCount(attempts.map(a => a.weakGrammar || [])),
      weakVocab: hasVocabPerf ? rankByRate(vocabAgg) : rankByCount(attempts.map(a => a.weakVocab || [])),
      isRateBased: hasGrammarPerf || hasVocabPerf,
    };
  }, [attempts]);

  const weakDifficulty = useMemo(() => {
    const { agg, hasData } = aggregatePerf(attempts, a => a.difficultyPerf);
    if (!hasData) return null;
    return CEFR_ORDER
      .filter(level => agg[level] && (agg[level].correct + agg[level].wrong) > 0)
      .map(level => {
        const v = agg[level];
        const total = v.correct + v.wrong;
        return { level, total, wrong: v.wrong, rate: total > 0 ? v.wrong / total : 0 };
      });
  }, [attempts]);

  const cefrEstimate = useMemo(() => {
    const { agg, hasData } = aggregatePerf(attempts, a => a.difficultyPerf);
    if (!hasData) return null;
    const current = estimateCefrFromPerf(agg);

    const months: { label: string; level: string | null; provisional: boolean; isCurrent: boolean }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEndExclusive = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const upTo = attempts.filter(a => new Date(a.createdAt) < monthEndExclusive);
      const { agg: cumAgg, hasData: has } = aggregatePerf(upTo, a => a.difficultyPerf);
      const est = has ? estimateCefrFromPerf(cumAgg) : null;
      months.push({
        label: `T${monthStart.getMonth() + 1}`,
        level: est ? est.level : null,
        provisional: est ? est.provisional : false,
        isCurrent: i === 0,
      });
    }

    return { current, months };
  }, [attempts]);

  const classificationStats = useMemo(() => {
    const examClassMap = new Map<string, string>(exams.map(e => [e.id, e.classification || 'Chưa phân loại']));
    const groups: { [label: string]: { sum: number; count: number } } = {};
    attempts.forEach(att => {
      let label: string;
      if (att.examCode === 'RANDOM') label = 'Tự luyện AI';
      else if (att.examCode === 'SRS') label = 'Ôn tập SRS';
      else label = examClassMap.get(att.examId) || 'Đề khác / đã xóa';

      if (!groups[label]) groups[label] = { sum: 0, count: 0 };
      groups[label].sum += att.score;
      groups[label].count++;
    });
    return Object.entries(groups)
      .map(([label, v]) => ({ label, avg: v.sum / v.count, count: v.count }))
      .sort((a, b) => b.count - a.count);
  }, [exams, attempts]);

  const { streakDays, nextMilestone, attemptsToMilestone } = useMemo(() => {
    const dateSet = new Set(attempts.map(a => new Date(a.createdAt).toDateString()));
    let streak = 0;
    const cursor = new Date();
    if (!dateSet.has(cursor.toDateString())) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (dateSet.has(cursor.toDateString())) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    const next = MILESTONES.find(m => m > totalCompletedCount) ?? null;
    return { streakDays: streak, nextMilestone: next, attemptsToMilestone: next ? next - totalCompletedCount : 0 };
  }, [attempts, totalCompletedCount]);

  const srsDueCount = useMemo(() => {
    const now = new Date();
    return srsItems.filter(i => i.status === 'pending' && new Date(i.nextReviewDate) <= now).length;
  }, [srsItems]);
  const srsPendingCount = useMemo(() => srsItems.filter(i => i.status === 'pending').length, [srsItems]);

  const nudgeText = useMemo(() => {
    if (!currentUser || currentUser.role !== 'student' || !currentUser.grade) return null;
    const gradeNum = parseInt(currentUser.grade, 10);
    if (isNaN(gradeNum)) return null;
    const officialExams = exams.filter(e => e.grade === gradeNum && e.classification === 'Đề thi chính thức các năm');
    if (officialExams.length === 0) return null;
    const attemptedExamIds = new Set(attempts.map(a => a.examId));
    const remaining = officialExams.filter(e => !attemptedExamIds.has(e.id));
    if (remaining.length === 0) return null;
    return `Bạn còn ${remaining.length}/${officialExams.length} đề thi chính thức Lớp ${currentUser.grade} chưa luyện.`;
  }, [currentUser, exams, attempts]);

  const isGuestSession = !currentUser || currentUser.role === 'guest';
  const isExpiredNonAdmin = !!currentUser && currentUser.role !== 'admin' && new Date().getTime() > new Date(currentUser.expiresAt).getTime();
  const isAdminViewer = currentUser?.role === 'admin';

  const sortedWeakGrammar = weakAreas.weakGrammar;
  const sortedWeakVocab = weakAreas.weakVocab;

  const sortedLeaderboard = useMemo(() => {
    return [...leaderboard].sort((a, b) => {
      if (sortBy === 'attemptsCount') {
        if (b.attemptsCount !== a.attemptsCount) {
          return b.attemptsCount - a.attemptsCount;
        }
        return (b.monthAvg || 0) - (a.monthAvg || 0);
      } else if (sortBy === 'totalTime') {
        return b.totalTime - a.totalTime;
      } else if (sortBy === 'latestScore') {
        return (b.latestScore || 0) - (a.latestScore || 0);
      } else if (sortBy === 'monthAvg') {
        return (b.monthAvg || 0) - (a.monthAvg || 0);
      }
      return 0;
    }).slice(0, 10);
  }, [leaderboard, sortBy]);

  if (loading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <>
    <div className="pb-10 anim-fade-slide-up max-w-7xl mx-auto px-4 sm:px-6">

      {/* Alert banners */}
      {(isExpiredNonAdmin || isGuestSession || nudgeText) && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-800 mb-5">
          {isExpiredNonAdmin && (
            <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 text-red-800 dark:text-red-400">
              <AlertTriangle size={14} className="shrink-0" />
              Gói học tập đã hết hạn. Giới hạn 3 đề/ngày.
            </span>
          )}
          {isGuestSession && (
            <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 text-amber-800 dark:text-amber-400">
              <Lock size={14} className="shrink-0" />
              Chế độ Khách giới hạn 1 đề/ngày. Đăng ký miễn phí!
            </span>
          )}
          {nudgeText && (
            <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-xl bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/30 text-indigo-800 dark:text-indigo-400">
              <Sparkles size={14} className="shrink-0" />
              {nudgeText}
            </span>
          )}
        </div>
      )}

      {/* ===== HÀNG 1: Profile mở rộng (3 cột) + Diamond (1 cột) ===== */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-5">
        {/* Profile Card - chiếm 3 cột */}
        <div className="md:col-span-3 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700/50 p-6 rounded-2xl text-white relative overflow-hidden shadow-lg">
          <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/15 rounded-full blur-3xl -z-0" />
          <div className="absolute left-1/3 bottom-0 w-40 h-40 bg-violet-500/10 rounded-full blur-2xl -z-0" />
          
          <div className="relative z-10">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex-1 min-w-[200px]">
                <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-extrabold px-3 py-1 rounded-full uppercase tracking-wider inline-block border border-indigo-500/20">
                  Hệ thống luyện thi 3 cấp độ
                </span>
                <h2 className="text-xl sm:text-2xl font-bold font-display tracking-tight leading-snug mt-2">
                  Thử thách hôm nay, <span className="text-indigo-400 font-black">{currentUser ? currentUser.name : 'Học viên Guest'}</span>! ⚡
                </h2>
                <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5 bg-slate-800/50 px-2.5 py-1 rounded-lg">
                    <Award size={14} className="text-indigo-400" />
                    <span className="text-white">{currentUser?.role || 'Khách'}</span>
                  </span>
                  <span className="flex items-center gap-1.5 bg-slate-800/50 px-2.5 py-1 rounded-lg">
                    <Clock size={14} className="text-indigo-400" />
                    <span className="text-indigo-300 font-bold">
                      {currentUser?.expiresAt ? new Date(currentUser.expiresAt).toLocaleDateString() : 'Không giới hạn'}
                    </span>
                  </span>
                </div>
              </div>

              {/* 3 thông số nổi bật */}
              <div className="flex gap-3 bg-slate-800/50 rounded-2xl p-2 border border-slate-700/50">
                <div className="text-center px-3 py-1.5 bg-slate-900/50 rounded-xl min-w-[70px]">
                  <p className="text-[9px] text-slate-400 uppercase tracking-wider">🔥 Chuỗi ngày</p>
                  <p className="text-lg font-bold text-amber-400">{streakDays}</p>
                </div>
                <div className="text-center px-3 py-1.5 bg-slate-900/50 rounded-xl min-w-[70px]">
                  <p className="text-[9px] text-slate-400 uppercase tracking-wider">📝 Đã làm</p>
                  <p className="text-lg font-bold text-indigo-400">{totalCompletedCount}</p>
                </div>
                <div className="text-center px-3 py-1.5 bg-slate-900/50 rounded-xl min-w-[70px]">
                  <p className="text-[9px] text-slate-400 uppercase tracking-wider">⭐ Điểm TB</p>
                  <p className="text-lg font-bold text-emerald-400">
                    {totalCompletedCount > 0 ? (averageCorrectionRate / 10).toFixed(1) : '0.0'}
                  </p>
                </div>
              </div>
            </div>

            {/* SRS nudge nhỏ */}
            <div className="mt-3 flex items-center gap-3 text-xs bg-slate-800/30 rounded-xl px-3 py-1.5 border border-slate-700/30">
              <RefreshCw size={14} className="text-emerald-400" />
              <span className="text-slate-300">Có <b className="text-emerald-400">{srsDueCount}</b> câu SRS đến hạn ôn tập</span>
              <button
                onClick={onGoToSrsReview}
                disabled={!onGoToSrsReview}
                className="ml-auto bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-bold px-3 py-1 rounded-lg text-[10px] transition-all active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Ôn ngay →
              </button>
            </div>
          </div>
        </div>

        {/* Diamond Card - chiếm 1 cột */}
        {currentUser?.role === 'student' ? (
          <div className="md:col-span-1 bg-gradient-to-br from-cyan-500 via-indigo-600 to-indigo-700 p-5 rounded-2xl text-white shadow-lg flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="p-2 bg-white/20 rounded-xl">
                  <Gem size={18} />
                </span>
                <span className="text-[9px] font-bold font-mono text-cyan-100/80 uppercase">Kim cương</span>
              </div>
              <p className="text-cyan-100/70 text-[10px] font-bold uppercase tracking-wider mt-2">Số dư của bạn</p>
              <p className="text-3xl font-extrabold font-display mt-0.5">{currentUser.diamonds || 0} 💎</p>
            </div>
            <button
              onClick={() => setShowRedeemModal(true)}
              className="mt-3 w-full bg-white/20 hover:bg-white/30 text-white font-bold py-2 rounded-xl text-xs transition-all active:scale-95 cursor-pointer border border-white/20"
            >
              Đổi thưởng 🎁
            </button>
          </div>
        ) : (
          <div className="md:col-span-1 bg-gradient-to-br from-indigo-500 to-purple-600 p-5 rounded-2xl text-white shadow-lg flex flex-col justify-center items-center text-center">
            <Gem size={28} className="text-white/60 mb-2" />
            <p className="text-xs font-bold">Đăng ký tài khoản</p>
            <p className="text-[10px] text-white/70">để nhận kim cương</p>
          </div>
        )}
      </div>

      {/* ===== HÀNG 2: Ngân hàng đề (gộp) + Phân bổ CEFR (mở rộng) ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        {/* Tổng đề thi + Câu hỏi tích lũy (gộp làm 1 ô) */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm p-5 bg-gradient-to-br from-indigo-50 to-indigo-100/50 dark:from-indigo-950/30 dark:to-indigo-900/20">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3">
              <span className="p-2.5 bg-indigo-100 dark:bg-indigo-900/40 rounded-xl text-indigo-600 dark:text-indigo-400">
                <BookOpen size={20} />
              </span>
              <div>
                <p className="text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-wider">Tổng đề thi</p>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white">{totalExamsCount}</p>
              </div>
            </div>
            <div className="w-px h-9 bg-slate-200 dark:bg-slate-700 hidden sm:block" />
            <div className="flex items-center gap-3">
              <span className="p-2.5 bg-emerald-100 dark:bg-emerald-900/40 rounded-xl text-emerald-600 dark:text-emerald-400">
                <BarChart size={20} />
              </span>
              <div>
                <p className="text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-wider">Câu hỏi tích lũy</p>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white">{totalQuestionsCount}</p>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-indigo-100/60 dark:border-indigo-900/30">
            <p className="text-slate-400 dark:text-slate-500 text-[9px] font-bold uppercase tracking-wider mb-2">Số đề theo lớp</p>
            <div className="flex items-end justify-around gap-3">
              {[6, 10, 12].map(g => {
                const val = examsByGrade[g] || 0;
                const maxVal = Math.max(examsByGrade[6] || 0, examsByGrade[10] || 0, examsByGrade[12] || 0, 1);
                const heightPct = Math.max(Math.round((val / maxVal) * 100), 4);
                return (
                  <div key={g} className="flex flex-col items-center gap-1.5">
                    <span className="text-xs font-extrabold text-slate-700 dark:text-slate-300">{val}</span>
                    <div className="w-9 h-12 bg-slate-200/50 dark:bg-slate-700/40 rounded-t-lg flex items-end overflow-hidden">
                      <div
                        className="w-full bg-gradient-to-t from-indigo-600 to-indigo-400 rounded-t-lg transition-all"
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Lớp {g}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Phân bổ CEFR - mở rộng, chiếm 2/3 chiều rộng */}
        <div className="sm:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm p-5 bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/20 flex flex-col">
          <div className="flex items-center gap-3 mb-3">
            <span className="p-2.5 bg-purple-100 dark:bg-purple-900/40 rounded-xl text-purple-600 dark:text-purple-400">
              <Layers size={20} />
            </span>
            <p className="text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-wider">Phân bổ độ khó CEFR</p>
          </div>
          {/* Biểu đồ cột dọc: chiều cao cột tự giãn theo chiều cao thực của ô (flex-1) */}
          <div className="flex-1 grid grid-cols-6 gap-1.5 sm:gap-3 min-h-[140px]">
            {Object.entries(difficultyStats).map(([lvl, val]) => {
              const total = Object.values(difficultyStats).reduce((a, b) => a + b, 0);
              const pct = total > 0 ? Math.round((val / total) * 100) : 0;
              const maxVal = Math.max(...Object.values(difficultyStats), 1);
              const heightPct = Math.max(Math.round((val / maxVal) * 100), 3);
              return (
                <div key={lvl} className="h-full flex flex-col items-center gap-1.5">
                  <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400">{pct}%</span>
                  <div className="w-full flex-1 flex items-end bg-slate-100/70 dark:bg-slate-800/40 rounded-t-lg overflow-hidden">
                    <div
                      className="w-full bg-gradient-to-t from-indigo-600 to-purple-500 rounded-t-lg transition-all"
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                  <div className="text-center leading-tight">
                    <p className="font-mono text-sm font-bold text-slate-700 dark:text-slate-300">{lvl}</p>
                    <p className="text-[9px] text-slate-400 dark:text-slate-500">{val}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ===== HÀNG 3: CEFR + Weak Areas (2 cột + 2 cột) ===== */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        {/* CEFR Progress - 2 cột */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm p-5">
          <h4 className="font-bold flex items-center gap-2 text-sm text-slate-900 dark:text-white">
            <TrendingUp size={18} className="text-indigo-600" />
            Trình độ CEFR ước tính
          </h4>
          <p className="text-slate-400 dark:text-slate-500 text-[10px] font-semibold mt-0.5 mb-3">
            Đạt chuẩn khi đúng ≥{Math.round(CEFR_PASS_ACCURACY * 100)}% trên {CEFR_MIN_QUESTIONS_SOLID} câu
          </p>

          {cefrEstimate ? (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md">
                  <span className="text-2xl font-display font-extrabold tracking-tight">
                    {cefrEstimate.current.level ?? '—'}
                  </span>
                </div>
                <div>
                  <p className="text-slate-900 dark:text-white text-sm font-bold">
                    {cefrEstimate.current.level
                      ? <>Hiện tại: {cefrEstimate.current.level}{cefrEstimate.current.provisional && <span className="text-amber-600 dark:text-amber-400 font-bold">*</span>}</>
                      : 'Chưa đạt chuẩn cấp độ nào'}
                  </p>
                  <p className="text-slate-400 dark:text-slate-500 text-[10px] font-semibold">
                    {cefrEstimate.current.nextLevel
                      ? (cefrEstimate.current.nextTotal > 0
                        ? <>Mục tiêu: <b className="text-indigo-600 dark:text-indigo-400">{cefrEstimate.current.nextLevel}</b> — đúng {Math.round((cefrEstimate.current.nextAccuracy ?? 0) * 100)}%</>
                        : <>Mục tiêu: <b className="text-indigo-600 dark:text-indigo-400">{cefrEstimate.current.nextLevel}</b> — luyện thêm</>)
                      : '🏆 Đã ở cấp độ cao nhất'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                {cefrEstimate.months.map((m, idx) => (
                  <div key={idx} className="flex-1 text-center">
                    <div className={`text-[10px] font-mono font-extrabold py-1 rounded-lg border ${
                      m.level
                        ? m.isCurrent
                          ? 'bg-indigo-600 text-white border-indigo-700'
                          : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-100 dark:border-indigo-900/40'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-300 dark:text-slate-600 border-slate-100 dark:border-slate-700'
                    }`}>
                      {m.level ?? '·'}{m.level && m.provisional ? '*' : ''}
                    </div>
                    <span className="text-[8px] text-slate-400 dark:text-slate-500 font-bold">{m.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-slate-400 dark:text-slate-500 text-xs font-semibold">Chưa đủ dữ liệu</p>
          )}
        </div>

        {/* Weak Areas - 2 cột */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
              <Target size={18} className="text-indigo-600" />
              Điểm yếu cần cải thiện
            </h4>
            {attempts.length > 0 && (
              <span className="text-slate-400 dark:text-slate-500 text-[10px] font-semibold">
                {weakAreas.isRateBased ? '📊 Theo tỷ lệ' : '📋 Theo tần suất'}
              </span>
            )}
          </div>

          {attempts.length === 0 ? (
            <p className="text-slate-400 dark:text-slate-500 text-xs font-semibold">Chưa có dữ liệu</p>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-slate-400 dark:text-slate-500 text-[9px] font-extrabold uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> Ngữ pháp
                </p>
                {sortedWeakGrammar.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {sortedWeakGrammar.map((g, idx) => (
                      <button
                        key={idx}
                        onClick={() => onSelectWeakArea && onSelectWeakArea('grammar', g)}
                        className="bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 text-[11px] px-3 py-1 rounded-lg border border-rose-200 dark:border-rose-900/40 hover:bg-rose-100 transition-all font-bold cursor-pointer active:scale-95"
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold">✅ Hoàn hảo!</p>
                )}
              </div>

              <div>
                <p className="text-slate-400 dark:text-slate-500 text-[9px] font-extrabold uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Từ vựng
                </p>
                {sortedWeakVocab.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {sortedWeakVocab.map((v, idx) => (
                      <button
                        key={idx}
                        onClick={() => onSelectWeakArea && onSelectWeakArea('vocab', v)}
                        className="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-[11px] px-3 py-1 rounded-lg border border-amber-200 dark:border-amber-900/40 hover:bg-amber-100 transition-all font-bold cursor-pointer active:scale-95"
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold">✅ Vững chắc!</p>
                )}
              </div>

              {(sortedWeakGrammar.length > 0 || sortedWeakVocab.length > 0) && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold pt-1 border-t border-slate-100 dark:border-slate-800">
                  💡 Nhấp vào từ khóa để luyện tập chuyên sâu
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ===== HÀNG 4: Trend + Classification (2 cột + 2 cột) ===== */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-slate-900 dark:text-white font-bold text-sm flex items-center gap-2">
              <TrendingUp size={18} className="text-indigo-600" />
              Xu hướng điểm số
            </h4>
            <span className="text-slate-400 dark:text-slate-500 text-[10px] font-semibold">
              {trendPoints.length} lượt
            </span>
          </div>
          {trendPoints.length > 0 ? (
            <ScoreTrendChart points={trendPoints} />
          ) : (
            <p className="text-slate-400 dark:text-slate-500 text-xs font-semibold text-center py-6">
              Chưa có dữ liệu
            </p>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm p-5">
          <h4 className="text-slate-900 dark:text-white font-bold text-sm flex items-center gap-2 mb-3">
            <Layers size={18} className="text-indigo-600" />
            Điểm theo loại đề
          </h4>
          {classificationStats.length === 0 ? (
            <p className="text-slate-400 dark:text-slate-500 text-xs font-semibold">Chưa có dữ liệu</p>
          ) : (
            <div className="space-y-2">
              {classificationStats.map(stat => (
                <div key={stat.label} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <span className="text-slate-600 dark:text-slate-400 font-semibold truncate max-w-[60%]" title={stat.label}>
                    {stat.label} <span className="text-slate-400 dark:text-slate-500 font-normal">({stat.count})</span>
                  </span>
                  <span className={`font-mono font-extrabold ${stat.avg >= 8 ? 'text-emerald-600' : stat.avg >= 5 ? 'text-amber-600' : 'text-rose-600'}`}>
                    {stat.avg.toFixed(1)} / 10
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ===== HÀNG 5: Bảng vàng danh dự (4 cột) ===== */}
      <div className="mb-5">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200/60 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Trophy size={18} className="text-amber-500 fill-amber-100" />
              <div>
                <h4 className="text-slate-900 dark:text-white font-bold font-display tracking-tight text-sm">
                  Bảng Vàng Học Sinh Danh Dự (Top 10)
                </h4>
                <p className="text-slate-400 dark:text-slate-500 text-[10px] font-semibold">
                  Nhấn vào tiêu đề cột để sắp xếp! {!isAdminViewer && 'Danh tính ngoài Top 3 được ẩn.'}
                </p>
              </div>
            </div>
            <div className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1 rounded-full">
              Tháng {new Date().getMonth() + 1}/{new Date().getFullYear()}
            </div>
          </div>

          {sortedLeaderboard.length === 0 ? (
            <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-xs font-semibold">
              Chưa có dữ liệu
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/60 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-[10px] font-bold border-b border-slate-200/60 dark:border-slate-800 uppercase tracking-wider">
                    <th className="px-4 py-2.5 text-center w-12">#</th>
                    <th className="px-4 py-2.5">Học sinh</th>
                    <th onClick={() => setSortBy('attemptsCount')} className={`px-4 py-2.5 text-center cursor-pointer select-none transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 ${sortBy === 'attemptsCount' ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 font-extrabold' : ''}`}>
                      Số đề {sortBy === 'attemptsCount' ? '▼' : '◇'}
                    </th>
                    <th onClick={() => setSortBy('totalTime')} className={`px-4 py-2.5 text-center cursor-pointer select-none transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 ${sortBy === 'totalTime' ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 font-extrabold' : ''}`}>
                      Thời gian {sortBy === 'totalTime' ? '▼' : '◇'}
                    </th>
                    <th onClick={() => setSortBy('latestScore')} className={`px-4 py-2.5 text-center cursor-pointer select-none transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 ${sortBy === 'latestScore' ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 font-extrabold' : ''}`}>
                      Điểm gần nhất {sortBy === 'latestScore' ? '▼' : '◇'}
                    </th>
                    <th onClick={() => setSortBy('monthAvg')} className={`px-4 py-2.5 text-center cursor-pointer select-none transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 ${sortBy === 'monthAvg' ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 font-extrabold' : ''}`}>
                      Điểm TB tháng {sortBy === 'monthAvg' ? '▼' : '◇'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  {sortedLeaderboard.map((item, index) => {
                    const isTopThree = index < 3;
                    const isSelf = !!currentUser && currentUser.id === item.id;
                    const revealIdentity = isAdminViewer || isTopThree || isSelf;
                    const trophyMap = ['🥇', '🥈', '🥉'];
                    const initials = revealIdentity
                      ? item.name.split(' ').map(w => w[0]).slice(-2).join('').toUpperCase()
                      : '?';
                    const avatarGrad = isTopThree 
                      ? ['from-amber-400 to-orange-500', 'from-slate-400 to-slate-600', 'from-orange-400 to-red-500'][index]
                      : 'from-indigo-500 to-violet-600';

                    return (
                      <tr key={item.id} className={`hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors ${isSelf ? 'bg-indigo-50/30 dark:bg-indigo-950/10' : ''}`}>
                        <td className="px-4 py-2.5 text-center">
                          {isTopThree ? (
                            <span className="text-lg">{trophyMap[index]}</span>
                          ) : (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold font-mono text-[10px]">
                              {index + 1}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-7 h-7 bg-gradient-to-br ${avatarGrad} rounded-full flex items-center justify-center text-white text-[9px] font-extrabold shrink-0 shadow-sm`}>
                              {initials}
                            </div>
                            <div>
                              <span className="font-extrabold text-slate-900 dark:text-white text-sm">
                                {revealIdentity ? item.name : 'Học sinh ẩn danh'}{isSelf && !isAdminViewer ? ' (Bạn)' : ''}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">@{revealIdentity ? item.username : '••••••'}</span>
                                <span className="px-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-[9px] font-bold text-slate-500 dark:text-slate-400">
                                  Lớp {item.grade}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center font-mono font-extrabold">{item.attemptsCount}</td>
                        <td className="px-4 py-2.5 text-center font-mono font-semibold text-slate-600 dark:text-slate-400">
                          {(item.totalTime / 60).toFixed(1)}p
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {item.latestScore !== null ? (
                            <span className="px-2 py-0.5 rounded font-mono font-bold bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300">
                              {item.latestScore.toFixed(1)}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {item.monthAvg !== null ? (
                            <span className="px-2 py-0.5 rounded font-mono font-bold bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400">
                              {item.monthAvg.toFixed(1)}
                            </span>
                          ) : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ===== HÀNG 6: Lịch sử luyện đề (4 cột) ===== */}
      <div className="mb-5">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200/60 dark:border-slate-800 flex items-center gap-2 bg-slate-50/50 dark:bg-slate-800/30">
            <History size={18} className="text-indigo-600" />
            <h4 className="text-slate-900 dark:text-white font-bold font-display tracking-tight text-sm">
              Lịch sử luyện thi của {currentUser ? currentUser.name : 'Tài khoản Guest'}
            </h4>
          </div>

          {attempts.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs font-medium">
              Bạn chưa thực hiện bài luyện đề nào.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/60 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-[10px] font-bold border-b border-slate-200/60 dark:border-slate-800 uppercase tracking-wider">
                      <th className="px-4 py-2.5">Tên đề thi</th>
                      <th className="px-4 py-2.5">Thời gian</th>
                      <th className="px-4 py-2.5">Thời lượng</th>
                      <th className="px-4 py-2.5 text-center">Đúng/Tổng</th>
                      <th className="px-4 py-2.5 text-center">Điểm</th>
                      <th className="px-4 py-2.5 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                    {(() => {
                      const sortedAttempts = [...attempts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                      const itemsPerPage = 10;
                      const paginated = sortedAttempts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
                      return paginated.map(att => (
                        <tr key={att.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="px-4 py-2.5 font-bold text-slate-900 dark:text-white max-w-xs truncate" title={att.examTitle}>
                            {att.examTitle}
                            {att.examCode && <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono ml-1">({att.examCode})</span>}
                          </td>
                          <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">
                            {new Date(att.createdAt).toLocaleDateString('vi-VN')}
                          </td>
                          <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400 font-semibold">
                            {(att.timeSpent / 60).toFixed(1)}p
                          </td>
                          <td className="px-4 py-2.5 text-center font-mono font-extrabold">
                            {att.correctCount}/{att.totalCount}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                              att.score >= 8 ? 'bg-green-50 text-green-700 border border-green-200' :
                              att.score >= 5 ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                              'bg-red-50 text-red-700 border border-red-200'
                            }`}>
                              {att.score.toFixed(1)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => onRetakeExam(att.examId, att.answers)}
                              className="inline-flex items-center gap-1 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/30 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold px-2.5 py-1 rounded-lg active:scale-95 transition-all cursor-pointer"
                            >
                              <Award size={12} /> Xem
                            </button>
                            <button
                              onClick={() => onRetakeExam(att.examId)}
                              className="inline-flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 text-slate-700 dark:text-slate-300 text-[10px] font-bold px-2.5 py-1 rounded-lg active:scale-95 transition-all cursor-pointer"
                            >
                              <RotateCcw size={12} /> Làm lại
                            </button>
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>

              {(() => {
                const itemsPerPage = 10;
                const totalPages = Math.ceil(attempts.length / itemsPerPage);
                if (totalPages <= 1) return null;
                return (
                  <div className="p-3 border-t border-slate-200/60 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2 bg-slate-50/50 dark:bg-slate-800/20 text-xs text-slate-600 dark:text-slate-400 font-semibold">
                    <div>
                      {Math.min(attempts.length, (currentPage - 1) * itemsPerPage + 1)}-{Math.min(attempts.length, currentPage * itemsPerPage)} / {attempts.length}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 disabled:opacity-50 disabled:pointer-events-none transition-colors cursor-pointer select-none font-bold"
                      >
                        Trước
                      </button>
                      {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                        let page = i + 1;
                        if (totalPages > 5) {
                          if (currentPage > 3) {
                            page = currentPage - 2 + i;
                            if (page > totalPages) page = totalPages - 4 + i;
                          }
                        }
                        if (page < 1 || page > totalPages) return null;
                        return (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className={`px-2.5 py-1 rounded-lg border transition-all cursor-pointer select-none text-xs font-bold ${
                              currentPage === page
                                ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50'
                            }`}
                          >
                            {page}
                          </button>
                        );
                      })}
                      <button
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 disabled:opacity-50 disabled:pointer-events-none transition-colors cursor-pointer select-none font-bold"
                      >
                        Sau
                      </button>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>

    </div>

    {showRedeemModal && currentUser && (
      <DiamondRedeemModal
        currentUser={currentUser}
        onClose={() => setShowRedeemModal(false)}
        onUserUpdate={patch => onUserUpdate?.(patch)}
        onShowModal={onShowModal}
      />
    )}
    </>
  );
}