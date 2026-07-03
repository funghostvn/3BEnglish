import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { doc, collection, writeBatch, addDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { fetchCollection } from '../services/firestore';
import { Exam, Passage, Question, Attempt, QuestionFeedback, SRSItem, User, CategoryPerf } from '../types';
import { MIN_ATTEMPT_SECONDS_TO_SAVE } from '../constants';

export type ModalConfig = {
  type: 'success' | 'warning' | 'danger' | 'info' | 'confirm';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
};

export type ScoreSummary = { score: number; correctCount: number; totalCount: number; timeSpent: number };

interface MatchingQuestionItem {
  question: Question;
  passageTitle: string;
  passageContent: string;
  vocabularyCategory?: string;
}

// ---- In-progress session autosave (survives accidental refresh/close) ----
const AUTOSAVE_KEY = 'exam_prep_active_session_v1';
const AUTOSAVE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // saved sessions older than 6h are discarded

interface SavedSession {
  exam: Exam;
  userAnswers: { [qNumber: string]: string };
  markedQuestions: { [qNumber: string]: boolean };
  timeRemaining: number;
  totalQuizTime: number;
  isSrsQuiz: boolean;
  savedAt: string; // ISO
  userKey: string; // owner (user id or 'guest') — a save never resumes under another account
}

// Lightweight summary of a recoverable session, for lobby "resume?" banners.
export interface PendingResume {
  examTitle: string;
  examCode: string;
  savedAt: string;
  answeredCount: number;
  totalCount: number;
}

export function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Shared quiz-taking engine used by both PracticeView (fixed exams) and
// CustomTrainingView (AI-generated/SRS quizzes). Owns the exam bank, SRS
// items, the active quiz session state, grading, and feedback reporting so
// both views stay in sync instead of drifting via copy-pasted logic.
export function useExamSession(
  currentUser: User | null,
  currentGradeFilter: string,
  onShowModal: (config: ModalConfig) => void
) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  const [srsItems, setSrsItems] = useState<SRSItem[]>([]);
  const [loadingSrs, setLoadingSrs] = useState(true);

  const [activeExam, setActiveExam] = useState<Exam | null>(null);
  const [isSrsQuiz, setIsSrsQuiz] = useState(false);
  const [userAnswers, setUserAnswers] = useState<{ [qNumber: string]: string }>({});
  const [markedQuestions, setMarkedQuestions] = useState<{ [qNumber: string]: boolean }>({});
  const [activeQuestionIdx, setActiveQuestionIdx] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(30 * 60);
  const [totalQuizTime, setTotalQuizTime] = useState(30 * 60);
  const [examActive, setExamActive] = useState(false);
  const [graded, setGraded] = useState(false);
  const [scoreSummary, setScoreSummary] = useState<ScoreSummary | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [reportingQNum, setReportingQNum] = useState<number | null>(null);
  const [layoutMode, setLayoutMode] = useState<'single' | 'passage_all'>('single');
  const [practiceFontSize, setPracticeFontSize] = useState<'sm' | 'base' | 'lg' | 'xl'>('base');
  const [showAllPassages, setShowAllPassages] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState<'passage' | 'question'>('question');

  // Non-blocking reading notice shown when the active question belongs to a
  // different passage than the previous one (replaces the old modal, which
  // interrupted students mid-exam while the timer kept running).
  const [passageNotice, setPassageNotice] = useState<string | null>(null);

  // Recoverable in-progress session found in localStorage (if any).
  const [pendingResume, setPendingResume] = useState<PendingResume | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const passageRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});
  const prevPassageIdxRef = useRef<number | null>(null);
  const timeRemainingRef = useRef(timeRemaining);

  const userKey = currentUser?.id || 'guest';

  const fetchExams = useCallback(async () => {
    setLoading(true);
    try {
      let effectiveGradeFilter = currentGradeFilter;
      if (currentUser && currentUser.role === 'student' && currentUser.grade) {
        effectiveGradeFilter = currentUser.grade;
      }

      const constraints = effectiveGradeFilter !== 'all'
        ? [where('grade', '==', parseInt(effectiveGradeFilter, 10))]
        : [];

      const list = await fetchCollection<Exam>('exams', ...constraints);
      setExams(list);
    } catch (err) {
      console.error(err);
      onShowModal({ type: 'danger', title: 'Lỗi tải đề thi', message: 'Không thể tải danh sách đề thi. Vui lòng kiểm tra kết nối mạng và thử lại.' });
    } finally {
      setLoading(false);
    }
  }, [currentGradeFilter, currentUser, onShowModal]);

  const fetchSrsItems = useCallback(async () => {
    if (!currentUser) {
      setSrsItems([]);
      setLoadingSrs(false);
      return;
    }
    setLoadingSrs(true);
    try {
      const list = await fetchCollection<SRSItem>('srs_items', where('userId', '==', currentUser.id));
      setSrsItems(list);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingSrs(false);
    }
  }, [currentUser]);

  useEffect(() => {
    fetchExams();
    fetchSrsItems();
  }, [fetchExams, fetchSrsItems]);

  useEffect(() => { timeRemainingRef.current = timeRemaining; }, [timeRemaining]);

  // Detect a recoverable session for this user on mount / account switch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) { setPendingResume(null); return; }
      const saved = JSON.parse(raw) as SavedSession;
      const age = Date.now() - new Date(saved.savedAt).getTime();
      if (!saved.exam || saved.userKey !== userKey || isNaN(age) || age > AUTOSAVE_MAX_AGE_MS) {
        setPendingResume(null);
        return;
      }
      setPendingResume({
        examTitle: saved.exam.title,
        examCode: saved.exam.examCode || '',
        savedAt: saved.savedAt,
        answeredCount: Object.keys(saved.userAnswers || {}).length,
        totalCount: saved.exam.numQuestions || 0,
      });
    } catch {
      localStorage.removeItem(AUTOSAVE_KEY);
      setPendingResume(null);
    }
  }, [userKey]);

  // Best-effort snapshot of the live session. Saves are answer-driven plus a
  // 15s heartbeat/beforeunload (below) so remaining time stays fresh without
  // serializing the exam JSON every timer tick.
  const persistSession = useCallback(() => {
    if (!activeExam || !examActive || graded) return;
    try {
      const payload: SavedSession = {
        exam: activeExam,
        userAnswers,
        markedQuestions,
        timeRemaining: timeRemainingRef.current,
        totalQuizTime,
        isSrsQuiz,
        savedAt: new Date().toISOString(),
        userKey,
      };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
    } catch { /* quota/unavailable — autosave is best-effort only */ }
  }, [activeExam, examActive, graded, userAnswers, markedQuestions, totalQuizTime, isSrsQuiz, userKey]);

  // Save whenever answers/marks change (persistSession identity tracks them)…
  useEffect(() => { persistSession(); }, [persistSession]);

  // …plus heartbeat + tab-close flush while a session is live.
  useEffect(() => {
    if (!examActive || graded) return;
    window.addEventListener('beforeunload', persistSession);
    const heartbeat = setInterval(persistSession, 15000);
    return () => {
      window.removeEventListener('beforeunload', persistSession);
      clearInterval(heartbeat);
    };
  }, [examActive, graded, persistSession]);

  const clearSavedSession = useCallback(() => {
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
    setPendingResume(null);
  }, []);

  // Re-open the saved session exactly where the student left off.
  const resumeSavedSession = () => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as SavedSession;
      if (!saved.exam || saved.userKey !== userKey) return;
      setActiveExam(saved.exam);
      setIsSrsQuiz(!!saved.isSrsQuiz);
      setUserAnswers(saved.userAnswers || {});
      setMarkedQuestions(saved.markedQuestions || {});
      setActiveQuestionIdx(0);
      setTimeRemaining(Math.max(30, saved.timeRemaining || 0));
      setTotalQuizTime(saved.totalQuizTime || saved.exam.duration * 60);
      setExamActive(true);
      setGraded(false);
      setScoreSummary(null);
      setFeedbackText('');
      setReportingQNum(null);
      setPendingResume(null);
    } catch {
      clearSavedSession();
    }
  };

  // Timer loop
  useEffect(() => {
    if (examActive && !graded) {
      timerRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            autoSubmitExam();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examActive, graded]);

  const questionsList = useMemo<Question[]>(() => {
    if (!activeExam) return [];
    const arr: Question[] = [];
    (activeExam.passages || []).forEach(pass => {
      (pass.questions || []).forEach(q => {
        arr.push({
          ...q,
          originalExamId: q.originalExamId || activeExam.id,
          originalQuestionNumber: q.originalQuestionNumber || q.questionNumber
        });
      });
    });
    return arr.sort((a, b) => a.questionNumber - b.questionNumber);
  }, [activeExam]);

  const currentQuestion = questionsList[activeQuestionIdx];

  const getActivePassageIdx = useCallback(() => {
    if (!activeExam) return 0;
    const currQ = questionsList[activeQuestionIdx];
    if (!currQ) return 0;
    return activeExam.passages.findIndex(p => (p.questions || []).some(q => q.questionNumber === currQ.questionNumber));
  }, [activeExam, questionsList, activeQuestionIdx]);

  const jumpToPassage = useCallback((pIdx: number) => {
    if (!activeExam || pIdx < 0 || pIdx >= activeExam.passages.length) return;
    const targetPassage = activeExam.passages[pIdx];
    if (!targetPassage || !targetPassage.questions || targetPassage.questions.length === 0) return;
    const firstQNum = targetPassage.questions[0].questionNumber;
    const flatIdx = questionsList.findIndex(q => q.questionNumber === firstQNum);
    if (flatIdx >= 0) {
      setActiveQuestionIdx(flatIdx);
    }
  }, [activeExam, questionsList]);

  // Auto scroll passage into focus and manage tabs when active question changes
  useEffect(() => {
    if (activeExam) {
      const activePassageIdx = getActivePassageIdx();

      const el = passageRefs.current[activePassageIdx];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      if (prevPassageIdxRef.current !== null && prevPassageIdxRef.current !== activePassageIdx) {
        setActiveMobileTab('passage');
        // Non-blocking toast (rendered by ExamRunner) instead of a modal so the
        // student is never forced to stop and dismiss anything mid-exam.
        setPassageNotice(`Câu hỏi này thuộc Đoạn văn số ${activePassageIdx + 1} — hãy đọc kỹ bài khoá trước khi trả lời.`);
      }
      prevPassageIdxRef.current = activePassageIdx;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuestionIdx, activeExam]);

  // Auto-dismiss the passage notice toast.
  useEffect(() => {
    if (!passageNotice) return;
    const t = setTimeout(() => setPassageNotice(null), 4000);
    return () => clearTimeout(t);
  }, [passageNotice]);

  // Keyboard navigation: ←/→ moves between questions; A-D (or 1-4) answers the
  // current question directly in single-question layout.
  useEffect(() => {
    if (!examActive || !activeExam) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return; // keep browser shortcuts intact
      if (e.key === 'ArrowLeft') {
        setActiveQuestionIdx(prev => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        setActiveQuestionIdx(prev => {
          const flatMapLength = activeExam.passages.reduce((sum, pass) => sum + (pass.questions || []).length, 0);
          return Math.min(flatMapLength - 1, prev + 1);
        });
      } else if (!graded && layoutMode === 'single') {
        const digitMap: { [k: string]: string } = { '1': 'A', '2': 'B', '3': 'C', '4': 'D' };
        const letter = e.key.length === 1 ? e.key.toUpperCase() : '';
        const choice = digitMap[e.key] || (['A', 'B', 'C', 'D'].includes(letter) ? letter : null);
        const q = questionsList[activeQuestionIdx];
        if (choice && q && q.options && choice in q.options) {
          setUserAnswers(prev => ({ ...prev, [q.questionNumber]: choice }));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [examActive, activeExam, graded, layoutMode, questionsList, activeQuestionIdx]);

  const resetSessionState = (durationSeconds: number) => {
    setUserAnswers({});
    setMarkedQuestions({});
    setActiveQuestionIdx(0);
    setTimeRemaining(durationSeconds);
    setTotalQuizTime(durationSeconds);
    setExamActive(true);
    setGraded(false);
    setFeedbackText('');
    setReportingQNum(null);
  };

  const startDirectExam = (exam: Exam) => {
    if (currentUser?.role === 'student' && currentUser.grade && exam.grade !== parseInt(currentUser.grade, 10)) {
      onShowModal({
        type: 'danger',
        title: 'Lớp học không phù hợp',
        message: `Tài khoản của bạn đăng ký học khối lớp ${currentUser.grade}. Bạn không được phép làm đề thi của khối lớp khác!`
      });
      return;
    }
    setActiveExam(exam);
    setIsSrsQuiz(false);
    resetSessionState(exam.duration * 60);
  };

  // Re-opens a previously taken exam in read-only "review" mode: answers are
  // prefilled and the exam is immediately graded so the timer never starts.
  const startExamForReview = (exam: Exam, answers: { [qNumber: string]: string }) => {
    setActiveExam(exam);
    setIsSrsQuiz(false);
    setMarkedQuestions({});
    setActiveQuestionIdx(0);
    setTimeRemaining(exam.duration * 60);
    setTotalQuizTime(exam.duration * 60);
    setExamActive(true);
    setFeedbackText('');
    setReportingQNum(null);
    setUserAnswers(answers);
    setGraded(true);
  };

  const generateCustomQuiz = (criteria: { vocab: string; grammar: string; diff: string; size: string }) => {
    const matchingQuestions: MatchingQuestionItem[] = [];

    exams.forEach(ex => {
      (ex.passages || []).forEach(pass => {
        const vocabMatches = criteria.vocab === 'all' || pass.vocabularyCategory === criteria.vocab;
        (pass.questions || []).forEach(q => {
          const grammarMatches = criteria.grammar === 'all' || q.grammarCategory === criteria.grammar;
          const diffMatches = criteria.diff === 'all' || q.difficulty === criteria.diff;
          if (vocabMatches && grammarMatches && diffMatches) {
            matchingQuestions.push({
              question: { ...q, originalExamId: ex.id, originalQuestionNumber: q.questionNumber },
              passageTitle: pass.title,
              passageContent: pass.content,
              vocabularyCategory: pass.vocabularyCategory
            });
          }
        });
      });
    });

    if (matchingQuestions.length === 0) {
      onShowModal({
        type: 'warning',
        title: 'Không tìm thấy câu hỏi',
        message: 'Không tìm thấy câu hỏi nào phù hợp với bộ lọc đã chọn. Vui lòng chọn chủ đề rộng hơn!'
      });
      return;
    }

    matchingQuestions.sort(() => Math.random() - 0.5);
    const finalSize = parseInt(criteria.size, 10);
    const selectedBatch = matchingQuestions.slice(0, finalSize);

    const passagesResult: Passage[] = selectedBatch.map((item, idx) => ({
      title: `${item.passageTitle} (Câu hỏi lẻ #${idx + 1})`,
      content: item.passageContent,
      vocabularyCategory: item.vocabularyCategory,
      questions: [{ ...item.question, questionNumber: idx + 1 }]
    }));

    const duration = finalSize === 40 ? 50 : 15;

    const mockExam: Exam = {
      id: `custom_quiz_${Date.now()}`,
      title: `Bài thi tự chọn (${finalSize} Câu hỏi, ${duration} phút)`,
      examName: `Bài thi tự chọn (${finalSize} Câu hỏi, ${duration} phút)`,
      examCode: "RANDOM",
      grade: currentGradeFilter === 'all' ? 10 : parseInt(currentGradeFilter, 10),
      numQuestions: finalSize,
      duration,
      publisher: "Hệ thống tự động biên soạn",
      year: new Date().getFullYear(),
      createdAt: new Date().toISOString(),
      passages: passagesResult
    };

    setActiveExam(mockExam);
    setIsSrsQuiz(false);
    resetSessionState(duration * 60);
  };

  const generateSrsQuiz = (intervalTarget?: number) => {
    const now = new Date();
    let dueItems = srsItems.filter(item =>
      item.status === 'pending' &&
      (!intervalTarget || item.interval === intervalTarget) &&
      new Date(item.nextReviewDate) <= now
    );

    if (dueItems.length === 0) {
      onShowModal({
        type: 'info',
        title: 'Hoàn thành ôn luyện!',
        message: 'Không có câu hỏi nào cần ôn luyện vào lúc này. Tuyệt vời!'
      });
      return;
    }

    dueItems.sort(() => Math.random() - 0.5);
    if (dueItems.length > 40) dueItems = dueItems.slice(0, 40);

    const matchingQuestions: MatchingQuestionItem[] = [];
    dueItems.forEach(srsItem => {
      const ex = exams.find(e => e.id === srsItem.examId);
      if (ex) {
        (ex.passages || []).forEach(pass => {
          const q = (pass.questions || []).find(qy => qy.questionNumber === srsItem.questionNumber);
          if (q) {
            matchingQuestions.push({
              question: { ...q, originalExamId: ex.id, originalQuestionNumber: q.questionNumber },
              passageTitle: pass.title,
              passageContent: pass.content,
              vocabularyCategory: pass.vocabularyCategory
            });
          }
        });
      }
    });

    if (matchingQuestions.length === 0) {
      onShowModal({
        type: 'warning',
        title: 'Lỗi đồng bộ',
        message: 'Không tìm thấy dữ liệu gốc của các câu hỏi này.'
      });
      return;
    }

    const passagesResult: Passage[] = matchingQuestions.map((item, idx) => ({
      title: `${item.passageTitle} (Câu hỏi ôn luyện #${idx + 1})`,
      content: item.passageContent,
      vocabularyCategory: item.vocabularyCategory,
      questions: [{ ...item.question, questionNumber: idx + 1 }]
    }));

    const finalSize = matchingQuestions.length;
    const duration = finalSize > 20 ? 50 : 15;

    const mockExam: Exam = {
      id: `srs_quiz_${Date.now()}`,
      title: `Ôn luyện chuyên sâu (${finalSize} Câu hỏi)`,
      examName: `Hệ thống Ôn luyện Spaced Repetition`,
      examCode: "SRS",
      grade: currentGradeFilter === 'all' ? 10 : parseInt(currentGradeFilter, 10),
      numQuestions: finalSize,
      duration,
      publisher: "Spaced Repetition System",
      year: new Date().getFullYear(),
      createdAt: new Date().toISOString(),
      passages: passagesResult
    };

    setActiveExam(mockExam);
    setIsSrsQuiz(true);
    resetSessionState(duration * 60);
  };

  const handleSelectOption = (qNum: number, choice: string) => {
    if (graded) return;
    setUserAnswers(prev => ({ ...prev, [qNum]: choice }));
  };

  const toggleMarked = (qNum: number) => {
    setMarkedQuestions(prev => ({ ...prev, [qNum]: !prev[qNum] }));
  };

  const submitExam = () => {
    onShowModal({
      type: 'confirm',
      title: 'Nộp bài thi',
      message: 'Bạn có chắc chắn muốn nộp bài thi để tiến hành chấm điểm không?',
      onConfirm: () => forceGradeSubmit()
    });
  };

  const autoSubmitExam = () => {
    onShowModal({
      type: 'warning',
      title: 'Hết giờ làm bài!',
      message: 'Đã hết thời gian tối đa để làm đề luyện tập. Hệ thống sẽ tự động tổng hợp kết quả của bạn.'
    });
    forceGradeSubmit();
  };

  const forceGradeSubmit = async () => {
    if (!activeExam) return;
    setGraded(true);
    clearSavedSession(); // the session is finished — nothing left to resume

    let correctCount = 0;
    const weakGrammar: string[] = [];
    const weakVocab: string[] = [];
    const grammarPerf: { [category: string]: CategoryPerf } = {};
    const vocabPerf: { [category: string]: CategoryPerf } = {};
    const difficultyPerf: { [level: string]: CategoryPerf } = {};

    const bumpPerf = (map: { [key: string]: CategoryPerf }, key: string, isCorrect: boolean) => {
      if (!map[key]) map[key] = { correct: 0, wrong: 0 };
      if (isCorrect) map[key].correct++;
      else map[key].wrong++;
    };

    questionsList.forEach(q => {
      const ans = userAnswers[q.questionNumber];
      const isCorrect = ans === q.correctAnswer;
      const parentPassage = (activeExam.passages || []).find(p => (p.questions || []).some(qy => qy.questionNumber === q.questionNumber));

      if (q.grammarCategory) bumpPerf(grammarPerf, q.grammarCategory, isCorrect);
      if (parentPassage && parentPassage.vocabularyCategory) bumpPerf(vocabPerf, parentPassage.vocabularyCategory, isCorrect);
      if (q.difficulty) bumpPerf(difficultyPerf, q.difficulty, isCorrect);

      if (isCorrect) {
        correctCount++;
      } else {
        if (q.grammarCategory) weakGrammar.push(q.grammarCategory);
        if (parentPassage && parentPassage.vocabularyCategory) {
          weakVocab.push(parentPassage.vocabularyCategory);
        }
      }
    });

    const totalCount = questionsList.length;
    const finalScore = totalCount > 0 ? (correctCount / totalCount) * 10 : 0;
    const timeSpent = totalQuizTime - timeRemaining;

    setScoreSummary({ score: finalScore, correctCount, totalCount, timeSpent });

    // Rage-quit-fast submits (under MIN_ATTEMPT_SECONDS_TO_SAVE) never get an
    // Attempt record, so they're excluded from history and Dashboard scoring.
    // This does NOT apply to SRS review sessions: those are often just a
    // handful of due questions and can legitimately finish in well under the
    // threshold, so SRS status must still transition even when the Attempt
    // record itself is skipped.
    const shouldLogAttempt = timeSpent >= MIN_ATTEMPT_SECONDS_TO_SAVE;
    if (!shouldLogAttempt && !isSrsQuiz) {
      return;
    }

    try {
      const dbBatch = writeBatch(db);
      const now = new Date();

      questionsList.forEach(q => {
        const origExamId = q.originalExamId || activeExam.id;
        const origQNumber = q.originalQuestionNumber || q.questionNumber;

        const srsItem = srsItems.find(item => item.examId === origExamId && item.questionNumber === origQNumber);
        const ans = userAnswers[q.questionNumber];
        const isCorrect = ans === q.correctAnswer;

        if (!isCorrect && ans !== undefined) {
          const nextDate = new Date();
          nextDate.setDate(nextDate.getDate() + 3);

          if (srsItem) {
            const ref = doc(db, 'srs_items', srsItem.id!);
            dbBatch.update(ref, {
              interval: 3,
              status: 'pending',
              nextReviewDate: nextDate.toISOString(),
              lastReviewedDate: now.toISOString()
            });
          } else if (currentUser) {
            const ref = doc(collection(db, 'srs_items'));
            dbBatch.set(ref, {
              userId: currentUser.id,
              examId: origExamId,
              questionNumber: origQNumber,
              interval: 3,
              status: 'pending',
              nextReviewDate: nextDate.toISOString(),
              lastReviewedDate: now.toISOString()
            });
          }
        } else if (isCorrect && isSrsQuiz && srsItem) {
          let nextInterval = 3;
          let newStatus = 'pending';
          const nDate = new Date();

          if (srsItem.interval === 3) nextInterval = 7;
          else if (srsItem.interval === 7) nextInterval = 15;
          else if (srsItem.interval === 15) nextInterval = 30;
          else if (srsItem.interval === 30) {
            newStatus = 'mastered';
            nextInterval = 0;
          }

          if (newStatus !== 'mastered') {
            nDate.setDate(nDate.getDate() + nextInterval);
          }

          const ref = doc(db, 'srs_items', srsItem.id!);
          dbBatch.update(ref, {
            interval: nextInterval,
            status: newStatus,
            nextReviewDate: nDate.toISOString(),
            lastReviewedDate: now.toISOString()
          });
        }
      });

      if (shouldLogAttempt) {
        const attemptRef = doc(collection(db, 'attempts'));
        dbBatch.set(attemptRef, {
          examId: activeExam.id,
          examTitle: activeExam.title,
          examCode: activeExam.examCode || "",
          userId: currentUser ? currentUser.id : "guest",
          username: currentUser ? currentUser.name : "Tài khoản Guest",
          grade: activeExam.grade || 10,
          correctCount,
          totalCount,
          score: finalScore,
          timeSpent,
          createdAt: new Date().toISOString(),
          answers: userAnswers,
          weakGrammar: Array.from(new Set(weakGrammar)),
          weakVocab: Array.from(new Set(weakVocab)),
          grammarPerf,
          vocabPerf,
          difficultyPerf
        });
      }

      await dbBatch.commit();
      fetchSrsItems();
    } catch (error) {
      console.error("Failed to commit attempt score logs to Firestore:", error);
      onShowModal({
        type: 'danger',
        title: 'Lỗi lưu kết quả',
        message: 'Không thể lưu kết quả bài thi lên hệ thống. Điểm số bạn thấy chỉ hiển thị tạm thời và sẽ không xuất hiện trong lịch sử. Vui lòng kiểm tra kết nối mạng.'
      });
    }
  };

  const handleReportFeedback = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeExam || reportingQNum === null || !feedbackText.trim()) return;

    try {
      const feedbackPayload: Partial<QuestionFeedback> = {
        examId: activeExam.id,
        examTitle: activeExam.title,
        questionNumber: reportingQNum,
        reportedBy: currentUser ? `${currentUser.name} (${currentUser.username})` : 'Học sinh Guest',
        reportText: feedbackText,
        createdAt: new Date().toISOString(),
        status: 'pending'
      };

      await addDoc(collection(db, 'feedbacks'), feedbackPayload);
      onShowModal({
        type: 'success',
        title: 'Báo cáo thành công',
        message: 'Yêu cầu rà soát đáp án của bạn đã được gửi tới Ban quản trị/Giáo viên để xử lý. Xin cảm ơn!'
      });
      setFeedbackText('');
      setReportingQNum(null);
    } catch (err) {
      console.error(err);
      onShowModal({ type: 'danger', title: 'Gửi phản hồi thất bại', message: 'Không thể gửi báo cáo lỗi câu hỏi. Vui lòng thử lại sau.' });
    }
  };

  const handleRetake = () => {
    setGraded(false);
    setScoreSummary(null);
    setUserAnswers({});
    setMarkedQuestions({});
    setActiveQuestionIdx(0);
    setTimeRemaining(activeExam ? activeExam.duration * 60 : 30 * 60);
    setFeedbackText('');
    setReportingQNum(null);
  };

  const quitExam = () => {
    setActiveExam(null);
    setExamActive(false);
    setGraded(false);
    setScoreSummary(null);
    clearSavedSession();
    fetchExams();
  };

  return {
    exams, loading, refetchExams: fetchExams,
    srsItems, loadingSrs,
    activeExam, isSrsQuiz, examActive, graded, scoreSummary, setScoreSummary,
    userAnswers, markedQuestions, activeQuestionIdx, setActiveQuestionIdx,
    timeRemaining, totalQuizTime,
    feedbackText, setFeedbackText, reportingQNum, setReportingQNum,
    layoutMode, setLayoutMode, practiceFontSize, setPracticeFontSize,
    showAllPassages, setShowAllPassages, activeMobileTab, setActiveMobileTab,
    questionsList, currentQuestion,
    passageRefs,
    passageNotice,
    pendingResume, resumeSavedSession, discardSavedSession: clearSavedSession,
    getActivePassageIdx, jumpToPassage,
    handleSelectOption, toggleMarked,
    startDirectExam, startExamForReview, generateCustomQuiz, generateSrsQuiz,
    submitExam, handleReportFeedback, handleRetake, quitExam,
  };
}

export type ExamSession = ReturnType<typeof useExamSession>;
