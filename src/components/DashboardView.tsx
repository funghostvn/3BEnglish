import React, { useEffect, useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { Exam, Attempt, User, SRSItem, CategoryPerf, VOCABULARY_THEMES, GRAMMAR_THEMES } from '../types';
import { fetchCollection } from '../services/firestore';
import ScoreTrendChart from './ScoreTrendChart';
import {
  BarChart, BookOpen, Clock, Award, History, RotateCcw, TrendingUp, Trophy,
  RefreshCw, Flame, Target, Layers, AlertTriangle, Lock, Sparkles
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
}

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const MILESTONES = [5, 10, 25, 50, 100, 200];

// Aggregate correct/wrong CategoryPerf maps across attempts into one map.
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
}: DashboardViewProps) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [srsItems, setSrsItems] = useState<SRSItem[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
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
      // Grade filter only narrows a student's own attempt history below; the
      // system-wide exam/question stats intentionally always cover all grades.
      let effectiveGradeFilter = currentGradeFilter;
      if (currentUser && currentUser.role === 'student' && currentUser.grade) {
        effectiveGradeFilter = currentUser.grade;
      }
      const parsedGradeFilter = effectiveGradeFilter === 'all' ? null : parseInt(effectiveGradeFilter, 10);
      const hasValidGradeFilter = parsedGradeFilter !== null && !isNaN(parsedGradeFilter);

      // 1. Fetch Exams (always all exams: global stats span all 3 grades)
      const examList = await fetchCollection<Exam>('exams');
      setExams(examList);

      // 2. Fetch all attempts. The leaderboard aggregates every student, so the
      // full set is needed here. (A denormalized per-user aggregate would let
      // this be O(students) instead of O(all attempts), but that requires new
      // security rules on the AI Studio-managed database — see notes.)
      let allAttemptsList = await fetchCollection<Attempt>('attempts');

      // Filter out invalid attempts (too short: likely accidental/rage-quit submits)
      allAttemptsList = allAttemptsList.filter(att => (att.timeSpent || 0) >= 120);

      // Group attempts by userId
      const attemptsByUser: { [userId: string]: Attempt[] } = {};
      allAttemptsList.forEach(att => {
        if (!attemptsByUser[att.userId]) {
          attemptsByUser[att.userId] = [];
        }
        attemptsByUser[att.userId].push(att);
      });

      // Filter personal attempts for the logged-in user or guest
      const personalAttempts = allAttemptsList.filter(att => {
        if (currentUser?.role === 'admin') {
          return true;
        } else if (currentUser) {
          return att.userId === currentUser.id;
        } else {
          return att.userId === 'guest';
        }
      });

      // Client-side filtering of personal attempts by grade if selected.
      // If the grade filter can't be parsed to a number (e.g. an admin-only
      // 'admin' grade string slipping in here), treat it as "no filter"
      // instead of silently dropping every attempt via a NaN comparison.
      const filteredAttempts = personalAttempts.filter(att => {
        if (!hasValidGradeFilter) return true;
        return att.grade === parsedGradeFilter;
      });

      filteredAttempts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setAttempts(filteredAttempts);

      // 3. Fetch users (for the leaderboard) and 4. this user's own SRS queue,
      // in parallel.
      const [userList, srsList] = await Promise.all([
        fetchCollection<User>('users'),
        fetchCollection<SRSItem>('srs_items', where('userId', '==', currentUser?.id || 'guest')),
      ]);
      setSrsItems(srsList);

      // Compute statistics for non-admin users with >=1 attempts
      const now = new Date();
      const curYear = now.getFullYear();
      const curMonth = now.getMonth();

      const leaderboardData: LeaderboardEntry[] = userList
        .filter(u => u.role !== 'admin') // Exclude admin users
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
        .filter(item => item.attemptsCount > 0); // Only show active students

      setLeaderboard(leaderboardData);
    } catch (err) {
      console.error(err);
      onShowModal({ type: 'danger', title: 'Lỗi tải bảng điều khiển', message: 'Không thể tải dữ liệu thống kê. Vui lòng kiểm tra kết nối mạng và tải lại trang.' });
    } finally {
      setLoading(false);
    }
  };

  // Processing Stats — memoized so they only recompute when the underlying
  // data changes, not on every render (e.g. sortBy/currentPage clicks).
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

  // Highlight Stats for current user/guest
  const totalCompletedCount = attempts.length;
  const averageCorrectionRate = totalCompletedCount > 0
    ? Math.round((attempts.reduce((sum, att) => sum + att.score, 0) / totalCompletedCount) * 10)
    : 0;

  // Score trend: last 12 attempts, oldest -> newest (attempts is sorted newest-first).
  const trendPoints = useMemo(() => {
    return attempts.slice(0, 12).slice().reverse().map(att => ({
      label: new Date(att.createdAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
      score: att.score,
    }));
  }, [attempts]);

  // Weak-area diagnostics: prefer true wrong/total rate from grammarPerf/
  // vocabPerf (added later); fall back to legacy wrong-count frequency for
  // attempts recorded before that field existed.
  const weakAreas = useMemo(() => {
    const { agg: grammarAgg, hasData: hasGrammarPerf } = aggregatePerf(attempts, a => a.grammarPerf);
    const { agg: vocabAgg, hasData: hasVocabPerf } = aggregatePerf(attempts, a => a.vocabPerf);

    const rankByRate = (agg: { [k: string]: CategoryPerf }) => Object.entries(agg)
      .map(([key, v]) => ({ key, total: v.correct + v.wrong, wrong: v.wrong, rate: v.wrong / (v.correct + v.wrong) }))
      .filter(x => x.total >= 2) // ignore categories seen only once (too noisy to rank)
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

  // Personal CEFR performance (only available for attempts recorded after
  // difficultyPerf was added — older attempts don't contribute here).
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

  // Average score split by exam classification, so a student can tell their
  // performance on real official exams apart from AI-generated practice.
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

  // Streak (consecutive practice days) + next attempt-count milestone.
  const { streakDays, nextMilestone, attemptsToMilestone } = useMemo(() => {
    const dateSet = new Set(attempts.map(a => new Date(a.createdAt).toDateString()));
    let streak = 0;
    const cursor = new Date();
    if (!dateSet.has(cursor.toDateString())) {
      cursor.setDate(cursor.getDate() - 1); // no practice yet today: streak counts up to yesterday
    }
    while (dateSet.has(cursor.toDateString())) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    const next = MILESTONES.find(m => m > totalCompletedCount) ?? null;
    return { streakDays: streak, nextMilestone: next, attemptsToMilestone: next ? next - totalCompletedCount : 0 };
  }, [attempts, totalCompletedCount]);

  // SRS due-for-review count (for the current user's own review queue).
  const srsDueCount = useMemo(() => {
    const now = new Date();
    return srsItems.filter(i => i.status === 'pending' && new Date(i.nextReviewDate) <= now).length;
  }, [srsItems]);
  const srsPendingCount = useMemo(() => srsItems.filter(i => i.status === 'pending').length, [srsItems]);

  // Proactive nudge: how many official exams for the student's own grade are
  // still untouched.
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

  // Sort the active leaderboard based on selected field
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
    <div className="space-y-8 pb-12 animate-in fade-in duration-200">

      {/* Alert banners: expiry / guest limits / proactive nudge */}
      {(isExpiredNonAdmin || isGuestSession || nudgeText) && (
        <div className="space-y-3">
          {isExpiredNonAdmin && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-xs px-5 py-3 rounded-2xl flex items-center gap-2.5 font-semibold">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
              Gói học tập của bạn đã hết hạn. Hoạt động làm đề bị giới hạn tối đa 3 đề/ngày — hãy liên hệ giáo viên/admin để gia hạn.
            </div>
          )}
          {isGuestSession && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-5 py-3 rounded-2xl flex items-center gap-2.5 font-semibold">
              <Lock className="h-4 w-4 text-amber-500 shrink-0" />
              Bạn đang dùng chế độ Khách, giới hạn tối đa 1 đề/ngày. Đăng ký tài khoản miễn phí để luyện tập không giới hạn và lưu lại tiến trình học tập.
            </div>
          )}
          {nudgeText && (
            <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs px-5 py-3 rounded-2xl flex items-center gap-2.5 font-semibold">
              <Sparkles className="h-4 w-4 text-indigo-500 shrink-0" />
              {nudgeText}
            </div>
          )}
        </div>
      )}

      {/* Bento Grid Layout Area */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-6">

        {/* Tile 1: Profile Spotlight & Action Banner */}
        <div className="md:col-span-4 bg-slate-900 border border-slate-800 p-8 rounded-3xl text-white relative overflow-hidden flex flex-col justify-between min-h-[220px] shadow-sm">
          <div className="absolute right-0 top-0 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl -z-10" />
          <div className="absolute left-1/3 bottom-0 w-32 h-32 bg-purple-500/10 rounded-full blur-2xl -z-10" />
          <div>
            <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-extrabold px-3 py-1 rounded-full uppercase tracking-wider mb-4 inline-block">
              Hệ thống luyện thi trường học 3 cấp độ
            </span>
            <h2 className="text-2xl font-bold font-display tracking-tight leading-snug mt-1">
              Thử thách hôm nay, <span className="text-indigo-400 font-black">{currentUser ? currentUser.name : 'Học viên Guest'}</span>! ⚡
            </h2>
            <p className="text-slate-400 text-xs mt-2.5 max-w-lg leading-relaxed font-semibold">
              Đồng hành cùng bạn chinh phục đề thi Lớp 6 vào Chuyên, Lớp 10 THPT và kỳ thi Lớp 12 Tốt nghiệp THPT Quốc gia với kho dữ liệu cập nhật liên tục.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-400 font-bold font-mono mt-6 border-t border-slate-800/60 pt-4">
            <span>Vai trò: <span className="text-white bg-slate-800 px-2 py-0.5 rounded-md lowercase">{currentUser?.role || 'Khách'}</span></span>
            <span className="text-slate-700">•</span>
            <span>Hạn dùng: <span className="text-indigo-300 font-bold">{currentUser?.expiresAt ? new Date(currentUser.expiresAt).toLocaleDateString() : 'Không giới hạn'}</span></span>
          </div>
        </div>

        {/* Tile 2: Score Evaluation ring / card */}
        <div className="md:col-span-2 bg-white border border-slate-200/60 p-7 rounded-3xl flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="p-3 bg-amber-50 rounded-2xl text-amber-500">
              <Award className="h-5 w-5" />
            </span>
            <span className="bg-emerald-50 text-emerald-700 text-[10px] px-2.5 py-0.5 rounded-full font-bold">
              {totalCompletedCount === 0 ? "Chưa làm đề" : averageCorrectionRate >= 80 ? "Xuất sắc 🎉" : averageCorrectionRate >= 65 ? "Khá tốt 💪" : "Cần cố gắng"}
            </span>
          </div>
          <div>
            <p className="text-slate-400 text-[10px] font-extrabold uppercase tracking-wider">Điểm Trung Bình (Hệ 10)</p>
            <div className="flex items-baseline gap-1 mt-1">
              <h3 className="text-4xl font-extrabold font-display text-slate-900 tracking-tight">
                {totalCompletedCount > 0 ? (averageCorrectionRate / 10).toFixed(1) : "0.0"}
              </h3>
              <span className="text-slate-400 text-sm font-bold">/ 10</span>
            </div>
            <p className="text-slate-500 text-[11px] mt-2 font-medium leading-relaxed">
              Tỷ lệ chính xác trung bình là {averageCorrectionRate}% trên tất cả các nỗ lực luyện tập của bạn.
            </p>
          </div>
        </div>

        {/* Tile: Score trend chart */}
        <div className="md:col-span-4 bg-white border border-slate-200/60 p-6 rounded-3xl shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-slate-900 font-bold font-display tracking-tight text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-600" /> Xu hướng điểm số ({trendPoints.length} lượt gần nhất)
            </h4>
          </div>
          <ScoreTrendChart points={trendPoints} />
        </div>

        {/* Tile: SRS due-for-review */}
        <div className="md:col-span-2 bg-gradient-to-br from-emerald-900 to-slate-900 text-white p-6 rounded-3xl shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="p-2.5 bg-emerald-500/20 rounded-2xl text-emerald-300">
                <RefreshCw className="h-4 w-4" />
              </span>
              <span className="text-[10px] font-bold font-mono text-emerald-300/80 uppercase">SRS Review</span>
            </div>
            <p className="text-slate-300 text-[10px] font-extrabold uppercase tracking-wider">Câu hỏi đến hạn ôn tập</p>
            <h3 className="text-3xl font-extrabold font-display mt-1 tracking-tight">{srsDueCount}</h3>
            <p className="text-slate-400 text-[11px] mt-2 leading-relaxed">
              Tổng {srsPendingCount} câu đang chờ ôn theo chu kỳ Spaced Repetition.
            </p>
          </div>
          <button
            onClick={onGoToSrsReview}
            disabled={!onGoToSrsReview}
            className="mt-4 w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold py-2.5 rounded-xl text-xs transition-all active:scale-95 cursor-pointer"
          >
            Ôn ngay →
          </button>
        </div>

        {/* Tile 3: Exams Count Bento */}
        <div className="md:col-span-2 bg-white border border-slate-200/60 p-6 rounded-3xl flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <span className="p-3 bg-indigo-50 rounded-2xl text-indigo-600">
              <BookOpen className="h-5 w-5" />
            </span>
            <span className="text-[10px] font-bold font-mono text-slate-400">EXAMS SYSTEM</span>
          </div>
          <div>
            <p className="text-slate-400 text-[10px] font-extrabold uppercase tracking-wider">Tổng Đề Thi</p>
            <h3 className="text-3xl font-extrabold font-display text-slate-900 mt-1 tracking-tight">{totalExamsCount}</h3>
            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] font-mono text-slate-500 font-semibold">
              <span>Lớp 6: <b className="text-indigo-600 font-bold">{(examsByGrade[6] || 0)} đề</b></span>
              <span>Lớp 10: <b className="text-indigo-600 font-bold">{(examsByGrade[10] || 0)} đề</b></span>
              <span>Lớp 12: <b className="text-indigo-600 font-bold">{(examsByGrade[12] || 0)} đề</b></span>
            </div>
          </div>
        </div>

        {/* Tile 4: Total Questions Bento */}
        <div className="md:col-span-2 bg-white border border-slate-200/60 p-6 rounded-3xl flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <span className="p-3 bg-green-50 rounded-2xl text-green-600">
              <BarChart className="h-5 w-5" />
            </span>
            <span className="text-[10px] font-bold font-mono text-slate-400">QUESTIONS</span>
          </div>
          <div>
            <p className="text-slate-400 text-[10px] font-extrabold uppercase tracking-wider">Số Câu Hỏi Tích Lũy</p>
            <h3 className="text-3xl font-extrabold font-display text-slate-900 mt-1 tracking-tight">{totalQuestionsCount}</h3>
            <p className="text-slate-500 text-[11px] mt-4 font-semibold leading-relaxed">
              Ngữ pháp, Đọc hiểu và Từ vựng phân loại theo quy chuẩn khảo thí.
            </p>
          </div>
        </div>

        {/* Tile 5: Attempts Count Bento */}
        <div className="md:col-span-2 bg-white border border-slate-200/60 p-6 rounded-3xl flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <span className="p-3 bg-purple-50 rounded-2xl text-purple-600">
              <Clock className="h-5 w-5" />
            </span>
            <span className="text-[10px] font-bold font-mono text-slate-400">HISTORY ACTIVITY</span>
          </div>
          <div>
            <p className="text-slate-400 text-[10px] font-extrabold uppercase tracking-wider">Lượt Luyện Đề</p>
            <h3 className="text-3xl font-extrabold font-display text-slate-900 mt-1 tracking-tight">{totalCompletedCount}</h3>
            <p className="text-slate-500 text-[10px] mt-4 font-bold truncate">
              {attempts.length > 0 ? (
                <span>Gần đây: <b className="text-indigo-600">{attempts[0].examTitle}</b></span>
              ) : (
                "Chưa tham gia đề thi nào"
              )}
            </p>
          </div>
        </div>

        {/* Tile: Streak + milestone */}
        <div className="md:col-span-3 bg-white p-6 rounded-3xl border border-slate-200/60 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <span className="p-3 bg-orange-50 rounded-2xl text-orange-500">
              <Flame className="h-5 w-5" />
            </span>
            <span className="text-[10px] font-bold font-mono text-slate-400">STREAK & MILESTONE</span>
          </div>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-slate-400 text-[10px] font-extrabold uppercase tracking-wider">Chuỗi ngày luyện tập</p>
              <h3 className="text-3xl font-extrabold font-display text-slate-900 mt-1 tracking-tight">
                {streakDays} <span className="text-sm text-slate-400 font-bold">ngày</span>
              </h3>
            </div>
            <div className="text-right">
              <p className="text-slate-400 text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1 justify-end">
                <Target className="h-3 w-3" /> Mốc kế tiếp
              </p>
              <p className="text-sm font-bold text-indigo-600 mt-1">
                {nextMilestone ? `Còn ${attemptsToMilestone} đề đến mốc ${nextMilestone}` : 'Đã đạt mốc cao nhất 🏆'}
              </p>
            </div>
          </div>
        </div>

        {/* Tile: Score split by exam classification */}
        <div className="md:col-span-3 bg-white p-6 rounded-3xl border border-slate-200/60 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-slate-900 font-bold font-display tracking-tight text-sm flex items-center gap-2">
              <Layers className="h-4 w-4 text-indigo-600" /> Điểm theo loại đề
            </h4>
          </div>
          {classificationStats.length === 0 ? (
            <p className="text-slate-400 text-xs font-semibold">Chưa có dữ liệu để so sánh theo loại đề.</p>
          ) : (
            <div className="space-y-2.5">
              {classificationStats.map(stat => (
                <div key={stat.label} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 font-semibold truncate max-w-[55%]" title={stat.label}>{stat.label} <span className="text-slate-400 font-normal">({stat.count})</span></span>
                  <span className={`font-mono font-extrabold ${stat.avg >= 8 ? 'text-emerald-600' : stat.avg >= 5 ? 'text-amber-600' : 'text-rose-600'}`}>
                    {stat.avg.toFixed(1)} / 10
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tile 6: Diagnostics assessment (rate-based when data available) */}
        <div className="md:col-span-3 bg-white p-7 rounded-3xl border border-slate-200/60 shadow-xs flex flex-col justify-between min-h-[290px]">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="bg-indigo-50 text-indigo-700 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider">ĐÁNH GIÁ QUÁ TRÌNH</span>
              {attempts.length > 0 && (
                <span className="text-slate-400 text-[10px] font-semibold">Gần nhất: {new Date(attempts[0].createdAt).toLocaleDateString()}</span>
              )}
            </div>
            <h3 className="text-lg font-bold font-display tracking-tight text-slate-950 mb-1">Chủ điểm cần cải thiện 📈</h3>
            <p className="text-slate-400 text-[10px] font-semibold mb-1">
              {weakAreas.isRateBased ? 'Xếp hạng theo tỷ lệ sai/tổng số câu đã gặp.' : 'Xếp hạng theo tần suất sai (chưa đủ dữ liệu tỷ lệ).'}
            </p>

            {attempts.length === 0 ? (
              <p className="text-slate-400 text-xs mt-6 leading-relaxed font-semibold">
                Bảng chuẩn đoán điểm yếu sẽ hiển thị ngay khi bạn thực hiện tối thiểu một lượt làm đề luyện tập.
              </p>
            ) : (
              <div className="space-y-4 mt-4">
                {sortedWeakGrammar.length > 0 ? (
                  <div>
                    <h5 className="text-slate-400 text-[9px] font-extrabold uppercase tracking-wider mb-2">Hổng Ngữ Pháp (Nhấn để luyện tập):</h5>
                    <div className="flex flex-wrap gap-1.5">
                      {sortedWeakGrammar.map((g, idx) => (
                        <button
                          key={idx}
                          onClick={() => onSelectWeakArea && onSelectWeakArea('grammar', g)}
                          title="Nhấp để ôn luyện chuyên sâu"
                          className="bg-rose-50 text-rose-700 text-[11px] px-2.5 py-1 rounded-lg border border-rose-200 hover:bg-rose-100 hover:border-rose-300 transition-all font-bold whitespace-nowrap cursor-pointer active:scale-95 text-left"
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div>
                    <h5 className="text-slate-400 text-[9px] font-extrabold uppercase tracking-wider mb-1">Hổng Ngữ Pháp:</h5>
                    <p className="text-slate-500 text-xs font-semibold">Kỹ năng ngữ pháp hoàn hảo! 👏</p>
                  </div>
                )}

                {sortedWeakVocab.length > 0 ? (
                  <div className="pt-1">
                    <h5 className="text-slate-400 text-[9px] font-extrabold uppercase tracking-wider mb-2">Hổng Từ Vựng (Nhấn để luyện tập):</h5>
                    <div className="flex flex-wrap gap-1.5">
                      {sortedWeakVocab.map((v, idx) => (
                        <button
                          key={idx}
                          onClick={() => onSelectWeakArea && onSelectWeakArea('vocab', v)}
                          title="Nhấp để ôn luyện chuyên sâu"
                          className="bg-amber-50 text-amber-700 text-[11px] px-2.5 py-1 rounded-lg border border-amber-200 hover:bg-amber-100 hover:border-amber-300 transition-all font-bold whitespace-nowrap cursor-pointer active:scale-95 text-left"
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="pt-1">
                    <h5 className="text-slate-400 text-[9px] font-extrabold uppercase tracking-wider mb-1">Hổng Từ Vựng:</h5>
                    <p className="text-slate-500 text-xs font-semibold">Nhận diện cấu trúc từ vựng rất tốt! 💡</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 pt-5 mt-6 flex justify-between text-xs text-slate-500 font-semibold">
            <span>Dự đoán năng lực:</span>
            <span className="font-bold text-indigo-600">
              {attempts.length === 0 ? "Chưa có đề liệu" : averageCorrectionRate >= 80 ? "Xuất sắc 🎉" : averageCorrectionRate >= 65 ? "Khá tốt 💪" : "Luyện thêm khóa đề ✍️"}
            </span>
          </div>
        </div>

        {/* Tile: Personal weak CEFR levels */}
        <div className="md:col-span-3 bg-white p-7 rounded-3xl border border-slate-200/60 shadow-xs flex flex-col justify-between min-h-[290px]">
          <div>
            <h4 className="text-slate-950 font-bold font-display tracking-tight text-base mb-1.5 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-600" /> Điểm yếu theo cấp độ CEFR
            </h4>
            <p className="text-slate-400 text-[11px] mb-4 font-semibold leading-relaxed">Tỷ lệ sai của riêng bạn tại mỗi mức CEFR (dựa trên các lượt luyện gần đây).</p>
            {weakDifficulty === null ? (
              <p className="text-slate-400 text-xs leading-relaxed font-semibold">
                Chưa đủ dữ liệu — số liệu này chỉ tính từ các lượt luyện thực hiện sau bản cập nhật này.
              </p>
            ) : weakDifficulty.length === 0 ? (
              <p className="text-slate-400 text-xs leading-relaxed font-semibold">Chưa có dữ liệu câu hỏi theo cấp độ CEFR.</p>
            ) : (
              <div className="space-y-3 pt-1">
                {weakDifficulty.map(item => {
                  const pct = Math.round(item.rate * 100);
                  return (
                    <div key={item.level} className="flex items-center gap-3 text-xs font-semibold">
                      <span className="font-mono text-sm font-bold text-slate-700 w-8">{item.level}</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${pct >= 50 ? 'bg-rose-500' : pct >= 25 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-slate-500 text-[10px] w-20 text-right font-mono font-bold">{item.wrong}/{item.total} sai ({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Tile 7: CEFR difficulty distribution across the exam bank (not personal performance) */}
        <div className="md:col-span-6 bg-white p-7 rounded-3xl border border-slate-200/60 shadow-xs flex flex-col justify-between">
          <div>
            <h4 className="text-slate-950 font-bold font-display tracking-tight text-base mb-1.5 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-600" /> Bản đồ độ khó CEFR của Ngân hàng đề
            </h4>
            <p className="text-slate-400 text-[11px] mb-4 font-semibold leading-relaxed">Phân phối số lượng câu hỏi có sẵn trong kho đề theo từng mức CEFR — đây là thống kê kho học liệu, không phải năng lực cá nhân của bạn (xem tile "Điểm yếu theo cấp độ CEFR" ở trên để biết năng lực cá nhân).</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 pt-1">
              {Object.entries(difficultyStats).map(([lvl, val]) => {
                const total = Object.values(difficultyStats).reduce((a, b) => a + b, 0);
                const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                return (
                  <div key={lvl} className="flex items-center gap-3 text-xs font-semibold">
                    <span className="font-mono text-sm font-bold text-slate-700 w-8">{lvl}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-slate-500 text-[10px] w-16 text-right font-mono font-bold">{val} câu ({pct}%)</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* LEADERBOARD TABLE OF TOP 10 STUDENTS */}
        <div className="md:col-span-6 bg-white rounded-3xl border border-slate-200/60 shadow-xs overflow-hidden">
          <div className="p-6 border-b border-slate-200/60 flex items-center justify-between bg-slate-50/50 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-500 fill-amber-100" />
              <div>
                <h4 className="text-slate-900 font-bold font-display tracking-tight text-sm md:text-base">
                  Bảng Vàng Học Sinh Danh Dự (Top 10)
                </h4>
                <p className="text-slate-400 text-[11px] font-semibold leading-normal">
                  Xếp hạng học sinh theo các tiêu chí học tập tích lũy. Nhấn vào tiêu đề cột để thay đổi tiêu chí sắp xếp!
                  {!isAdminViewer && ' Danh tính học sinh ngoài Top 3 được ẩn để bảo mật.'}
                </p>
              </div>
            </div>

            {/* Quick Filter Info */}
            <div className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded-full uppercase tracking-wider">
              Tháng {new Date().getMonth() + 1} / {new Date().getFullYear()}
            </div>
          </div>

          {sortedLeaderboard.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs font-semibold">
              Chưa có dữ liệu luyện tập nào khả dụng từ học sinh trên hệ thống.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/60 text-slate-500 text-[10px] font-bold border-b border-slate-200/60 uppercase tracking-wider">
                    <th className="px-6 py-4 text-center w-16">Hạng</th>
                    <th className="px-6 py-4">Học sinh</th>
                    <th
                      onClick={() => setSortBy('attemptsCount')}
                      className={`px-6 py-4 text-center cursor-pointer select-none transition-colors hover:bg-slate-100 ${sortBy === 'attemptsCount' ? 'bg-indigo-50 text-indigo-600 font-extrabold' : ''}`}
                    >
                      Số đề đã luyện {sortBy === 'attemptsCount' ? '▼' : '◇'}
                    </th>
                    <th
                      onClick={() => setSortBy('totalTime')}
                      className={`px-6 py-4 text-center cursor-pointer select-none transition-colors hover:bg-slate-100 ${sortBy === 'totalTime' ? 'bg-indigo-50 text-indigo-600 font-extrabold' : ''}`}
                    >
                      Thời gian luyện tập {sortBy === 'totalTime' ? '▼' : '◇'}
                    </th>
                    <th
                      onClick={() => setSortBy('latestScore')}
                      className={`px-6 py-4 text-center cursor-pointer select-none transition-colors hover:bg-slate-100 ${sortBy === 'latestScore' ? 'bg-indigo-50 text-indigo-600 font-extrabold' : ''}`}
                    >
                      Điểm gần nhất {sortBy === 'latestScore' ? '▼' : '◇'}
                    </th>
                    <th
                      onClick={() => setSortBy('monthAvg')}
                      className={`px-6 py-4 text-center cursor-pointer select-none transition-colors hover:bg-slate-100 ${sortBy === 'monthAvg' ? 'bg-indigo-50 text-indigo-600 font-extrabold' : ''}`}
                    >
                      Điểm TB tháng này {sortBy === 'monthAvg' ? '▼' : '◇'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                  {sortedLeaderboard.map((item, index) => {
                    const isTopThree = index < 3;
                    const isSelf = !!currentUser && currentUser.id === item.id;
                    const revealIdentity = isAdminViewer || isTopThree || isSelf;
                    const trophyMap = ['🥇', '🥈', '🥉'];
                    const badgeColors = [
                      'bg-amber-50 text-amber-800 border-amber-200 font-extrabold',
                      'bg-slate-50 text-slate-800 border-slate-200 font-extrabold',
                      'bg-orange-50 text-orange-800 border-orange-200 font-extrabold'
                    ];

                    return (
                      <tr key={item.id} className={`hover:bg-slate-50/40 transition-colors ${isSelf ? 'bg-indigo-50/20' : ''}`}>
                        <td className="px-6 py-4 text-center">
                          {isTopThree ? (
                            <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs border ${badgeColors[index]} shadow-3xs`}>
                              {trophyMap[index]}
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-600 font-bold font-mono">
                              {index + 1}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-extrabold text-slate-900 text-sm">
                              {revealIdentity ? item.name : 'Học sinh ẩn danh'}{isSelf && !isAdminViewer ? ' (Bạn)' : ''}
                            </span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] font-mono text-slate-400 font-medium">@{revealIdentity ? item.username : '••••••'}</span>
                              <span className="text-slate-300 text-[10px]">•</span>
                              <span className="px-1.5 py-0.2 bg-slate-100 border border-slate-200 rounded text-[9px] font-bold text-slate-500 uppercase tracking-tight">
                                Lớp {item.grade === 'admin' ? 'Admin' : item.grade}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center font-mono font-extrabold text-slate-800">
                          {item.attemptsCount} đề
                        </td>
                        <td className="px-6 py-4 text-center font-mono font-semibold text-slate-600">
                          {(item.totalTime / 60).toFixed(1)} phút
                        </td>
                        <td className="px-6 py-4 text-center">
                          {item.latestScore !== null ? (
                            <span className="px-2 py-0.5 rounded-md font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-100/50">
                              {item.latestScore.toFixed(1)} / 10
                            </span>
                          ) : (
                            <span className="text-slate-300 font-mono">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {item.monthAvg !== null ? (
                            <span className="px-2 py-0.5 rounded-md font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-100/50">
                              {item.monthAvg.toFixed(1)} / 10
                            </span>
                          ) : (
                            <span className="text-slate-300 font-mono">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Tile 8: Complete History logs */}
        <div className="md:col-span-6 bg-white rounded-3xl border border-slate-200/60 shadow-xs overflow-hidden flex flex-col justify-between">
          <div>
            <div className="p-6 border-b border-slate-200/60 flex items-center gap-2 bg-slate-50/50">
              <History className="h-5 w-5 text-indigo-600" />
              <h4 className="text-slate-900 font-bold font-display tracking-tight">Lịch sử luyện thi của {currentUser ? currentUser.name : "Tài khoản Guest"}</h4>
            </div>

            {attempts.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-xs font-medium">
                Bạn chưa thực hiện bài luyện đề nào. Hãy vào mục "Luyện đề thi" để thử sức ngay!
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/60 text-slate-500 text-[10px] font-bold border-b border-slate-200/60 uppercase tracking-wider">
                      <th className="px-6 py-4">Tên đề thi</th>
                      <th className="px-6 py-4">Thời gian hoàn thành</th>
                      <th className="px-6 py-4">Làm trong (phút)</th>
                      <th className="px-6 py-4 text-center">Đúng/Tổng</th>
                      <th className="px-6 py-4 text-center">Tỷ lệ</th>
                      <th className="px-6 py-4 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                    {(() => {
                      const sortedAttempts = [...attempts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                      const itemsPerPage = 10;
                      const paginated = sortedAttempts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
                      return paginated.map(att => (
                        <tr key={att.id} className="hover:bg-slate-50/40 transition-colors">
                          <td className="px-6 py-4 font-bold text-slate-900 max-w-sm truncate" title={att.examTitle}>
                            {att.examTitle} {att.examCode ? <span className="text-[10px] text-slate-400 font-mono ml-1">({att.examCode})</span> : null}
                          </td>
                          <td className="px-6 py-4 text-slate-500">{new Date(att.createdAt).toLocaleString()}</td>
                          <td className="px-6 py-4 text-slate-550 font-semibold">{(att.timeSpent / 60).toFixed(1)} phút</td>
                          <td className="px-6 py-4 text-center font-mono font-extrabold text-slate-800">{att.correctCount}/{att.totalCount}</td>
                          <td className="px-6 py-4 text-center">
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold ${
                              att.score >= 8 ? 'bg-green-50 text-green-700 border border-green-200' :
                              att.score >= 5 ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                              'bg-red-50 text-red-700 border border-red-200'
                            }`}>
                              {att.score.toFixed(1)} / 10
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right flex items-center justify-end gap-2">
                            <button
                              onClick={() => onRetakeExam(att.examId, att.answers)}
                              title="Xem lại bài làm"
                              className="inline-flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 text-indigo-700 text-[10px] font-extrabold px-3 py-1.5 rounded-lg active:scale-95 transition-all cursor-pointer shadow-xs"
                            >
                              <Award className="h-3.5 w-3.5 text-indigo-500" /> Xem lại
                            </button>
                            <button
                              onClick={() => onRetakeExam(att.examId)}
                              title="Làm lại đề thi này"
                              className="inline-flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-[10px] font-extrabold px-3 py-1.5 rounded-lg active:scale-95 transition-all cursor-pointer shadow-xs"
                            >
                              <RotateCcw className="h-3.5 w-3.5 text-slate-400" /> Làm lại
                            </button>
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {attempts.length > 0 && (() => {
            const itemsPerPage = 10;
            const totalPages = Math.ceil(attempts.length / itemsPerPage);
            if (totalPages <= 1) return null;
            return (
              <div className="p-4 border-t border-slate-200/60 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/50 text-xs text-slate-600 font-semibold">
                <div>
                  Hiển thị {Math.min(attempts.length, (currentPage - 1) * itemsPerPage + 1)}-{Math.min(attempts.length, currentPage * itemsPerPage)} trong {attempts.length} lượt
                </div>
                <div className="flex items-center gap-1">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:pointer-events-none transition-colors cursor-pointer select-none font-bold"
                  >
                    Trước
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer select-none text-xs font-bold ${
                        currentPage === page
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:pointer-events-none transition-colors cursor-pointer select-none font-bold"
                  >
                    Sau
                  </button>
                </div>
              </div>
            );
          })()}
        </div>

      </div>
    </div>
  );
}
