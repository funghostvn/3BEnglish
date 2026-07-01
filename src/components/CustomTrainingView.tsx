import React, { useEffect, useState, useRef } from 'react';
import { Exam, Passage, Question, Attempt, QuestionFeedback, SRSItem, VOCABULARY_THEMES, GRAMMAR_THEMES, DIFFICULTY_LEVELS } from '../types';
import { collection, getDocs, addDoc, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { BookOpen, Award, CheckCircle, AlertCircle, FileText, Bookmark, ArrowRight, ArrowLeft, Send, Sparkles, RefreshCw, AlertTriangle, Eye, Clock } from 'lucide-react';

interface PracticeViewProps {
  currentGradeFilter: string;
  currentUser: any;
  preSelectedExamId?: string | null;
  preSelectedAnswers?: { [qNum: string]: string } | null;
  preSelectedVocab?: string | null;
  preSelectedGrammar?: string | null;
  onClearPreSelections: () => void;
  onShowModal: (config: { type: 'success' | 'warning' | 'danger' | 'info' | 'confirm'; title: string; message: string; onConfirm?: () => void; onCancel?: () => void; confirmText?: string; cancelText?: string; }) => void;
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
}: PracticeViewProps) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  // Active state
  const [activeExam, setActiveExam] = useState<Exam | null>(null);
  const [isCustomQuiz, setIsCustomQuiz] = useState(false);
  const [isSrsQuiz, setIsSrsQuiz] = useState(false);
  const [userAnswers, setUserAnswers] = useState<{ [qNumber: string]: string }>({});
  const [markedQuestions, setMarkedQuestions] = useState<{ [qNumber: string]: boolean }>({});
  const [activeQuestionIdx, setActiveQuestionIdx] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(30 * 60); // default 30 mins
  const [totalQuizTime, setTotalQuizTime] = useState(30 * 60);
  const [examActive, setExamActive] = useState(false);
  const [graded, setGraded] = useState(false);
  const [scoreSummary, setScoreSummary] = useState<{ score: number; correctCount: number; totalCount: number; timeSpent: number } | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [reportingQNum, setReportingQNum] = useState<number | null>(null);
  const [layoutMode, setLayoutMode] = useState<'single' | 'passage_all'>('single');
  const [practiceFontSize, setPracticeFontSize] = useState<'sm' | 'base' | 'lg' | 'xl'>('base');
  const [selectedClassificationFilter, setSelectedClassificationFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // SRS States
  const [srsItems, setSrsItems] = useState<SRSItem[]>([]);
  const [loadingSrs, setLoadingSrs] = useState(true);

  // Dynamic font size classes based on practiceFontSize
  const getPassageTitleClass = () => {
    switch (practiceFontSize) {
      case 'sm': return 'text-base font-bold text-slate-800 mb-2';
      case 'lg': return 'text-xl md:text-2xl font-bold text-slate-800 mb-3';
      case 'xl': return 'text-2xl md:text-3xl font-bold text-slate-800 mb-4';
      case 'base':
      default: return 'text-lg md:text-xl font-bold text-slate-800 mb-2.5';
    }
  };

  const getPassageContentClass = () => {
    switch (practiceFontSize) {
      case 'sm': return 'text-xs md:text-sm text-slate-700 leading-relaxed space-y-3 font-normal whitespace-pre-line';
      case 'lg': return 'text-base md:text-lg text-slate-700 leading-relaxed space-y-4 font-normal whitespace-pre-line';
      case 'xl': return 'text-lg md:text-xl text-slate-700 leading-relaxed space-y-5 font-normal whitespace-pre-line';
      case 'base':
      default: return 'text-sm md:text-base text-slate-700 leading-relaxed space-y-3.5 font-normal whitespace-pre-line';
    }
  };

  const getQuestionTextClass = () => {
    switch (practiceFontSize) {
      case 'sm': return 'text-sm font-semibold text-slate-800 leading-snug whitespace-pre-line';
      case 'lg': return 'text-lg md:text-xl font-semibold text-slate-800 leading-snug whitespace-pre-line';
      case 'xl': return 'text-xl md:text-2xl font-bold text-slate-800 leading-snug whitespace-pre-line';
      case 'base':
      default: return 'text-base md:text-lg font-semibold text-slate-800 leading-snug whitespace-pre-line';
    }
  };

  const getOptionTextClass = () => {
    switch (practiceFontSize) {
      case 'sm': return 'text-xs md:text-sm text-slate-700';
      case 'lg': return 'text-sm md:text-base text-slate-700';
      case 'xl': return 'text-base md:text-lg text-slate-700';
      case 'base':
      default: return 'text-[13px] md:text-sm text-slate-700';
    }
  };

  // States to filter active passage or switch tabs on mobile comfortably
  const [showAllPassages, setShowAllPassages] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState<'passage' | 'question'>('question');

  // Custom Quiz Setup
  const [customVocab, setCustomVocab] = useState('all');
  const [customGrammar, setCustomGrammar] = useState('all');
  const [customDiff, setCustomDiff] = useState('all');
  const [customSize, setCustomSize] = useState('40'); // '40' (50min) or '10' (15min)

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const passageRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  useEffect(() => {
    fetchExams();
    fetchSrsItems();
  }, [currentGradeFilter, currentUser]);

  const fetchSrsItems = async () => {
    if (!currentUser) return;
    setLoadingSrs(true);
    try {
      const qs = await getDocs(collection(db, 'srs_items'));
      const list = qs.docs.map(doc => ({ id: doc.id, ...doc.data() } as SRSItem));
      // filter for current user
      const userItems = list.filter(item => item.userId === currentUser.id);
      setSrsItems(userItems);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingSrs(false);
    }
  };

  useEffect(() => {
    if (preSelectedExamId && exams.length > 0) {
      const found = exams.find(e => e.id === preSelectedExamId);
      if (found) {
        startDirectExam(found);
        if (preSelectedAnswers) {
          // prefill if reviewing historical
          setUserAnswers(preSelectedAnswers);
          setGraded(true);
        }
      }
      onClearPreSelections(); // clear in outer state so as not to trigger loop
    }
  }, [preSelectedExamId, exams]);

  useEffect(() => {
    if (preSelectedVocab || preSelectedGrammar) {
      if (preSelectedVocab) {
        setCustomVocab(preSelectedVocab);
      }
      if (preSelectedGrammar) {
        setCustomGrammar(preSelectedGrammar);
      }
      onClearPreSelections();
    }
  }, [preSelectedVocab, preSelectedGrammar]);

  // Timer loop
  useEffect(() => {
    if (examActive && !graded) {
      timerRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
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
  }, [examActive, graded]);

  const getActivePassageIdx = () => {
    if (!activeExam) return 0;
    const flatQ = getFlatQuestionsList();
    const currQ = flatQ[activeQuestionIdx];
    if (!currQ) return 0;
    return activeExam.passages.findIndex(p => (p.questions || []).some(q => q.questionNumber === currQ.questionNumber));
  };

  const jumpToPassage = (pIdx: number) => {
    if (!activeExam || pIdx < 0 || pIdx >= activeExam.passages.length) return;
    const targetPassage = activeExam.passages[pIdx];
    if (!targetPassage || !targetPassage.questions || targetPassage.questions.length === 0) return;
    const firstQNum = targetPassage.questions[0].questionNumber;
    const questionsList = getFlatQuestionsList();
    const flatIdx = questionsList.findIndex(q => q.questionNumber === firstQNum);
    if (flatIdx >= 0) {
      setActiveQuestionIdx(flatIdx);
    }
  };

  const prevPassageIdxRef = useRef<number | null>(null);

  // Auto scroll passage into focus and manage tabs when active question changes
  useEffect(() => {
    if (activeExam) {
      const activePassageIdx = getActivePassageIdx();

      // Scroll that passage container into view smoothly
      const el = passageRefs.current[activePassageIdx];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      // Auto focus passage tab for mobile users when transitioning to a NEW passage section
      if (prevPassageIdxRef.current !== null && prevPassageIdxRef.current !== activePassageIdx) {
        setActiveMobileTab('passage');
        onShowModal({
          type: 'info',
          title: '📖 Đọc đoạn văn mới!',
          message: `Câu hỏi mới dựa trên một đoạn văn mới (Đoạn số ${activePassageIdx + 1}). Hãy đọc kĩ bài khoá trước khi trả lời.`
        });
      }
      prevPassageIdxRef.current = activePassageIdx;
    }
  }, [activeQuestionIdx, activeExam]);

    // Keyboard navigation
  useEffect(() => {
    if (!examActive || !activeExam) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input or textarea
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        setActiveQuestionIdx(prev => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        setActiveQuestionIdx(prev => {
          const flatMapLength = activeExam.passages.reduce((sum, pass) => sum + (pass.questions || []).length, 0);
          return Math.min(flatMapLength - 1, prev + 1);
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [examActive, activeExam]);

  const fetchExams = async () => {
    setLoading(true);
    try {
      const examCol = collection(db, 'exams');
      const snap = await getDocs(examCol);
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Exam));

      let effectiveGradeFilter = currentGradeFilter;
      if (currentUser && currentUser.role === 'student' && currentUser.grade) {
        effectiveGradeFilter = currentUser.grade;
      }

      // Filter by selection
      const filtered = list.filter(e => {
        if (effectiveGradeFilter === 'all') return true;
        return e.grade === parseInt(effectiveGradeFilter, 10);
      });
      setExams(filtered);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
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
    setIsCustomQuiz(false);
    setIsSrsQuiz(false);
    setUserAnswers({});
    setMarkedQuestions({});
    setActiveQuestionIdx(0);
    setTimeRemaining(exam.duration * 60);
    setTotalQuizTime(exam.duration * 60);
    setExamActive(true);
    setGraded(false);
    setFeedbackText('');
    setReportingQNum(null);
  };

  const generateCustomQuiz = () => {
    // Collect all loaded questions matching custom criteria
    let matchingQuestions: { question: Question; passageTitle: string; passageContent: string; vocabularyCategory?: string }[] = [];

    // Prioritize non-recent (we can just shuffle everything and draw up to limit)
    exams.forEach(ex => {
      (ex.passages || []).forEach(pass => {
        const vocabMatches = customVocab === 'all' || pass.vocabularyCategory === customVocab;
        (pass.questions || []).forEach(q => {
          const grammarMatches = customGrammar === 'all' || q.grammarCategory === customGrammar;
          const diffMatches = customDiff === 'all' || q.difficulty === customDiff;
          if (vocabMatches && grammarMatches && diffMatches) {
            matchingQuestions.push({
              question: {
                ...q,
                originalExamId: ex.id,
                originalQuestionNumber: q.questionNumber
              },
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

    // Shuffle questions
    matchingQuestions.sort(() => Math.random() - 0.5);

    // Limit by size
    const finalSize = parseInt(customSize, 10);
    const selectedBatch = matchingQuestions.slice(0, finalSize);

    // Reconstruct into a temporary pseudonumeric exam structure with one question per passage
    const passagesResult: Passage[] = selectedBatch.map((item, idx) => ({
      title: `${item.passageTitle} (Câu hỏi lẻ #${idx + 1})`,
      content: item.passageContent,
      vocabularyCategory: item.vocabularyCategory,
      questions: [{
        ...item.question,
        questionNumber: idx + 1 // override numbering inside this mock assessment
      }]
    }));

    const duration = finalSize === 40 ? 50 : 15;

    const mockExam: Exam = {
      id: `custom_quiz_${Date.now()}`,
      title: `Bài thi tự chọn (${finalSize} Câu hỏi, ${duration} phút)`,
      examName: `Bài thi tự chọn (${finalSize} Câu hỏi, ${duration} phút)`,
      examCode: "RANDOM",
      grade: currentGradeFilter === 'all' ? 10 : parseInt(currentGradeFilter, 10),
      numQuestions: finalSize,
      duration: duration,
      publisher: "Hệ thống tự động biên soạn",
      year: new Date().getFullYear(),
      createdAt: new Date().toISOString(),
      passages: passagesResult
    };

    setActiveExam(mockExam);
    setIsCustomQuiz(true);
    setIsSrsQuiz(false);
    setUserAnswers({});
    setMarkedQuestions({});
    setActiveQuestionIdx(0);
    setTimeRemaining(duration * 60);
    setTotalQuizTime(duration * 60);
    setExamActive(true);
    setGraded(false);
    setFeedbackText('');
    setReportingQNum(null);
  };

  const generateSrsQuiz = (intervalTarget?: number) => {
    // Collect specific interval questions that are due
    const now = new Date();
    
    // items must be pending and (if intervalTarget provided, match it). 
    // And nextReviewDate <= now.
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

    // Shuffle and limit to 40 max
    dueItems.sort(() => Math.random() - 0.5);
    if (dueItems.length > 40) dueItems = dueItems.slice(0, 40);

    let matchingQuestions: { question: Question; passageTitle: string; passageContent: string; vocabularyCategory?: string }[] = [];

    // Find the original questions from exams
    dueItems.forEach(srsItem => {
      const ex = exams.find(e => e.id === srsItem.examId);
      if (ex) {
        (ex.passages || []).forEach(pass => {
          const q = (pass.questions || []).find(qy => qy.questionNumber === srsItem.questionNumber);
          if (q) {
            matchingQuestions.push({
              question: {
                ...q,
                originalExamId: ex.id,
                originalQuestionNumber: q.questionNumber
              },
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

    // Reconstruct into mock exam
    const passagesResult: Passage[] = matchingQuestions.map((item, idx) => ({
      title: `${item.passageTitle} (Câu hỏi ôn luyện #${idx + 1})`,
      content: item.passageContent,
      vocabularyCategory: item.vocabularyCategory,
      questions: [{
        ...item.question,
        questionNumber: idx + 1 
      }]
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
      duration: duration,
      publisher: "Spaced Repetition System",
      year: new Date().getFullYear(),
      createdAt: new Date().toISOString(),
      passages: passagesResult
    };

    setActiveExam(mockExam);
    setIsCustomQuiz(false);
    setIsSrsQuiz(true);
    setUserAnswers({});
    setMarkedQuestions({});
    setActiveQuestionIdx(0);
    setTimeRemaining(duration * 60);
    setTotalQuizTime(duration * 60);
    setExamActive(true);
    setGraded(false);
    setFeedbackText('');
    setReportingQNum(null);
  };

  const getFlatQuestionsList = () => {
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
  };

  const handleSelectOption = (qNum: number, choice: string) => {
    if (graded) return; // ignore if checked
    setUserAnswers(prev => ({
      ...prev,
      [qNum]: choice
    }));
  };

  const toggleMarked = (qNum: number) => {
    setMarkedQuestions(prev => ({
      ...prev,
      [qNum]: !prev[qNum]
    }));
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const submitExam = () => {
    // Use the Custom modal to confirm submit
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

    const questions = getFlatQuestionsList();
    let correctCount = 0;
    const weakGrammar: string[] = [];
    const weakVocab: string[] = [];

    questions.forEach(q => {
      const ans = userAnswers[q.questionNumber];
      if (ans === q.correctAnswer) {
        correctCount++;
      } else {
        // Collect errors
        if (q.grammarCategory) weakGrammar.push(q.grammarCategory);
        
        // Vocab mapping from passage
        const parentPassage = (activeExam.passages || []).find(p => (p.questions || []).some(qy => qy.questionNumber === q.questionNumber));
        if (parentPassage && parentPassage.vocabularyCategory) {
          weakVocab.push(parentPassage.vocabularyCategory);
        }
      }
    });

    const totalCount = questions.length;
    const finalScore = totalCount > 0 ? (correctCount / totalCount) * 10 : 0;
    const timeSpent = totalQuizTime - timeRemaining;

    setScoreSummary({
      score: finalScore,
      correctCount,
      totalCount,
      timeSpent
    });

    // Save results to Cloud Firestore & Update SRS
    try {
      const dbBatch = writeBatch(db);
      const now = new Date();

      questions.forEach(q => {
        const origExamId = q.originalExamId || activeExam.id;
        const origQNumber = q.originalQuestionNumber || q.questionNumber;
        
        const srsItem = srsItems.find(item => item.examId === origExamId && item.questionNumber === origQNumber);
        const ans = userAnswers[q.questionNumber];
        const isCorrect = ans === q.correctAnswer;
        
        if (!isCorrect && ans !== undefined) {
          // Wrong answer -> reset to 3 days (ignore empty answers)
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
          // Upgrading SRS interval
          let nextInterval = 3;
          let newStatus = 'pending';
          let nDate = new Date();
          
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

      if (timeSpent >= 120) {
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
          weakVocab: Array.from(new Set(weakVocab))
        });
      }

      await dbBatch.commit();
      fetchSrsItems();
    } catch (error) {
      console.error("Failed to commit attempt score logs to Firestore:", error);
    }
  };

  const handleReportFeedback = async (event: React.FormEvent) => {
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
    fetchExams();
  };

  const questionsList = getFlatQuestionsList();
  const currentQuestion = questionsList[activeQuestionIdx];

  if (loading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  // Active testing environment
  if (examActive && activeExam && currentQuestion) {
    return (
      <div className="fixed inset-0 bg-slate-100 z-40 flex flex-col antialiased">
        
        {scoreSummary && (
          <div className="absolute inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="bg-indigo-600 p-8 text-center text-white relative">
                <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-md">
                  <Award className="h-10 w-10 text-white" />
                </div>
                <h2 className="text-2xl font-bold font-display tracking-tight mb-2">Hoàn thành bài thi!</h2>
                <p className="text-indigo-100 font-medium">Bạn đã nộp bài thành công</p>
                
                {/* Close/Hide Button */}
                <button 
                  onClick={() => setScoreSummary(null)}
                  className="absolute top-4 right-4 p-2 text-indigo-200 hover:text-white transition-colors cursor-pointer font-bold text-lg"
                >
                  ✕
                </button>
              </div>
              
              <div className="p-8">
                <div className="grid grid-cols-2 gap-4 mb-8">
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Điểm số</p>
                    <p className="text-3xl font-display font-extrabold text-indigo-600">{scoreSummary.score.toFixed(1)} <span className="text-base text-slate-400 font-bold">/ 10</span></p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Số câu đúng</p>
                    <p className="text-3xl font-display font-extrabold text-emerald-600">{scoreSummary.correctCount} <span className="text-base text-slate-400 font-bold">/ {scoreSummary.totalCount}</span></p>
                  </div>
                  <div className="col-span-2 bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center flex justify-between items-center px-8">
                    <p className="text-sm font-bold text-slate-500">Thời gian làm bài:</p>
                    <p className="text-xl font-mono font-bold text-slate-800">
                      {Math.floor(scoreSummary.timeSpent / 60)}:{(scoreSummary.timeSpent % 60).toString().padStart(2, '0')}
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-3">
                  <button
                    onClick={() => setScoreSummary(null)}
                    className="flex-1 py-3 px-4 rounded-xl font-bold text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors border border-slate-200 cursor-pointer"
                  >
                    Xem lại đáp án
                  </button>
                  <button
                    onClick={quitExam}
                    className="flex-1 py-3 px-4 rounded-xl font-bold text-sm bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-200 transition-all cursor-pointer"
                  >
                    Về Trang Chủ
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Testing Header - Fixed */}
        <div className="bg-slate-900 text-white px-4 py-1.5 md:py-2.5 flex flex-col md:flex-row gap-3 items-center justify-between border-b border-slate-800 shadow-md shrink-0">
          <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
            <button
              onClick={quitExam}
              className="px-3 py-1.5 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg text-[11px] font-semibold cursor-pointer shrink-0"
            >
              Thoát luyện tập
            </button>
            <h2 className="text-xs md:text-sm font-bold truncate max-w-[180px] sm:max-w-xs md:max-w-md" title={activeExam.title}>{activeExam.title}</h2>
          </div>

          <div className="flex flex-wrap items-center justify-between md:justify-end gap-3 w-full md:w-auto">
            {/* Cỡ chữ Switcher */}
            <div className="bg-slate-800 p-0.5 rounded-lg border border-slate-700 flex text-[10px] md:text-xs font-bold items-center gap-0.5">
              <span className="text-slate-400 pl-1.5 pr-1 select-none text-[10px]">Cỡ chữ:</span>
              <button
                type="button"
                onClick={() => setPracticeFontSize('sm')}
                className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                  practiceFontSize === 'sm' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Chữ nhỏ"
              >
                A-
              </button>
              <button
                type="button"
                onClick={() => setPracticeFontSize('base')}
                className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                  practiceFontSize === 'base' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Mặc định"
              >
                A
              </button>
              <button
                type="button"
                onClick={() => setPracticeFontSize('lg')}
                className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                  practiceFontSize === 'lg' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Chữ lớn"
              >
                A+
              </button>
              <button
                type="button"
                onClick={() => setPracticeFontSize('xl')}
                className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                  practiceFontSize === 'xl' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Cực lớn"
              >
                A++
              </button>
            </div>

            {/* Giao diện Switcher */}
            <div className="bg-slate-800 p-0.5 rounded-lg border border-slate-700 flex text-[10px] md:text-xs">
              <button
                type="button"
                onClick={() => setLayoutMode('single')}
                className={`px-2.5 py-1.5 rounded-md font-bold transition-all cursor-pointer whitespace-nowrap ${
                  layoutMode === 'single'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Cách 1: Hiển thị từng câu"
              >
                1 Câu 1️⃣
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode('passage_all')}
                className={`px-2.5 py-1.5 rounded-md font-bold transition-all cursor-pointer whitespace-nowrap ${
                  layoutMode === 'passage_all'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Cách 2: Hiển thị cả đoạn"
              >
                Cả đoạn 📚
              </button>
            </div>

            <div className="flex items-center gap-2">
              <div className="bg-slate-800/80 px-2.5 md:px-3 py-1 rounded-xl text-center flex items-center gap-1.5 border border-slate-700">
                <Clock className="h-3.5 w-3.5 text-indigo-400" />
                <span className="font-mono font-bold text-indigo-300 text-xs md:text-sm">{formatTimer(timeRemaining)}</span>
              </div>
              
              {!graded && (
                <button
                  onClick={submitExam}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 rounded-lg text-xs md:text-sm shadow-md active:scale-95 transition-all cursor-pointer shrink-0"
                >
                  Nộp bài
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Mobile View Tab Switcher */}
        <div className="md:hidden flex border-b border-slate-200 bg-white sticky top-0 z-30 shrink-0">
          <button
            type="button"
            onClick={() => setActiveMobileTab('passage')}
            className={`flex-1 py-3 text-center text-xs font-bold border-b-2 transition-all cursor-pointer ${
              activeMobileTab === 'passage'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500'
            }`}
          >
            📖 Đọc bài {(!showAllPassages ? `(Phần ${getActivePassageIdx() + 1})` : `(${activeExam.passages.length})`)}
          </button>
          <button
            type="button"
            onClick={() => setActiveMobileTab('question')}
            className={`flex-1 py-3 text-center text-xs font-bold border-b-2 transition-all cursor-pointer ${
              activeMobileTab === 'question'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500'
            }`}
          >
            ✏️ Trả lời ({activeQuestionIdx + 1}/{questionsList.length})
          </button>
        </div>

        {/* 2-Column Main Workspace */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0 bg-white">
          
          {/* LEFT: Section Passage Reading Area */}
          <div className={`flex-1 md:w-1/2 p-3.5 md:p-4.5 overflow-y-auto border-r border-slate-200 min-h-0 ${
            activeMobileTab === 'passage' ? 'block' : 'hidden md:block'
          }`}>
            {/* Header filters for passages */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-1.5 mb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-indigo-600" />
                <span className="font-bold text-slate-900 text-xs uppercase tracking-wider">Đoạn văn đọc hiểu</span>
              </div>
              <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAllPassages(false)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                    !showAllPassages
                      ? 'bg-white text-indigo-700 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Đoạn liên quan
                </button>
                <button
                  type="button"
                  onClick={() => setShowAllPassages(true)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                    showAllPassages
                      ? 'bg-white text-indigo-700 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Tất cả ({activeExam.passages.length})
                </button>
              </div>
            </div>

            <div className="prose max-w-none space-y-4">
              {activeExam.passages.map((passage, pIdx) => {
                // Determine if this passage contains the active question
                const isPassageActive = (passage.questions || []).some(q => q.questionNumber === currentQuestion.questionNumber);
                
                if (!showAllPassages && !isPassageActive) {
                  return null;
                }

                return (
                  <div
                    key={pIdx}
                    ref={el => { passageRefs.current[pIdx] = el; }}
                    className={`transition-all duration-300 p-3.5 md:p-4 rounded-xl ${
                      isPassageActive ? 'bg-indigo-50/50 border border-indigo-200 shadow-xs ring-4 ring-indigo-500/5' : 'opacity-65'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="bg-indigo-100 text-indigo-700 text-[10px] px-2 py-0.5 rounded-md font-bold uppercase">
                        Sơ đồ {pIdx + 1} {isPassageActive && '🌟 (Đoạn tương ứng)'}
                      </span>
                      {passage.vocabularyCategory && (
                        <span className="bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.5 rounded font-medium">
                          Chủ đề: {passage.vocabularyCategory}
                        </span>
                      )}
                    </div>

                    <h3 className={getPassageTitleClass()}>{passage.title}</h3>
                    <div
                      className={getPassageContentClass()}
                      dangerouslySetInnerHTML={{ __html: passage.content }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT: Active Question Stage */}
          <div className={`flex-1 md:w-1/2 flex flex-col overflow-y-auto p-3.5 md:p-4.5 bg-slate-50 min-h-0 ${
            activeMobileTab === 'question' ? 'flex' : 'hidden md:flex'
          }`}>
            
            {layoutMode === 'passage_all' ? (
              // WAY 2: All questions for current active passage
              <div className="space-y-4 flex-1 flex flex-col min-h-0">
                {/* Passage header controls */}
                <div className="flex items-center justify-between bg-white px-4 py-2 rounded-xl border border-slate-200/60 shadow-xs shrink-0">
                  <div className="text-slate-600 text-xs font-semibold">
                    Đoạn văn <span className="text-slate-900 font-bold">{getActivePassageIdx() + 1}</span> / {activeExam.passages.length}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={getActivePassageIdx() === 0}
                      onClick={() => jumpToPassage(getActivePassageIdx() - 1)}
                      className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold disabled:opacity-40 flex items-center gap-1 transition-all cursor-pointer"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" /> Đoạn trước
                    </button>
                    <button
                      type="button"
                      disabled={getActivePassageIdx() === activeExam.passages.length - 1}
                      onClick={() => jumpToPassage(getActivePassageIdx() + 1)}
                      className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold disabled:opacity-40 flex items-center gap-1 transition-all cursor-pointer"
                    >
                      Đoạn tiếp <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Questions elements container */}
                <div className="space-y-4 flex-1 overflow-y-auto pr-1">
                  {[...(activeExam.passages[getActivePassageIdx()]?.questions || [])].sort((a, b) => a.questionNumber - b.questionNumber).map((q, qIndex) => (
                    <div key={q.questionNumber} className="bg-white p-3.5 md:p-4.5 rounded-xl border border-slate-200/80 shadow-xs space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-150 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="bg-indigo-600 text-white font-extrabold text-[10px] px-2 py-0.5 rounded-md">
                            Câu {q.questionNumber}
                          </span>
                          <span className="bg-slate-100 text-slate-500 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded">
                            CEFR: {q.difficulty}
                          </span>
                          {q.grammarCategory && (
                            <span className="bg-slate-100 text-slate-500 text-[9px] px-1.5 py-0.5 rounded">
                              Ngữ pháp: {q.grammarCategory}
                            </span>
                          )}
                        </div>
                        
                        <button
                          type="button"
                          onClick={() => toggleMarked(q.questionNumber)}
                          className={`text-xs font-bold p-1 rounded-md transition-colors cursor-pointer ${
                            markedQuestions[q.questionNumber] ? 'text-amber-500' : 'text-slate-400 hover:text-slate-600'
                          }`}
                        >
                          <Bookmark className={`h-4 w-4 ${markedQuestions[q.questionNumber] ? 'fill-current' : ''}`} />
                        </button>
                      </div>

                      <h4
                        className={getQuestionTextClass()}
                        dangerouslySetInnerHTML={{ __html: q.text }}
                      />

                      {/* Options */}
                      <div className="grid grid-cols-1 gap-2.5 pt-1.5">
                        {Object.entries(q.options).sort((a, b) => a[0].localeCompare(b[0])).map(([key, value]) => {
                          const isSelected = userAnswers[q.questionNumber] === key;
                          const isCorrect = q.correctAnswer === key;

                          let optionColor = 'border-slate-200 hover:border-indigo-400 bg-white hover:bg-indigo-50/25 text-slate-700';
                          if (isSelected) {
                            optionColor = 'border-indigo-600 bg-indigo-50/40 text-indigo-900 font-bold';
                          }

                          if (graded) {
                            if (isCorrect) {
                              optionColor = 'border-green-500 bg-green-50 text-green-800 font-bold';
                            } else if (isSelected) {
                              optionColor = 'border-red-500 bg-red-50 text-red-800 font-bold';
                            } else {
                              optionColor = 'border-slate-200 bg-white text-slate-400 opacity-60';
                            }
                          }

                          return (
                            <button
                              key={key}
                              onClick={() => handleSelectOption(q.questionNumber, key)}
                              disabled={graded}
                              className={`w-full text-left p-2.5 md:p-3 rounded-lg border flex items-start gap-2.5 transition-all cursor-pointer ${optionColor}`}
                            >
                              <span className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 ${
                                isSelected ? 'bg-indigo-600 text-white' :
                                graded && isCorrect ? 'bg-green-600 text-white' :
                                graded && isSelected ? 'bg-red-600 text-white' :
                                'bg-slate-100 text-slate-600'
                              }`}>
                                {key}
                              </span>
                              <span className={getOptionTextClass()} dangerouslySetInnerHTML={{ __html: value }} />
                            </button>
                          );
                        })}
                      </div>

                      {graded && (
                        <div className="border-t border-slate-100 pt-3 space-y-2.5 mt-2">
                          <div className={`p-3.5 rounded-xl flex gap-2.5 text-xs ${
                            userAnswers[q.questionNumber] === q.correctAnswer
                              ? 'bg-green-50/80 border border-green-200/50 text-green-900'
                              : 'bg-red-50/80 border border-red-200/50 text-red-900'
                          }`}>
                            {userAnswers[q.questionNumber] === q.correctAnswer ? (
                              <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                            )}
                            <div>
                              <p className="font-bold">
                                {userAnswers[q.questionNumber] === q.correctAnswer
                                  ? 'Chính xác! 🎉'
                                  : `Đáp án đúng phải là: ${q.correctAnswer}`}
                              </p>
                              {q.explanation && (
                                <p className="text-slate-600 text-[11px] leading-relaxed mt-1 whitespace-pre-line">
                                  <b>Giải thích:</b> {q.explanation}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Feedback inline */}
                          {reportingQNum !== q.questionNumber ? (
                            <button
                              onClick={() => setReportingQNum(q.questionNumber)}
                              className="text-amber-600 hover:text-amber-800 text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <AlertTriangle className="h-3 w-3" /> Báo lỗi câu hỏi này
                            </button>
                          ) : (
                            <form onSubmit={handleReportFeedback} className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 space-y-2.5 mt-1 animate-in slide-in-from-top-2 duration-150">
                              <p className="text-[10px] text-amber-800 font-bold">Nội dung báo lỗi Câu {q.questionNumber}:</p>
                              <textarea
                                value={feedbackText}
                                onChange={(e) => setFeedbackText(e.target.value)}
                                className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                                placeholder="Có nhầm lẫn ở lời giải, gõ chữ trùng..."
                                rows={2}
                                required
                              />
                              <div className="flex gap-2 justify-end">
                                <button
                                  type="button"
                                  onClick={() => setReportingQNum(null)}
                                  className="bg-white border text-[11px] font-bold px-2.5 py-1 rounded-lg cursor-pointer text-slate-500"
                                >
                                  Hủy
                                </button>
                                <button
                                  type="submit"
                                  className="bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold px-3.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                                >
                                  Gửi phản hồi
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              // WAY 1: Current single question layout
              <>
                {/* Nav Card and Markings */}
                <div className="flex items-center justify-between bg-white px-4 py-1.5 md:py-2 rounded-xl border border-slate-200/60 shadow-xs mb-3 shrink-0">
                  <div className="text-slate-500 text-xs font-semibold">
                    Câu hỏi <span className="text-slate-900 font-bold">{activeQuestionIdx + 1}</span> / {questionsList.length}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => toggleMarked(currentQuestion.questionNumber)}
                      className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                        markedQuestions[currentQuestion.questionNumber]
                          ? 'bg-amber-50 border-amber-300 text-amber-700'
                          : 'bg-white border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Bookmark className={`h-3.5 w-3.5 ${markedQuestions[currentQuestion.questionNumber] ? 'fill-current' : ''}`} />
                      {markedQuestions[currentQuestion.questionNumber] ? 'Đã ghim' : 'Ghim câu hỏi'}
                    </button>
                  </div>
                </div>

                {/* Question Shell */}
                <div className="bg-white p-4 md:p-5 rounded-xl border border-slate-200/80 shadow-xs space-y-4 flex-1 flex flex-col justify-between">
                  
                  <div className="space-y-4">
                    {/* Meta details tag */}
                    <div className="flex flex-wrap gap-1.5 text-[10px]">
                      <span className="bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded">CEFR: {currentQuestion.difficulty}</span>
                      {currentQuestion.grammarCategory && (
                        <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium">Ngữ pháp: {currentQuestion.grammarCategory}</span>
                      )}
                    </div>

                    {/* Content */}
                    <h4
                      className={getQuestionTextClass()}
                      dangerouslySetInnerHTML={{ __html: currentQuestion.text }}
                    />

                    {/* Options list */}
                    <div className="grid grid-cols-1 gap-2.5 pt-2">
                      {Object.entries(currentQuestion.options).sort((a, b) => a[0].localeCompare(b[0])).map(([key, value]) => {
                        const isSelected = userAnswers[currentQuestion.questionNumber] === key;
                        const isCorrect = currentQuestion.correctAnswer === key;

                        let optionColor = 'border-slate-200 hover:border-indigo-400 bg-white hover:bg-indigo-50/20 text-slate-700';
                        if (isSelected) {
                          optionColor = 'border-indigo-600 bg-indigo-50/40 text-indigo-900 font-bold';
                        }

                        if (graded) {
                          if (isCorrect) {
                            optionColor = 'border-green-500 bg-green-50 text-green-800 font-bold';
                          } else if (isSelected) {
                            optionColor = 'border-red-500 bg-red-50 text-red-800 font-bold';
                          } else {
                            optionColor = 'border-slate-200 bg-white text-slate-400 opacity-60';
                          }
                        }

                        return (
                          <button
                            key={key}
                            onClick={() => handleSelectOption(currentQuestion.questionNumber, key)}
                            disabled={graded}
                            className={`w-full text-left p-2.5 md:p-3 rounded-lg border flex items-start gap-2.5 active:scale-99 transition-all cursor-pointer ${optionColor}`}
                            style={{ minHeight: '40px' }}
                          >
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 ${
                              isSelected ? 'bg-indigo-600 text-white' :
                              graded && isCorrect ? 'bg-green-600 text-white' :
                              graded && isSelected ? 'bg-red-600 text-white' :
                              'bg-slate-100 text-slate-600'
                            }`}>
                              {key}
                            </span>
                            <span className={getOptionTextClass()} dangerouslySetInnerHTML={{ __html: value }} />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Explanations & Reporting Panel if Graded */}
                  {graded && (
                    <div className="border-t border-slate-100 pt-6 mt-6 space-y-4">
                      <div className={`p-4 rounded-2xl flex gap-3 ${
                        userAnswers[currentQuestion.questionNumber] === currentQuestion.correctAnswer
                          ? 'bg-green-50/80 border border-green-200/50 text-green-900'
                          : 'bg-red-50/80 border border-red-200/50 text-red-900'
                      }`}>
                        {userAnswers[currentQuestion.questionNumber] === currentQuestion.correctAnswer ? (
                          <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
                        ) : (
                          <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
                        )}
                        <div>
                          <p className="font-bold text-sm">
                            {userAnswers[currentQuestion.questionNumber] === currentQuestion.correctAnswer
                              ? 'Đúng rồi! Tuyệt vời 👏'
                              : `Chưa đúng! Đáp án đúng của bạn phải là ${currentQuestion.correctAnswer}`}
                          </p>
                          {currentQuestion.explanation && (
                            <p className="text-slate-600 text-xs leading-relaxed mt-1 whitespace-pre-line">
                              <b>Giải thích:</b> {currentQuestion.explanation}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Flag / Report error button */}
                      {reportingQNum !== currentQuestion.questionNumber ? (
                        <button
                          onClick={() => setReportingQNum(currentQuestion.questionNumber)}
                          className="text-amber-600 hover:text-amber-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer mt-2"
                        >
                          <AlertTriangle className="h-4 w-4" /> Báo cáo sai sót/phản hồi đáp án này
                        </button>
                      ) : (
                        <form onSubmit={handleReportFeedback} className="p-4 bg-amber-50 rounded-xl border border-amber-200 space-y-3 mt-2 animate-in slide-in-from-top duration-150">
                          <p className="text-xs text-amber-800 font-bold">Nội dung phản hồi cho Câu {currentQuestion.questionNumber}:</p>
                          <textarea
                            value={feedbackText}
                            onChange={(e) => setFeedbackText(e.target.value)}
                            className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                            placeholder="Mô tả cụ thể lý do bạn thấy đáp án chưa chính xác..."
                            rows={3}
                            required
                          />
                          <div className="flex gap-2 justify-end">
                            <button
                              type="button"
                              onClick={() => setReportingQNum(null)}
                              className="bg-white border border-slate-300 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer"
                            >
                              Hủy
                            </button>
                            <button
                              type="submit"
                              className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-4 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer"
                            >
                              <Send className="h-3.5 w-3.5" /> Gửi phản hồi
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  )}

                  {/* Prev / Next navigation shells */}
                  <div className="flex items-center justify-between pt-4 border-t border-slate-100 shrink-0">
                    <button
                      onClick={() => setActiveQuestionIdx(prev => Math.max(0, prev - 1))}
                      disabled={activeQuestionIdx === 0}
                      className="flex items-center gap-1 text-slate-600 hover:text-slate-900 border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 cursor-pointer"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" /> Câu trước
                    </button>
                    <div className="text-[10px] text-slate-400 font-medium font-mono">
                      Mã đề: {activeExam.examCode}
                    </div>
                    <button
                      onClick={() => setActiveQuestionIdx(prev => Math.min(questionsList.length - 1, prev + 1))}
                      disabled={activeQuestionIdx === questionsList.length - 1}
                      className="flex items-center gap-1 bg-slate-900 text-white hover:bg-slate-800 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 cursor-pointer"
                    >
                      Câu tiếp <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>

                </div>
              </>
            )}

            {/* Dashboard Results & Grid Panel */}
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs mt-3.5 shrink-0">
              <h5 className="text-slate-800 font-bold text-xs uppercase tracking-wider mb-2">Danh sách câu hỏi:</h5>
              <div className="flex flex-wrap gap-1.5">
                {questionsList.map((q, idx) => {
                  const isAns = userAnswers[q.questionNumber] !== undefined;
                  const isGhim = markedQuestions[q.questionNumber];
                  const isActive = idx === activeQuestionIdx;

                  let bgBtn = 'bg-white text-slate-700 border-slate-200 hover:border-slate-400';
                  if (isAns) bgBtn = 'bg-indigo-100 text-indigo-700 border-indigo-200 font-bold';
                  if (isGhim) bgBtn = 'bg-amber-100 text-amber-800 border-amber-300 font-bold';
                  if (isActive) bgBtn = 'bg-indigo-600 text-white border-indigo-700 font-bold shadow-xs scale-105';

                  if (graded) {
                    const isRight = userAnswers[q.questionNumber] === q.correctAnswer;
                    if (isRight) {
                      bgBtn = 'bg-green-100 text-green-800 border-green-300 font-bold';
                    } else if (isAns) {
                      bgBtn = 'bg-red-100 text-red-800 border-red-300 font-bold';
                    } else {
                      bgBtn = 'bg-slate-100 text-slate-400 border-slate-200';
                    }
                    if (isActive) {
                      bgBtn += ' ring-2 ring-indigo-500 ring-offset-2';
                    }
                  }

                  return (
                    <button
                      key={q.questionNumber}
                      onClick={() => setActiveQuestionIdx(idx)}
                      className={`w-8 h-8 rounded-lg border text-xs flex items-center justify-center font-bold active:scale-95 transition-all cursor-pointer ${bgBtn}`}
                    >
                      {q.questionNumber}
                    </button>
                  );
                })}
              </div>

              {graded && (
                <div className="mt-3 flex flex-wrap gap-3 items-center justify-between border-t border-slate-150 pt-3 text-xs">
                  <div className="flex gap-3">
                    <span className="flex items-center gap-1.5 text-green-700 font-semibold text-[11px]">
                      <div className="w-2.5 h-2.5 rounded-full bg-green-500" /> Đúng
                    </span>
                    <span className="flex items-center gap-1.5 text-red-700 font-semibold text-[11px]">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-400" /> Sai
                    </span>
                    <span className="flex items-center gap-1.5 text-slate-400 text-[11px]">
                      <div className="w-2.5 h-2.5 rounded-full bg-slate-300" /> Chưa trả lời
                    </span>
                  </div>

                  <button
                    onClick={handleRetake}
                    className="flex items-center gap-1 text-indigo-700 hover:text-indigo-900 border border-indigo-200 hover:bg-indigo-50 text-[10px] sm:text-xs font-bold px-2.5 py-1 rounded-lg transition-all cursor-pointer"
                  >
                    <RefreshCw className="h-3 w-3" /> Luyện tập lại từ đầu
                  </button>
                </div>
              )}
            </div>

          </div>

        </div>

      </div>
    );
  }

  // Lobby lists view
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

            {/* Selection filters */}
            <div className="space-y-4">
              {/* Vocab Theme */}
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

              {/* Grammar Theme */}
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

              {/* CEFR difficulty */}
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

              {/* Layout Size */}
              <div>
                <label className="text-xs font-bold text-indigo-300 uppercase tracking-wider block mb-1">Thời lượng & Số câu hỏi:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCustomSize('40')}
                    className={`p-2.5 rounded-xl border text-xs font-bold text-center transition-all cursor-pointer ${
                      customSize === '40'
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-indigo-950/60 border-indigo-800 text-indigo-300 hover:bg-indigo-950'
                    }`}
                  >
                    40 Câu / 50 phút
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomSize('10')}
                    className={`p-2.5 rounded-xl border text-xs font-bold text-center transition-all cursor-pointer ${
                      customSize === '10'
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-indigo-950/60 border-indigo-800 text-indigo-300 hover:bg-indigo-950'
                    }`}
                  >
                    10 Câu / 15 phút
                  </button>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={generateCustomQuiz}
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
                        onClick={() => generateSrsQuiz(interval)}
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
            onClick={() => generateSrsQuiz()}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3 px-4 rounded-xl text-sm transition-all focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 flex items-center justify-center gap-1.5 active:scale-[0.98] mt-8 cursor-pointer font-sans"
          >
            Làm bài với các câu đến hạn ({srsItems.filter(i => i.status === 'pending' && new Date(i.nextReviewDate) <= new Date()).length}) <ArrowRight className="h-4 w-4 text-emerald-950" />
          </button>
        </div>
      </div>

    </div>
  );
}
