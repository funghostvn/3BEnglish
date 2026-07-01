import React, { useEffect, useState } from 'react';
import { Exam, Attempt, VOCABULARY_THEMES, GRAMMAR_THEMES } from '../types';
import { collection, getDocs, query, where, deleteDoc, doc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { BarChart, BookOpen, Clock, Award, History, RotateCcw, TrendingUp, Trophy } from 'lucide-react';

interface DashboardViewProps {
  currentGradeFilter: string;
  currentUser: any;
  onRetakeExam: (examId: string, savedAnswers?: any) => void;
  onShowModal: (config: { type: 'success' | 'warning' | 'danger' | 'info'; title: string; message: string }) => void;
  onSelectWeakArea?: (type: 'vocab' | 'grammar', value: string) => void;
}

export default function DashboardView({
  currentGradeFilter,
  currentUser,
  onRetakeExam,
  onShowModal,
  onSelectWeakArea,
}: DashboardViewProps) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [sortBy, setSortBy] = useState<'attemptsCount' | 'totalTime' | 'monthAvg' | 'latestScore'>('totalTime');
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
    fetchDashboardData();
  }, [currentGradeFilter, currentUser]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      let effectiveGradeFilter = currentGradeFilter;
      if (currentUser && currentUser.role === 'student' && currentUser.grade) {
        effectiveGradeFilter = currentUser.grade;
      }

      // 1. Fetch Exams (Always fetch all exams to compute global statistics of all 3 grades)
      const examCol = collection(db, 'exams');
      const qExam = query(examCol);
      const examSnap = await getDocs(qExam);
      const examList = examSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Exam));
      setExams(examList);

      // 2. Fetch All Attempts (Shared across stats, personal history & leaderboard calculations)
      const attemptCol = collection(db, 'attempts');
      const attemptSnap = await getDocs(attemptCol);
      let allAttemptsList = attemptSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) })) as Attempt[];

      // Filter out invalid attempts (too short: less than 120 seconds)
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

      // Client-side filtering of personal attempts by grade if selected
      const filteredAttempts = personalAttempts.filter(att => {
        if (effectiveGradeFilter === 'all') return true;
        return att.grade === parseInt(effectiveGradeFilter, 10);
      });

      // Sort personal attempts by latest completed
      filteredAttempts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setAttempts(filteredAttempts);

      // 3. Fetch Users
      const userCol = collection(db, 'users');
      const userSnap = await getDocs(userCol);
      const userList = userSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));

      const userMap: { [userId: string]: any } = {};
      userList.forEach(u => {
        userMap[u.id] = u;
      });

      // Compute statistics for non-admin users with >=1 attempts
      const now = new Date();
      const curYear = now.getFullYear();
      const curMonth = now.getMonth();

      const leaderboardData = userList
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
    } finally {
      setLoading(false);
    }
  };

  // Processing Stats
  const totalExamsCount = exams.length;
  let totalQuestionsCount = 0;
  const vocabThemeStats: { [theme: string]: number } = {};
  const grammarThemeStats: { [theme: string]: number } = {};
  const difficultyStats: { [level: string]: number } = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 };

  // Init all categories to 0
  VOCABULARY_THEMES.forEach(theme => { vocabThemeStats[theme] = 0; });
  GRAMMAR_THEMES.forEach(theme => { grammarThemeStats[theme] = 0; });

  exams.forEach(ex => {
    (ex.passages || []).forEach(pass => {
      const vocabCat = pass.vocabularyCategory || "Khác";
      (pass.questions || []).forEach(q => {
        totalQuestionsCount++;
        // Difficulty
        if (q.difficulty && difficultyStats[q.difficulty] !== undefined) {
          difficultyStats[q.difficulty]++;
        }
        // Grammar
        if (q.grammarCategory && grammarThemeStats[q.grammarCategory] !== undefined) {
          grammarThemeStats[q.grammarCategory]++;
        } else {
          grammarThemeStats["Other grammar"]++;
        }
        // Vocab
        if (vocabCat && vocabThemeStats[vocabCat] !== undefined) {
          vocabThemeStats[vocabCat]++;
        }
      });
    });
  });

  // Grade break counts
  const examsByGrade: { [key: number]: number } = { 6: 0, 10: 0, 12: 0 };
  exams.forEach(e => {
    if (e.grade === 6) examsByGrade[6] = (examsByGrade[6] || 0) + 1;
    if (e.grade === 10) examsByGrade[10] = (examsByGrade[10] || 0) + 1;
    if (e.grade === 12) examsByGrade[12] = (examsByGrade[12] || 0) + 1;
  });

  // Highlight Stats for current user/guest
  const totalCompletedCount = attempts.length;
  const averageCorrectionRate = totalCompletedCount > 0
    ? Math.round((attempts.reduce((sum, att) => sum + att.score, 0) / totalCompletedCount) * 10)
    : 0;

  // Find weak categories
  const grammarWrongCounts: { [theme: string]: number } = {};
  const vocabWrongCounts: { [theme: string]: number } = {};

  attempts.forEach(att => {
    (att.weakGrammar || []).forEach(g => {
      grammarWrongCounts[g] = (grammarWrongCounts[g] || 0) + 1;
    });
    (att.weakVocab || []).forEach(v => {
      vocabWrongCounts[v] = (vocabWrongCounts[v] || 0) + 1;
    });
  });

  const sortedWeakGrammar = Object.entries(grammarWrongCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(x => x[0]);

  const sortedWeakVocab = Object.entries(vocabWrongCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(x => x[0]);

  // Sort the active leaderboard based on selected field
  const sortedLeaderboard = [...leaderboard].sort((a, b) => {
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

  if (loading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-200">
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

        {/* Tile 6: Diagnostics assessment */}
        <div className="md:col-span-3 bg-white p-7 rounded-3xl border border-slate-200/60 shadow-xs flex flex-col justify-between min-h-[290px]">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="bg-indigo-50 text-indigo-700 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider">ĐÁNH GIÁ QUÁ TRÌNH</span>
              {attempts.length > 0 && (
                <span className="text-slate-400 text-[10px] font-semibold">Gần nhất: {new Date(attempts[0].createdAt).toLocaleDateString()}</span>
              )}
            </div>
            <h3 className="text-lg font-bold font-display tracking-tight text-slate-950 mb-1">Chủ điểm cần cải thiện 📈</h3>
            
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

        {/* Tile 7: CEFR difficulty stats */}
        <div className="md:col-span-3 bg-white p-7 rounded-3xl border border-slate-200/60 shadow-xs flex flex-col justify-between min-h-[290px]">
          <div>
            <h4 className="text-slate-950 font-bold font-display tracking-tight text-base mb-1.5 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-600" /> Bản đồ độ khó CEFR Standard
            </h4>
            <p className="text-slate-400 text-[11px] mb-4 font-semibold leading-relaxed">Phân phối lượng câu hỏi tích lũy theo thang tham chiếu năng lực Châu Âu.</p>
            <div className="space-y-3 pt-1">
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
                    const trophyMap = ['🥇', '🥈', '🥉'];
                    const badgeColors = [
                      'bg-amber-50 text-amber-800 border-amber-200 font-extrabold',
                      'bg-slate-50 text-slate-800 border-slate-200 font-extrabold',
                      'bg-orange-50 text-orange-800 border-orange-200 font-extrabold'
                    ];

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/40 transition-colors">
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
                            <span className="font-extrabold text-slate-900 text-sm">{item.name}</span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] font-mono text-slate-400 font-medium">@{item.username}</span>
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
