import React, { useEffect, useState, useRef } from 'react';
import { Exam, Passage, Question, QuestionFeedback, VOCABULARY_THEMES, GRAMMAR_THEMES, DIFFICULTY_LEVELS } from '../types';
import { collection, getDocs, doc, updateDoc, deleteDoc, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { 
  Trash2, 
  Edit3, 
  ShieldAlert, 
  AlertTriangle, 
  Eye, 
  HelpCircle, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  ChevronRight, 
  Download, 
  Upload, 
  Plus, 
  Save, 
  FileJson,
  Search,
  Filter,
  ArrowLeft,
  Settings,
  Sparkles,
  Layers,
  Activity,
  Check,
  RotateCcw,
  BookOpen,
  Info,
  Calendar,
  AlertOctagon,
  Languages
} from 'lucide-react';

interface ExamManagerViewProps {
  currentGradeFilter?: string;
  onShowModal: (config: { type: 'success' | 'warning' | 'danger' | 'info' | 'confirm'; title: string; message: string; onConfirm?: () => void; onCancel?: () => void; }) => void;
}

export default function ExamManagerView({ currentGradeFilter = 'all', onShowModal }: ExamManagerViewProps) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [feedbacks, setFeedbacks] = useState<QuestionFeedback[]>([]);
  const [loading, setLoading] = useState(true);

  // Redesigned navigation tabs
  const [activeTab, setActiveTab] = useState<'exams' | 'dedup' | 'feedbacks'>('exams');

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [classificationFilter, setClassificationFilter] = useState('all');
  const [gradeFilter, setGradeFilter] = useState(currentGradeFilter);

  // Student feedback states
  const [feedbackStatusFilter, setFeedbackStatusFilter] = useState<'all' | 'pending' | 'resolved'>('all');

  // Unified Editor States
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [editMode, setEditMode] = useState<'general' | 'detail'>('general');
  const [activePassageIdx, setActivePassageIdx] = useState<number>(0);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [evaluating, setEvaluating] = useState(false);

  const handleAIEvaluateExam = async () => {
    if (!editingExam) return;
    setEvaluating(true);
    try {
      const res = await fetch("/api/gemini/evaluate-exam", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ passages: editingExam.passages }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Có lỗi xảy ra khi gọi AI đánh giá.");
      }

      const evalData = data.evaluation;
      if (!evalData || !Array.isArray(evalData.passages)) {
        throw new Error("Dữ liệu phản hồi từ AI không đúng định dạng mong đợi.");
      }

      // We have mapped evaluation, now let's apply it to the editingExam state
      const updatedPassages = [...editingExam.passages];
      let updatedNumPassages = 0;
      let updatedNumQuestions = 0;

      evalData.passages.forEach((aiPassage: any) => {
        const pIdx = aiPassage.passageIndex;
        if (pIdx >= 0 && pIdx < updatedPassages.length) {
          const originalPassage = updatedPassages[pIdx];
          
          if (aiPassage.vocabularyCategory) {
            originalPassage.vocabularyCategory = aiPassage.vocabularyCategory;
            updatedNumPassages++;
          }

          if (Array.isArray(aiPassage.questions)) {
            aiPassage.questions.forEach((aiQuestion: any) => {
              const qIdx = aiQuestion.questionIndex;
              if (qIdx >= 0 && qIdx < originalPassage.questions.length) {
                const originalQuestion = originalPassage.questions[qIdx];
                if (aiQuestion.difficulty) {
                  originalQuestion.difficulty = aiQuestion.difficulty;
                }
                if (aiQuestion.grammarCategory) {
                  originalQuestion.grammarCategory = aiQuestion.grammarCategory;
                }
                updatedNumQuestions++;
              } else {
                // Try finding by questionNumber
                const foundQ = originalPassage.questions.find(
                  (q) => q.questionNumber === aiQuestion.questionNumber
                );
                if (foundQ) {
                  if (aiQuestion.difficulty) foundQ.difficulty = aiQuestion.difficulty;
                  if (aiQuestion.grammarCategory) foundQ.grammarCategory = aiQuestion.grammarCategory;
                  updatedNumQuestions++;
                }
              }
            });
          }
        }
      });

      setEditingExam({
        ...editingExam,
        passages: updatedPassages,
      });

      onShowModal({
        type: "success",
        title: "Đánh giá lại bằng AI thành công",
        message: `Đã tự động đánh giá và đề xuất phân loại cho ${updatedNumPassages} phân đoạn từ vựng và ${updatedNumQuestions} chủ đề ngữ pháp & độ khó CEFR của các câu hỏi. Vui lòng bấm "Lưu học liệu" để lưu lại vĩnh viễn vào hệ thống!`,
      });
    } catch (err: any) {
      console.error(err);
      onShowModal({
        type: "danger",
        title: "Đánh giá bằng AI thất bại",
        message: err.message || "Không thể hoàn thành việc đánh giá bằng AI.",
      });
    } finally {
      setEvaluating(false);
    }
  };

  // Similarity scanner states
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [duplicates, setDuplicates] = useState<{
    key: string;
    text1: string;
    exam1Title: string;
    exam1Id: string;
    text2: string;
    exam2Title: string;
    exam2Id: string;
    score: number; // percentage similarity
  }[]>([]);

  useEffect(() => {
    fetchExamsAndFlags();
  }, []);

  const fetchExamsAndFlags = async () => {
    setLoading(true);
    try {
      const examCol = collection(db, 'exams');
      const examSnap = await getDocs(examCol);
      const examList = examSnap.docs.map(d => ({ id: d.id, ...d.data() } as Exam));
      setExams(examList);

      const flagCol = collection(db, 'feedbacks');
      const flagSnap = await getDocs(flagCol);
      const flagList = flagSnap.docs.map(d => ({ id: d.id, ...d.data() } as QuestionFeedback));
      // Sort: pending first
      flagList.sort((a, b) => {
        if (a.status === 'pending' && b.status === 'resolved') return -1;
        if (a.status === 'resolved' && b.status === 'pending') return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      setFeedbacks(flagList);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteExam = async (examId: string) => {
    const triggerConfirm = async () => {
      try {
        const snap = await getDocs(collection(db, 'exams'));
        const targetDoc = snap.docs.find(d => d.data().id === examId);
        if (targetDoc) {
          await deleteDoc(doc(db, 'exams', targetDoc.id));
          onShowModal({
            type: 'success',
            title: 'Xóa thành công',
            message: 'Đề thi đã được loại bỏ hoàn toàn khỏi kho lưu trữ.'
          });
          fetchExamsAndFlags();
          if (editingExam?.id === examId) {
            setEditingExam(null);
          }
        }
      } catch (err) {
        console.error(err);
      }
    };

    onShowModal({
      type: 'confirm',
      title: 'Xác nhận xóa đề thi',
      message: 'Bạn có chắc chắn muốn xóa vĩnh viễn đề thi này không? Mọi dữ liệu câu hỏi đi kèm sẽ bị mất hoàn toàn.',
      onConfirm: triggerConfirm
    });
  };

  // Automated Deduplication Similarity Scanner (Word Set Jaccard Overlap)
  const runDeduplicationCheck = () => {
    setScanning(true);
    setScanProgress('Đang tải câu đối sánh học liệu...');
    setDuplicates([]);

    setTimeout(() => {
      setScanProgress('Đang tạo chỉ mục từ câu hỏi...');
      interface ScannedQuestion {
        text: string;
        examTitle: string;
        examId: string;
        num: number;
        contentRef: string;
      }

      const list: ScannedQuestion[] = [];
      exams.forEach(ex => {
        ex.passages.forEach(pass => {
          pass.questions.forEach(q => {
            if (q.text && q.text.trim()) {
              list.push({
                text: q.text.replace(/<[^>]*>/g, '').toLowerCase().trim(),
                examTitle: ex.title,
                examId: ex.id,
                num: q.questionNumber,
                contentRef: q.text
              });
            }
          });
        });
      });

      setScanProgress('Tính toán hệ số trùng khớp Jaccard...');
      const detected: typeof duplicates = [];

      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i].examId === list[j].examId) continue; // Skip same exam

          const text1 = list[i].text;
          const text2 = list[j].text;

          // Exclude placeholders / very short lines from trigger overlap false-positives
          if (text1.length < 15 || text2.length < 15) continue;

          const words1 = new Set(text1.split(/\s+/));
          const words2 = new Set(text2.split(/\s+/));
          const intersection = new Set([...words1].filter(x => words2.has(x)));
          const union = new Set([...words1, ...words2]);
          
          const coefficient = union.size > 0 ? (intersection.size / union.size) * 100 : 0;

          if (coefficient >= 90) {
            detected.push({
              key: `${list[i].examId}_${list[i].num}_${list[j].examId}_${list[j].num}`,
              text1: list[i].contentRef,
              exam1Title: list[i].examTitle,
              exam1Id: list[i].examId,
              text2: list[j].contentRef,
              exam2Title: list[j].examTitle,
              exam2Id: list[j].examId,
              score: Math.round(coefficient)
            });
          }
        }
      }

      setDuplicates(detected);
      setScanning(false);
      onShowModal({
        type: 'success',
        title: 'Hoàn tất quét trùng lặp',
        message: `Đã so sánh ${list.length} câu hỏi. Phát hiện ${detected.length} cặp câu trùng lặp trên 90% cấu trúc từ vựng.`
      });
    }, 1200);
  };

  const handleResolveFeedback = async (fId: string) => {
    try {
      await updateDoc(doc(db, 'feedbacks', fId), { status: 'resolved' });
      onShowModal({
        type: 'success',
        title: 'Đã giải quyết phản hồi',
        message: 'Trạng thái báo cáo lỗi đã được đánh dấu là Đã sửa/Rà soát hoàn thành.'
      });
      fetchExamsAndFlags();
    } catch (err) {
      console.error(err);
    }
  };

  // Jump from feedback board directly to focused edit
  const handleEditFromFeedback = (fb: QuestionFeedback) => {
    const targetExam = exams.find(e => e.id === fb.examId);
    if (!targetExam) {
      onShowModal({
        type: 'danger',
        title: 'Không thể định vị đề thi',
        message: 'Có thể đề thi này đã bị xóa hoặc chỉnh sửa ID trước đó.'
      });
      return;
    }

    // Locate passage & question
    let foundPIdx = 0;
    let found = false;

    for (let pIdx = 0; pIdx < targetExam.passages.length; pIdx++) {
      const pass = targetExam.passages[pIdx];
      const qIdx = pass.questions.findIndex(q => q.questionNumber === fb.questionNumber);
      if (qIdx !== -1) {
        foundPIdx = pIdx;
        found = true;
        break;
      }
    }

    setEditingExam(JSON.parse(JSON.stringify(targetExam)));
    setEditMode('detail');
    setActivePassageIdx(found ? foundPIdx : 0);

    setTimeout(() => {
      const element = document.getElementById(`editor-question-card-${fb.questionNumber}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('ring-2', 'ring-indigo-500', 'bg-indigo-50/30');
        setTimeout(() => {
          element.classList.remove('ring-2', 'ring-indigo-500', 'bg-indigo-50/30');
        }, 5050);
      }
    }, 300);
  };

  // Save General Attributes
  const handleSaveGeneralEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingExam) return;

    try {
      const examDocSnap = await getDocs(collection(db, 'exams'));
      const targetDoc = examDocSnap.docs.find(d => d.data().id === editingExam.id);

      if (targetDoc) {
        await updateDoc(doc(db, 'exams', targetDoc.id), {
          title: editingExam.title,
          examName: editingExam.examName || '',
          examCode: editingExam.examCode || '',
          grade: Number(editingExam.grade) || 10,
          duration: Number(editingExam.duration) || 60,
          publisher: editingExam.publisher || '',
          year: Number(editingExam.year) || new Date().getFullYear(),
          classification: editingExam.classification || 'Đề thi thử từ các đơn vị'
        });

        onShowModal({
          type: 'success',
          title: 'Cập nhật thành công',
          message: `Dữ liệu thuộc tính chung của đề "${editingExam.title}" đã được lưu.`
        });
        setEditingExam(null);
        fetchExamsAndFlags();
      }
    } catch (err) {
      console.error(err);
      onShowModal({
        type: 'danger',
        title: 'Có lỗi xảy ra',
        message: 'Lỗi ghi đè thông tin lên hệ thống Cloud Firestore.'
      });
    }
  };

  // Save detailed curriculum & lists
  const handleSaveDetailEditSubmit = async () => {
    if (!editingExam) return;

    try {
      const examDocSnap = await getDocs(collection(db, 'exams'));
      const targetDoc = examDocSnap.docs.find(d => d.data().id === editingExam.id);

      if (targetDoc) {
        // Compute total questions
        let totalCount = 0;
        editingExam.passages.forEach(p => {
          totalCount += p.questions.length;
        });

        await updateDoc(doc(db, 'exams', targetDoc.id), {
          passages: editingExam.passages,
          numQuestions: totalCount
        });

        onShowModal({
          type: 'success',
          title: 'Lưu cấu trúc đề thi thành công',
          message: `Nội dung chi tiết (${totalCount} câu hỏi) đã được viết thành công vào Firestore.`
        });
        setEditingExam(null);
        fetchExamsAndFlags();
      }
    } catch (err) {
      console.error(err);
      onShowModal({
        type: 'danger',
        title: 'Lỗi đồng bộ',
        message: 'Không thể ghi nhận dữ liệu câu hỏi chi tiết.'
      });
    }
  };

  // Export JSON
  const handleExportJSON = (exam: Exam) => {
    try {
      const exportJson = {
        title: exam.title,
        examName: exam.examName || '',
        examCode: exam.examCode || '',
        grade: exam.grade,
        duration: exam.duration,
        numQuestions: exam.numQuestions,
        publisher: exam.publisher || '',
        year: exam.year || new Date().getFullYear(),
        classification: exam.classification || 'Đề thi thử từ các đơn vị',
        passages: exam.passages.map(p => ({
          title: p.title || '',
          content: p.content || '',
          vocabularyCategory: p.vocabularyCategory || '',
          questions: p.questions.map(q => ({
            questionNumber: q.questionNumber,
            text: q.text,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation || '',
            difficulty: q.difficulty || 'B1',
            grammarCategory: q.grammarCategory || ''
          }))
        }))
      };

      const jsonStr = JSON.stringify(exportJson, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Exam_${exam.examCode || 'CODE'}_${(exam.title || '').replace(/[^a-zA-Z0-9]+/g, '_')}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      onShowModal({
        type: 'success',
        title: 'Xuất đề thi hoàn thành',
        message: 'Xuất tệp tin JSON cấu trúc đề thành công.'
      });
    } catch (e) {
      console.error(e);
    }
  };

  // Import JSON Overwrite
  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>, selectedId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string;
        const parsed = JSON.parse(text);

        if (!parsed.title || !Array.isArray(parsed.passages)) {
          onShowModal({
            type: 'danger',
            title: 'Lỗi cấu trúc tệp',
            message: 'Tệp tải lên thiếu trường "title" hoặc mang "passages" không phải là định dạng mảng.'
          });
          return;
        }

        let totalQCount = 0;
        parsed.passages.forEach((p: any) => {
          if (p.questions) totalQCount += p.questions.length;
        });

        const targetExam = exams.find(ex => ex.id === selectedId);
        if (!targetExam) return;

        const overwriteExam: Exam = {
          ...targetExam,
          title: parsed.title,
          examName: parsed.examName || targetExam.examName,
          examCode: parsed.examCode || targetExam.examCode,
          grade: Number(parsed.grade) || targetExam.grade,
          duration: Number(parsed.duration) || targetExam.duration,
          publisher: parsed.publisher || targetExam.publisher,
          year: Number(parsed.year) || targetExam.year,
          classification: parsed.classification || targetExam.classification || 'Đề thi thử từ các đơn vị',
          passages: parsed.passages,
          numQuestions: totalQCount
        };

        onShowModal({
          type: 'confirm',
          title: 'Xác nhận ghi đè dữ liệu tệp tin',
          message: `Bạn có chắc chắn muốn GHI ĐÈ toàn bộ nội dung của đề thi này bằng dữ liệu tệp tin "${file.name}" không? Hành động này sẽ cập nhật trực tiếp lên Cloud Firestore.`,
          onConfirm: async () => {
            const snap = await getDocs(collection(db, 'exams'));
            const targetDoc = snap.docs.find(d => d.data().id === overwriteExam.id);
            if (targetDoc) {
              await updateDoc(doc(db, 'exams', targetDoc.id), {
                ...overwriteExam
              });
              onShowModal({
                type: 'success',
                title: 'Nạp dữ liệu hoàn tất',
                message: 'Đề thi đã được khôi phục/cập nhật thành công từ tệp JSON mới.'
              });
              fetchExamsAndFlags();
            }
          }
        });

      } catch (err) {
        console.error(err);
        onShowModal({
          type: 'danger',
          title: 'Lỗi nạp tệp JSON',
          message: 'Tệp tin tải lên bị lỗi cấu trúc cú pháp JSON.'
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // State modifiers inside details edit
  const updateGeneralFieldInDetail = (field: keyof Exam, value: any) => {
    if (!editingExam) return;
    setEditingExam({ ...editingExam, [field]: value });
  };

  const updatePassageFieldInDetail = (pIdx: number, field: keyof Passage, value: any) => {
    if (!editingExam) return;
    const list = [...editingExam.passages];
    list[pIdx] = { ...list[pIdx], [field]: value };
    setEditingExam({ ...editingExam, passages: list });
  };

  const updateQuestionFieldInDetail = (pIdx: number, qIdx: number, field: keyof Question, value: any) => {
    if (!editingExam) return;
    const passages = [...editingExam.passages];
    const questions = [...passages[pIdx].questions];
    questions[qIdx] = { ...questions[qIdx], [field]: value };
    passages[pIdx] = { ...passages[pIdx], questions };
    setEditingExam({ ...editingExam, passages });
  };

  const updateQuestionOptionInDetail = (pIdx: number, qIdx: number, key: string, value: string) => {
    if (!editingExam) return;
    const passages = [...editingExam.passages];
    const questions = [...passages[pIdx].questions];
    const options = { ...questions[qIdx].options, [key]: value };
    questions[qIdx] = { ...questions[qIdx], options };
    passages[pIdx] = { ...passages[pIdx], questions };
    setEditingExam({ ...editingExam, passages });
  };

  const addPassageToDetailEdit = () => {
    if (!editingExam) return;
    const newPassage: Passage = {
      title: `Nhóm câu hỏi ${editingExam.passages.length + 1}`,
      content: '',
      vocabularyCategory: VOCABULARY_THEMES[0],
      questions: []
    };
    setEditingExam({ ...editingExam, passages: [...editingExam.passages, newPassage] });
    setActivePassageIdx(editingExam.passages.length);
  };

  const removePassageFromDetailEdit = (pIdx: number) => {
    if (!editingExam) return;
    onShowModal({
      type: 'confirm',
      title: 'Xóa nhóm câu hỏi',
      message: 'Hành động này sẽ xóa phần giải thích đoạn văn này và toàn bộ các câu hỏi thuộc nhóm này. Xác nhận tiếp tục?',
      onConfirm: () => {
        const list = editingExam.passages.filter((_, idx) => idx !== pIdx);
        setEditingExam({ ...editingExam, passages: list });
        setActivePassageIdx(Math.max(0, pIdx - 1));
      }
    });
  };

  const addQuestionToPassageInDetailEdit = (pIdx: number) => {
    if (!editingExam) return;
    let totalQuestions = 0;
    editingExam.passages.forEach(p => {
      totalQuestions += p.questions.length;
    });

    const newQuestion: Question = {
      questionNumber: totalQuestions + 1,
      text: '',
      options: { A: '', B: '', C: '', D: '' },
      correctAnswer: 'A',
      explanation: '',
      difficulty: 'B1',
      grammarCategory: GRAMMAR_THEMES[0]
    };

    const passages = [...editingExam.passages];
    passages[pIdx] = { ...passages[pIdx], questions: [...passages[pIdx].questions, newQuestion] };
    setEditingExam({ ...editingExam, passages });
  };

  const removeQuestionFromPassageInDetailEdit = (pIdx: number, qIdx: number) => {
    if (!editingExam) return;
    const passages = [...editingExam.passages];
    const filteredQs = passages[pIdx].questions.filter((_, idx) => idx !== qIdx);

    // Reindex sequentially
    let startIdx = 1;
    const mappedPassages = passages.map((p, index) => {
      const items = index === pIdx ? filteredQs : p.questions;
      const reindexed = items.map(q => {
        const seqNum = startIdx++;
        return { ...q, questionNumber: seqNum };
      });
      return { ...p, questions: reindexed };
    });

    setEditingExam({ ...editingExam, passages: mappedPassages });
  };

  // Filtering list
  const filteredExams = exams.filter(exam => {
    const matchesGrade = gradeFilter === 'all' || String(exam.grade) === String(gradeFilter);
    const matchesClassification = classificationFilter === 'all' || exam.classification === classificationFilter;
    
    const s = searchQuery.toLowerCase().trim();
    const matchesSearch = !s || 
      (exam.title && exam.title.toLowerCase().includes(s)) ||
      (exam.examName && exam.examName.toLowerCase().includes(s)) ||
      (exam.examCode && exam.examCode.toLowerCase().includes(s)) ||
      (exam.publisher && exam.publisher.toLowerCase().includes(s));

    return matchesGrade && matchesClassification && matchesSearch;
  });

  // Highlight / statistics totals
  const totalExams = exams.length;
  const totalPendingReports = feedbacks.filter(f => f.status === 'pending').length;
  const officialExamsCount = exams.filter(e => e.classification === 'Đề thi chính thức các năm').length;
  const trialExamsCount = exams.filter(e => e.classification === 'Đề thi thử từ các đơn vị').length;
  const prepExamsCount = exams.filter(e => e.classification === 'Đề minh họa theo chủ đề').length;

  // View: Immersive detailed workshop editor is up
  if (editingExam && editMode === 'detail') {
    const passage = editingExam.passages[activePassageIdx];
    return (
      <div className="min-h-screen bg-slate-50/50 pb-20 animate-in fade-in duration-200">
        {/* Workshop Navigation Header Panel */}
        <div className="bg-slate-900 text-white border-b sticky top-0 z-40 px-6 py-4 shadow-md">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="space-y-1">
              <button 
                onClick={() => setEditingExam(null)}
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Quay lại Kho đề thi
              </button>
              <h1 className="text-sm md:text-base font-extrabold flex items-center gap-2">
                <Settings className="h-4 w-4 text-indigo-400" />
                PHÒNG BIÊN TẬP CHI TIẾT HỌC LIỆU
              </h1>
              <p className="text-[11px] text-slate-300 font-mono">
                Đề thi: <span className="text-white font-bold">{editingExam.title}</span> ({editingExam.examCode || "Chưa gán Mã"})
              </p>
            </div>

            <div className="flex gap-2.5 shrink-0 w-full md:w-auto items-center">
              <button
                type="button"
                onClick={() => setEditingExam(null)}
                className="border border-slate-750 px-4 py-2 rounded-xl text-xs font-bold text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Hủy bỏ
              </button>
              
              <button
                type="button"
                onClick={handleAIEvaluateExam}
                disabled={evaluating}
                className={`bg-amber-600 hover:bg-amber-700 text-white border border-amber-500 px-4 py-2 rounded-xl text-xs font-extrabold cursor-pointer transition-all active:scale-97 shadow-md flex items-center justify-center gap-1.5 ${evaluating ? 'opacity-60 cursor-not-allowed animate-pulse' : ''}`}
                title="Đánh giá lại chủ đề từ vựng nhóm, chủ đề ngữ pháp & độ khó CEFR các câu hỏi bằng AI"
              >
                <Sparkles className={`h-4 w-4 ${evaluating ? 'animate-spin' : 'text-amber-200'}`} />
                {evaluating ? "Đang AI Đánh giá..." : "Đánh giá lại bằng AI ⚡"}
              </button>

              <button
                type="button"
                onClick={handleSaveDetailEditSubmit}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-xl text-xs font-extrabold cursor-pointer transition-all active:scale-97 shadow-md flex items-center justify-center gap-1.5"
              >
                <Save className="h-4 w-4" /> Lưu học liệu ✔
              </button>
            </div>
          </div>
        </div>

        {/* Workspace core */}
        <div className="max-w-7xl mx-auto px-4 md:px-6 pt-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Left sidebar: Passages menu */}
            <div className="lg:col-span-4 space-y-4">
              <div className="bg-white p-5 rounded-3xl border border-slate-200/60 shadow-xs space-y-4">
                <div className="flex justify-between items-center pb-2 border-b">
                  <h3 className="font-extrabold text-xs uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-indigo-500" /> Nhóm học liệu / Đọc hiểu
                  </h3>
                  <span className="text-[10px] font-bold font-mono bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded">
                    {editingExam.passages.length} Phân đoạn
                  </span>
                </div>

                <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                  {editingExam.passages.map((p, idx) => (
                    <div 
                      key={idx}
                      onClick={() => setActivePassageIdx(idx)}
                      className={`p-3 rounded-xl border flex justify-between items-center cursor-pointer transition-all ${
                        activePassageIdx === idx 
                          ? 'border-indigo-500 bg-indigo-50/50 hover:bg-indigo-50 shadow-3xs' 
                          : 'border-slate-100 hover:bg-slate-50'
                      }`}
                    >
                      <div className="space-y-1 text-left flex-1 min-w-0 pr-2">
                        <p className="font-bold text-xs truncate text-slate-900">
                          #{idx + 1}. {p.title || `Nhóm câu hỏi ${idx + 1}`}
                        </p>
                        <p className="text-[10px] text-slate-400 font-mono">
                          {p.questions.length} câu hỏi • {p.vocabularyCategory || "Chủ đề: Tự do"}
                        </p>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                    </div>
                  ))}
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={addPassageToDetailEdit}
                    className="w-full bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border border-slate-200 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="h-4 w-4 text-indigo-500" /> + Đăng ký Nhóm mới
                  </button>
                </div>
              </div>

              {/* Utility guides */}
              <div className="bg-indigo-50/30 p-5 rounded-3xl border border-indigo-100/40 text-xs space-y-2">
                <h4 className="font-bold text-indigo-900 flex items-center gap-1.5">
                  <Info className="h-4 w-4 text-indigo-600" /> Cẩm nang biên tập sư
                </h4>
                <ul className="list-disc pl-4 space-y-1.5 text-slate-600 leading-relaxed">
                  <li>Sử dụng các thẻ HTML cơ bản như <code className="bg-white px-1 py-0.5 rounded border">&lt;b&gt;</code> hoặc <code className="bg-white px-1 py-0.5 rounded border">&lt;u&gt;</code> để cấu trúc đoạn văn, bài đọc lỗ.</li>
                  <li>Mã câu hỏi tự lập thứ tự động bộ thống nhất trên toàn đề thi.</li>
                  <li>Lời giải chi tiết giúp tự bồi dưỡng kiến thức hổng.</li>
                </ul>
              </div>
            </div>

            {/* Right Work panel: Current Passage detail & questions */}
            <div className="lg:col-span-8 space-y-6">
              {passage ? (
                <div className="space-y-6 animate-in fade-in duration-200">
                  
                  {/* Selected Passage properties */}
                  <div className="bg-white p-6 rounded-3xl border border-slate-200/60 shadow-xs space-y-4 relative">
                    <div className="flex justify-between items-center border-b pb-3">
                      <div>
                        <span className="text-[9px] font-mono font-black text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded">CHI TIẾT NHÓM #{activePassageIdx + 1}</span>
                        <h3 className="font-extrabold text-slate-900 text-sm mt-1">{passage.title || `Nhóm câu hỏi ${activePassageIdx + 1}`}</h3>
                      </div>
                      {editingExam.passages.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePassageFromDetailEdit(activePassageIdx)}
                          className="text-xs bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-100 px-2.5 py-1.5 rounded-lg flex items-center gap-1 font-bold cursor-pointer transition-all"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Gỡ nhóm này
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-bold text-slate-700">
                      <div>
                        <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Tên Nhóm/Đoạn văn (title):</label>
                        <input
                          type="text"
                          value={passage.title || ''}
                          onChange={(e) => updatePassageFieldInDetail(activePassageIdx, 'title', e.target.value)}
                          className="w-full border p-2.5 rounded-xl font-bold bg-slate-50 text-xs focus:ring-1 focus:ring-indigo-500"
                          placeholder="Ví dụ: Reading Passage 1"
                        />
                      </div>

                      <div>
                        <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Nhóm Từ vựng liên quan (vocabularyCategory):</label>
                        <select
                          value={passage.vocabularyCategory || ''}
                          onChange={(e) => updatePassageFieldInDetail(activePassageIdx, 'vocabularyCategory', e.target.value)}
                          className="w-full border p-2.5 rounded-xl font-bold bg-slate-50 text-xs focus:ring-1 focus:ring-indigo-500 text-slate-800"
                        >
                          <option value="">-- Tự do (Không phân nhóm từ vựng) --</option>
                          {VOCABULARY_THEMES.map(v => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      </div>

                      <div className="md:col-span-2">
                        <div className="flex justify-between items-center mb-1">
                          <label className="block text-slate-400 uppercase tracking-wider text-[9px]">Văn bản bài đọc / Hướng dẫn đề thi (content):</label>
                          <span className="text-[10px] font-mono text-slate-400">
                            Số từ: {passage.content ? passage.content.split(/\s+/).filter(Boolean).length : 0} từ
                          </span>
                        </div>
                        <textarea
                          value={passage.content || ''}
                          onChange={(e) => updatePassageFieldInDetail(activePassageIdx, 'content', e.target.value)}
                          className="w-full font-mono text-xs border p-3 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-indigo-500 bg-slate-50 font-normal leading-relaxed"
                          rows={6}
                          placeholder="Điền đoạn văn bản đọc hiểu tiếng Anh hoặc chỉ dẫn ngữ pháp..."
                        />
                      </div>
                    </div>
                  </div>

                  {/* List of Questions in active passage */}
                  <div className="space-y-4">
                    <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200/60 shadow-3xs">
                      <h4 className="font-extrabold text-xs text-slate-900 uppercase">Danh sách câu hỏi liên đới ({passage.questions.length} câu)</h4>
                      <button
                        type="button"
                        onClick={() => addQuestionToPassageInDetailEdit(activePassageIdx)}
                        className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer transition-all border border-indigo-100"
                      >
                        <Plus className="h-3.5 w-3.5" /> + Tạo câu hỏi mới
                      </button>
                    </div>

                    {passage.questions.length === 0 ? (
                      <div className="text-center py-12 bg-white rounded-3xl border border-dashed text-slate-400 text-xs font-bold">
                        Đoạn này hiện chưa có câu hỏi nào. Nhấn "+ Tạo câu hỏi mới" phía trên để nạp.
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {passage.questions.map((q, qIdx) => (
                          <div 
                            key={qIdx}
                            id={`editor-question-card-${q.questionNumber}`}
                            className="bg-white p-6 rounded-3xl border border-slate-200 hover:shadow-2xs transition-all space-y-4 relative scroll-mt-24"
                          >
                            <div className="flex justify-between items-center border-b pb-2">
                              <span className="bg-slate-900 text-white font-mono text-[10px] font-extrabold px-3 py-0.5 rounded-md uppercase">
                                Câu hỏi #{q.questionNumber}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeQuestionFromPassageInDetailEdit(activePassageIdx, qIdx)}
                                className="text-slate-400 hover:text-rose-600 font-bold text-xs flex items-center gap-1 cursor-pointer transition-all"
                                title="Xóa câu hỏi này"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Gỡ câu
                              </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-bold text-slate-700">
                              <div className="md:col-span-2">
                                <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Nội dung câu hỏi (text - Hỗ trợ HTML):</label>
                                <textarea
                                  value={q.text || ''}
                                  onChange={(e) => updateQuestionFieldInDetail(activePassageIdx, qIdx, 'text', e.target.value)}
                                  className="w-full border p-2.5 rounded-xl font-normal text-xs bg-slate-50 focus:ring-1 focus:ring-indigo-500 font-mono"
                                  rows={2.5}
                                  placeholder="Nhập nội dung câu hỏi..."
                                />
                                {q.text && (
                                  <div className="mt-2 bg-slate-50 p-2.5 text-[11px] font-normal border rounded-xl leading-relaxed text-slate-600">
                                    <span className="text-[10px] font-bold text-indigo-600 block mb-0.5 font-sans uppercase">Hình ảnh hiển thị học sinh:</span>
                                    <div dangerouslySetInnerHTML={{ __html: q.text }} />
                                  </div>
                                )}
                              </div>

                              {/* Choices Options Grid */}
                              <div className="md:col-span-2 p-4 bg-slate-50/50 rounded-2xl border border-dashed space-y-3">
                                <span className="block text-indigo-700 text-[10px] uppercase font-extrabold tracking-wider mb-1">Danh sách lựa chọn đáp án:</span>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                  {['A', 'B', 'C', 'D'].map(optKey => (
                                    <div key={optKey}>
                                      <label className="block text-slate-400 text-[9px] mb-0.5">Lựa chọn ({optKey}):</label>
                                      <input
                                        type="text"
                                        value={q.options[optKey] || ''}
                                        onChange={(e) => updateQuestionOptionInDetail(activePassageIdx, qIdx, optKey, e.target.value)}
                                        className="w-full border px-3 py-2 rounded-xl font-normal bg-white text-xs focus:ring-1 focus:ring-indigo-500"
                                        placeholder={`Đáp án ${optKey}`}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Dropdowns */}
                              <div>
                                <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Đáp án Đúng:</label>
                                <select
                                  value={q.correctAnswer || 'A'}
                                  onChange={(e) => updateQuestionFieldInDetail(activePassageIdx, qIdx, 'correctAnswer', e.target.value)}
                                  className="w-full border p-2.5 rounded-xl font-bold bg-slate-50 text-xs focus:ring-1 focus:ring-indigo-500 text-slate-800"
                                >
                                  <option value="A">A</option>
                                  <option value="B">B</option>
                                  <option value="C">C</option>
                                  <option value="D">D</option>
                                </select>
                              </div>

                              <div>
                                <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Cấp độ khó (CEFR Difficulty):</label>
                                <select
                                  value={q.difficulty || 'B1'}
                                  onChange={(e) => updateQuestionFieldInDetail(activePassageIdx, qIdx, 'difficulty', e.target.value)}
                                  className="w-full border p-2.5 rounded-xl font-bold bg-slate-50 text-xs focus:ring-1 focus:ring-indigo-500 text-slate-800"
                                >
                                  {DIFFICULTY_LEVELS.map(dl => (
                                    <option key={dl} value={dl}>{dl}</option>
                                  ))}
                                </select>
                              </div>

                              <div className="md:col-span-2">
                                <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Phân khúc Ngữ pháp (grammarCategory):</label>
                                <select
                                  value={q.grammarCategory || ''}
                                  onChange={(e) => updateQuestionFieldInDetail(activePassageIdx, qIdx, 'grammarCategory', e.target.value)}
                                  className="w-full border p-2.5 rounded-xl font-bold bg-slate-50 text-xs focus:ring-1 focus:ring-indigo-500 text-slate-800"
                                >
                                  <option value="">-- Chọn chủ đề ngữ pháp --</option>
                                  {GRAMMAR_THEMES.map(gt => (
                                    <option key={gt} value={gt}>{gt}</option>
                                  ))}
                                </select>
                              </div>

                              <div className="md:col-span-2">
                                <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Diễn dịch giải chi tiết / Dịch nghĩa học máy (explanation):</label>
                                <textarea
                                  value={q.explanation || ''}
                                  onChange={(e) => updateQuestionFieldInDetail(activePassageIdx, qIdx, 'explanation', e.target.value)}
                                  className="w-full border p-2.5 rounded-xl font-normal text-xs bg-slate-50 focus:ring-1 focus:ring-indigo-500"
                                  rows={2.5}
                                  placeholder="Điền lý luận chọn đáp án đúng..."
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
              ) : (
                <div className="py-20 text-center text-slate-400 bg-white rounded-3xl border border-dashed p-6 font-bold text-xs">
                  Không tìm thấy nhóm học liệu đã chọn. Vui lòng nhấp vào các đoạn văn ở tab bên trái.
                </div>
              )}
            </div>

          </div>
        </div>

      </div>
    );
  }

  // View: General info edit form
  if (editingExam && editMode === 'general') {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
        <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-2xl w-full overflow-hidden flex flex-col my-8">
          <div className="px-6 py-4 bg-slate-900 text-white flex justify-between items-center shrink-0">
            <div>
              <span className="text-[10px] font-black tracking-wider uppercase bg-indigo-500 text-white px-2 py-0.5 rounded">BIÊN TẬP THUỘC TÍNH CỐT LÕI</span>
              <h2 className="font-extrabold text-sm md:text-base mt-1 truncate max-w-md">Đề thi: {editingExam.title}</h2>
            </div>
            <button 
              onClick={() => setEditingExam(null)}
              className="text-slate-400 hover:text-white text-2xl transition-all cursor-pointer"
            >
              ×
            </button>
          </div>

          <form onSubmit={handleSaveGeneralEditSubmit} className="p-6 overflow-y-auto space-y-4 text-xs font-bold text-slate-700 flex-1">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Tiêu đề đề thi (title):</label>
                <input
                  type="text"
                  required
                  value={editingExam.title || ''}
                  onChange={(e) => updateGeneralFieldInDetail('title', e.target.value)}
                  className="w-full border p-2.5 rounded-xl font-bold bg-slate-50 text-xs focus:ring-1 focus:ring-indigo-500"
                  placeholder="Tiêu đề hiển thị..."
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Tên kỳ thi (examName):</label>
                <input
                  type="text"
                  value={editingExam.examName || ''}
                  onChange={(e) => updateGeneralFieldInDetail('examName', e.target.value)}
                  className="w-full border p-2.5 rounded-xl font-bold bg-slate-50 text-xs focus:ring-1 focus:ring-indigo-500"
                  placeholder="Kỳ thi tuyển sinh môn Tiếng Anh Hà Nội..."
                />
              </div>

              <div>
                <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Mã đề thi (examCode):</label>
                <input
                  type="text"
                  required
                  value={editingExam.examCode || ''}
                  onChange={(e) => updateGeneralFieldInDetail('examCode', e.target.value)}
                  className="w-full border p-2.5 rounded-xl font-bold bg-slate-50 text-xs focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Cấp lớp học (grade):</label>
                <select
                  value={editingExam.grade || 10}
                  onChange={(e) => updateGeneralFieldInDetail('grade', Number(e.target.value))}
                  className="w-full border p-2.5 rounded-xl font-bold bg-slate-50 text-xs focus:ring-1 focus:ring-indigo-500 text-slate-800"
                >
                  <option value={6}>Lớp 6</option>
                  <option value={10}>Lớp 10</option>
                  <option value={12}>Lớp 12</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Năm phát hành (year):</label>
                <input
                  type="number"
                  required
                  value={editingExam.year || new Date().getFullYear()}
                  onChange={(e) => updateGeneralFieldInDetail('year', Number(e.target.value))}
                  className="w-full border p-2.5 rounded-xl font-bold bg-slate-50 text-xs focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Thời lượng (phút):</label>
                <input
                  type="number"
                  required
                  value={editingExam.duration || 60}
                  onChange={(e) => updateGeneralFieldInDetail('duration', Number(e.target.value))}
                  className="w-full border p-2.5 rounded-xl font-bold bg-slate-50 text-xs focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Đơn vị ban hành (publisher):</label>
                <input
                  type="text"
                  value={editingExam.publisher || ''}
                  onChange={(e) => updateGeneralFieldInDetail('publisher', e.target.value)}
                  className="w-full border p-2.5 rounded-xl font-bold bg-slate-50 text-xs focus:ring-1 focus:ring-indigo-500"
                  placeholder="Sở GD&ĐT Hà Nội, THPT Chuyên..."
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-indigo-500 uppercase tracking-wider text-[9px] mb-1 font-extrabold">PHÂN LOẠI NHÓM ĐỀ THI (classification):</label>
                <select
                  value={editingExam.classification || 'Đề thi thử từ các đơn vị'}
                  onChange={(e) => updateGeneralFieldInDetail('classification', e.target.value)}
                  className="w-full border p-2.5 rounded-xl font-bold bg-slate-50 text-xs focus:ring-1 focus:ring-indigo-500 text-slate-800"
                >
                  <option value="Đề thi chính thức các năm">Đề thi chính thức các năm</option>
                  <option value="Đề thi thử từ các đơn vị">Đề thi thử từ các đơn vị</option>
                  <option value="Đề minh họa theo chủ đề">Đề minh họa theo chủ đề</option>
                </select>
              </div>
            </div>

            <div className="px-1 py-4 bg-slate-50 border-t flex justify-end gap-3 shrink-0 rounded-b-2xl">
              <button
                type="button"
                onClick={() => setEditingExam(null)}
                className="bg-white border px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold px-5 py-2 rounded-xl text-xs cursor-pointer shadow-xs"
              >
                Cập nhật thông tin ✔
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // View: General Dashboard Layout (Grid + Tabs)
  return (
    <div className="space-y-10 pb-12 animate-in fade-in duration-200">
      
      {/* Redesigned TOP Metrics Stats bar widgets */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        
        <div className="bg-white border border-slate-200/60 p-5 rounded-3xl shadow-2xs flex flex-col justify-between">
          <div>
            <span className="text-[10px] font-mono font-bold uppercase text-slate-400">TỔNG ĐỀ THI</span>
            <h3 className="text-2xl font-black font-display text-slate-900 mt-1 tracking-tight">{totalExams}</h3>
          </div>
          <div className="mt-3 text-[10px] text-slate-500 font-semibold flex items-center justify-between border-t pt-2 gap-1 flex-wrap">
            <span>C.Thức: <b className="text-amber-650">{officialExamsCount}</b></span>
            <span>Thử: <b className="text-indigo-650">{trialExamsCount}</b></span>
            <span>M.Họa: <b className="text-emerald-650">{prepExamsCount}</b></span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/60 p-5 rounded-3xl shadow-2xs flex flex-col justify-between">
          <div>
            <span className="text-[10px] font-mono font-bold uppercase text-slate-400">PHẢN HỒI LỖI</span>
            <div className="flex items-baseline gap-2 mt-1">
              <h3 className="text-2xl font-black font-display text-slate-900 tracking-tight">
                {totalPendingReports}
              </h3>
              <span className="text-[11px] font-bold text-amber-600">chưa duyệt</span>
            </div>
          </div>
          <div className="mt-3 text-[10px] text-slate-500 font-semibold border-t pt-2 flex items-center gap-1">
            <ShieldAlert className="h-3 w-3 text-amber-500 shrink-0" />
            <span>Hãy ưu tiên rà soát học liệu</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/60 p-5 rounded-3xl shadow-2xs flex flex-col justify-between">
          <div>
            <span className="text-[10px] font-mono font-bold uppercase text-slate-400">HỌC LIỆU TRÙNG LẶP</span>
            <h3 className="text-2xl font-black font-display text-slate-900 mt-1 tracking-tight">
              {duplicates.length > 0 ? duplicates.length : 'N/A'}
            </h3>
          </div>
          <div className="mt-3 text-[10px] text-slate-500 font-semibold border-t pt-2 flex items-center gap-1.5 justify-between">
            <span>Trùng lặp: <b className="text-rose-600 font-bold">{duplicates.length}</b> cặp</span>
            <button 
              onClick={() => setActiveTab('dedup')}
              className="text-[10px] text-indigo-600 font-black hover:underline cursor-pointer"
            >
              Quét lại
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200/60 p-5 rounded-3xl shadow-2xs flex flex-col justify-between">
          <div>
            <span className="text-[10px] font-mono font-bold uppercase text-slate-400">HIỆN TRẠNG CHUNG</span>
            <div className="flex items-center gap-1.5 mt-1">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              <span className="text-xs font-extrabold text-emerald-600">Cơ sở dữ liệu ổn định</span>
            </div>
          </div>
          <div className="mt-3 text-[10px] text-slate-500 font-semibold border-t pt-2 max-w-full truncate">
            <span>Server: Cloud Run active ingress</span>
          </div>
        </div>

      </div>

      {/* Primary Tab Headers Workspace menu bar */}
      <div className="flex border-b border-slate-200 gap-2 pb-px overflow-x-auto">
        <button
          onClick={() => setActiveTab('exams')}
          className={`pb-3 px-4 text-xs font-extrabold transition-all border-b-2 whitespace-nowrap cursor-pointer inline-flex items-center gap-2 ${
            activeTab === 'exams'
              ? 'border-indigo-600 text-indigo-600 font-black'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <BookOpen className="h-4 w-4" /> Kho lưu trữ đề thi
        </button>
        <button
          onClick={() => setActiveTab('dedup')}
          className={`pb-3 px-4 text-xs font-extrabold transition-all border-b-2 whitespace-nowrap cursor-pointer inline-flex items-center gap-2 ${
            activeTab === 'dedup'
              ? 'border-indigo-600 text-indigo-600 font-black'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Layers className="h-4 w-4" /> Đối sánh & Phát hiện trùng lặp
        </button>
        <button
          onClick={() => {
            setActiveTab('feedbacks');
            setFeedbackStatusFilter('pending');
          }}
          className={`pb-3 px-4 text-xs font-extrabold transition-all border-b-2 whitespace-nowrap cursor-pointer inline-flex items-center gap-2 relative ${
            activeTab === 'feedbacks'
              ? 'border-indigo-600 text-indigo-600 font-black'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <ShieldAlert className="h-4 w-4" /> Nhật ký Báo lỗi học sinh
          {totalPendingReports > 0 && (
            <span className="absolute top-0 right-0 bg-rose-600 text-white font-bold rounded-full w-4 h-4 text-[9px] flex items-center justify-center animate-pulse">
              {totalPendingReports}
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: KHO LƯU TRỮ ĐỀ THI */}
      {activeTab === 'exams' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          
          {/* Interactive Search Tool & Filters card panel */}
          <div className="bg-white p-5 rounded-3xl border border-slate-200/60 shadow-3xs space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              
              {/* Search text box input */}
              <div className="md:col-span-6 relative">
                <Search className="absolute left-3.5 top-3 text-slate-400 h-4 w-4" />
                <input
                  type="text"
                  placeholder="Tìm kiếm đề thi bằng tiêu đề, mã đề, nhà xuất bản, nguồn đề..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs font-semibold pl-10 pr-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 placeholder-slate-400"
                />
              </div>

              {/* Classification category filter selector dropdown */}
              <div className="md:col-span-3">
                <select
                  value={classificationFilter}
                  onChange={(e) => setClassificationFilter(e.target.value)}
                  className="w-full text-xs font-bold py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl text-slate-700"
                >
                  <option value="all">Tất cả Phân nhóm đề</option>
                  <option value="Đề thi chính thức các năm">Đề thi chính thức các năm</option>
                  <option value="Đề thi thử từ các đơn vị">Đề thi thử từ các đơn vị</option>
                  <option value="Đề minh họa theo chủ đề">Đề minh họa theo chủ đề</option>
                </select>
              </div>

              {/* Grade Level filter selector dropdown */}
              <div className="md:col-span-3">
                <select
                  value={gradeFilter}
                  onChange={(e) => setGradeFilter(e.target.value)}
                  className="w-full text-xs font-bold py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl text-slate-700"
                >
                  <option value="all">Tất cả các Lớp (6, 10, 12)</option>
                  <option value="6">Chỉ Lớp 6</option>
                  <option value="10">Chỉ Lớp 10</option>
                  <option value="12">Chỉ Lớp 12</option>
                </select>
              </div>

            </div>

            <div className="flex justify-between items-center text-[10px] text-slate-400 font-semibold font-mono border-t pt-3">
              <span>Đang kết nối: Cloud Firestore Database</span>
              <span className="text-indigo-600 font-bold">Tìm được {filteredExams.length} kì thi phù hợp</span>
            </div>
          </div>

          {/* Exams list container */}
          {loading ? (
            <div className="py-20 text-center animate-pulse text-slate-400 text-xs font-bold font-mono">
              Đang truy xuất thông tin đề thi tiếng Anh...
            </div>
          ) : filteredExams.length === 0 ? (
            <div className="bg-white p-12 text-center rounded-3xl border border-dashed text-slate-400 text-xs font-bold space-y-2">
              <AlertCircle className="h-8 w-8 text-slate-350 mx-auto" />
              <p>Ủa! Không tìm thấy kết quả đề thi nào phù hợp với các tiêu chí tìm kiếm rà soát của bạn.</p>
              <button 
                onClick={() => { setSearchQuery(''); setClassificationFilter('all'); setGradeFilter('all'); }}
                className="text-indigo-650 text-[10px] underline hover:text-indigo-800 block mx-auto cursor-pointer"
              >
                Nhấp để Đặt lại bộ lọc
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {filteredExams.map(exam => {
                // Colors representing grades
                let gradeStyle = "bg-teal-50 text-teal-700 border border-teal-100";
                if (exam.grade === 10) gradeStyle = "bg-purple-50 text-purple-700 border border-purple-100";
                if (exam.grade === 12) gradeStyle = "bg-indigo-50 text-indigo-700 border border-indigo-100";

                return (
                  <div 
                    key={exam.id} 
                    className="p-5 bg-white border border-slate-200/60 hover:border-indigo-400 rounded-3xl hover:shadow-xs transition-all flex flex-col justify-between space-y-4 group"
                  >
                    <div className="space-y-2.5">
                      {/* Top tags Row */}
                      <div className="flex flex-wrap gap-1.5 items-center">
                        <span className={`text-[9px] font-mono tracking-wider uppercase font-black px-2 py-0.5 rounded ${gradeStyle}`}>
                          LỚP {exam.grade}
                        </span>
                        <span className="bg-slate-100 text-slate-600 text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase">
                          MÃ: {exam.examCode}
                        </span>
                        <span className="bg-slate-100 text-slate-600 text-[9px] font-mono font-bold px-2 py-0.5 rounded">
                          Năm: {exam.year}
                        </span>
                        {exam.classification && (
                          <span className="bg-amber-50 text-amber-800 border border-amber-100 text-[8px] md:text-[9px] font-bold px-2 py-0.5 rounded-md">
                            {exam.classification}
                          </span>
                        )}
                      </div>

                      {/* Header Title */}
                      <h4 className="font-extrabold text-sm text-slate-900 group-hover:text-indigo-600 transition-colors leading-relaxed line-clamp-2 h-10">
                        {exam.examName || exam.title}
                      </h4>

                      {/* Publisher unit & counts info */}
                      <div className="text-[11px] text-slate-400 space-y-1 font-semibold leading-normal pb-3 border-b border-dashed border-slate-100">
                        <p>Nguồn phát hành: <b className="text-slate-600 font-bold">{exam.publisher || "Chưa định nguồn sản xuất"}</b></p>
                        <p className="flex items-center gap-1.5 font-mono text-[10px]">
                          <span>Khuôn khổ: <b>{exam.numQuestions} câu hỏi</b></span>
                          <span>•</span>
                          <span>Thành phần: <b>{exam.passages.length} nhóm đọc hiểu</b></span>
                          <span>•</span>
                          <span>Thời lượng: <b>{exam.duration} phút</b></span>
                        </p>
                      </div>
                    </div>

                    {/* Integrated Grid of Explicit Action buttons */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                      <button
                        onClick={() => { setEditingExam(exam); setEditMode('general'); }}
                        className="bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 font-bold px-2.5 py-2 rounded-xl transition-all border border-slate-200 cursor-pointer flex items-center justify-center gap-1 text-[11px]"
                        title="Thay đổi các thông tin chung cốt lõi như tên, mã, lớp, năm..."
                      >
                        <Edit3 className="h-3 w-3 text-indigo-500" /> Sửa chung
                      </button>

                      <button
                        onClick={() => { setEditingExam(exam); setEditMode('detail'); setActivePassageIdx(0); }}
                        className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 hover:text-indigo-900 font-bold px-2.5 py-2 rounded-xl transition-all border border-indigo-100 cursor-pointer flex items-center justify-center gap-1 text-[11px]"
                        title="Biên tập chi tiết nội dung đoạn văn, câu hỏi, đáp án lựa chọn..."
                      >
                        <Settings className="h-3 w-3 text-indigo-600" /> Sửa câu hỏi
                      </button>

                      <button
                        onClick={() => handleExportJSON(exam)}
                        className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold px-2 py-2 rounded-xl transition-all border border-emerald-100 cursor-pointer flex items-center justify-center gap-1 text-[11px]"
                        title="Xuất đề thi ra file JSON"
                      >
                        <Download className="h-3 w-3" /> Xuất file
                      </button>

                      <button
                        onClick={() => handleDeleteExam(exam.id)}
                        className="bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold px-2 py-2 rounded-xl border border-rose-100 cursor-pointer flex items-center justify-center gap-1 text-[11px]"
                        title="Xóa vĩnh viễn đề thi"
                      >
                        <Trash2 className="h-3 side w-3" /> Xóa đề
                      </button>
                    </div>

                    {/* Fast JSON replace handler underneath */}
                    <div className="pt-2 text-[10px] text-right">
                      <button 
                        onClick={() => jsonInputRef.current?.click()}
                        className="text-slate-450 hover:text-indigo-600 cursor-pointer font-semibold inline-flex items-center gap-1 border-t w-full justify-end pt-2 border-slate-100/60"
                        title="Nạp đè một file JSON khác vào ID đề thi này"
                      >
                        <Upload className="h-2.5 w-2.5" /> Ghi đè bằng tệp JSON mới
                      </button>
                      <input
                        type="file"
                        ref={jsonInputRef}
                        onChange={(e) => handleImportJSON(e, exam.id)}
                        accept=".json"
                        className="hidden"
                      />
                    </div>

                  </div>
                );
              })}
            </div>
          )}

        </div>
      )}

      {/* TAB 2: ĐỐI SÁNH & RÀ SOÁT TRÙNG LẶP HỌC LIỆU */}
      {activeTab === 'dedup' && (
        <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-xs space-y-6 animate-in fade-in duration-200">
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-4">
            <div className="space-y-1">
              <h3 className="font-extrabold text-slate-900 text-base flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-indigo-650" />
                Công cụ Quét Trùng Lặp học liệu (Similarity Detector)
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
                Giải thuật phân tách chuỗi từ vựng gộp không dấu (Jaccard Index Coefficient) rà soát giữa hàng trăm câu từ của tất cả kì thi trong kho để chỉ ra các câu có mức độ trùng lặp cao (trên 90%).
              </p>
            </div>

            <button
              onClick={runDeduplicationCheck}
              disabled={scanning}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all active:scale-95 cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
              {scanning ? 'Đang phân tích...' : 'Bắt đầu quét'}
            </button>
          </div>

          {scanning && (
            <div className="py-20 text-center space-y-3 max-w-md mx-auto animate-pulse">
              <Activity className="h-8 w-8 text-indigo-600 mx-auto animate-bounce" />
              <p className="text-slate-800 font-extrabold text-xs uppercase tracking-widest">{scanProgress}</p>
              <p className="text-[11px] text-slate-400">Điều này có thể mất tới vài giây trên mảng câu hỏi lớn.</p>
              <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div className="bg-indigo-600 h-full w-2/3 rounded-full animate-infinite-loading"></div>
              </div>
            </div>
          )}

          {!scanning && duplicates.length > 0 && (
            <div className="space-y-5">
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3 text-xs text-amber-800">
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
                <div>
                  <p className="font-extrabold">CẢNH BÁO: Phát hiện {duplicates.length} cặp câu hỏi trùng lặp!</p>
                  <p className="mt-0.5 leading-relaxed text-slate-600 font-medium">Bạn nên biên tập hiệu chỉnh nội dung để đảm bảo học liệu đa dạng và phong phú cho học sinh thoải mái luyện thi.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 max-h-[600px] overflow-y-auto pr-1">
                {duplicates.map((dup, index) => (
                  <div key={dup.key || index} className="p-4 border border-slate-200 hover:border-amber-400 bg-slate-50/40 rounded-2xl space-y-3 transition-colors text-xs font-semibold">
                    <div className="flex justify-between items-center bg-slate-100/70 p-2.5 rounded-xl border">
                      <span className="text-slate-700">Mã căp: <b className="font-mono">{index + 1}</b></span>
                      <span className="bg-rose-50 text-rose-700 border border-rose-100 px-2.5 py-1 rounded font-black text-[10px]">
                        ĐỘ TRÙNG KHỚP TRỰC DIỆN: {dup.score}%
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                      {/* Left Exam target */}
                      <div className="bg-white p-3 rounded-xl border border-dashed text-slate-600 space-y-1.5 leading-relaxed">
                        <p className="text-[10px] text-indigo-600 flex items-center justify-between">
                          <span>ĐỀ THI A: <b>{dup.exam1Title}</b></span>
                          <button 
                            onClick={() => {
                              const tg = exams.find(e => e.id === dup.exam1Id);
                              if (tg) { setEditingExam(tg); setEditMode('detail'); }
                            }}
                            className="underline hover:text-indigo-800 font-bold text-[9px] cursor-pointer"
                          >
                            Tới sửa Đề A
                          </button>
                        </p>
                        <div className="font-medium p-2 bg-slate-50 border rounded-lg text-slate-700" dangerouslySetInnerHTML={{ __html: dup.text1 }} />
                      </div>

                      {/* Right Exam target */}
                      <div className="bg-white p-3 rounded-xl border border-dashed text-slate-600 space-y-1.5 leading-relaxed">
                        <p className="text-[10px] text-emerald-600 flex items-center justify-between">
                          <span>ĐỀ THI B: <b>{dup.exam2Title}</b></span>
                          <button 
                            onClick={() => {
                              const tg = exams.find(e => e.id === dup.exam2Id);
                              if (tg) { setEditingExam(tg); setEditMode('detail'); }
                            }}
                            className="underline hover:text-emerald-800 font-bold text-[9px] cursor-pointer"
                          >
                            Tới sửa Đề B
                          </button>
                        </p>
                        <div className="font-medium p-2 bg-slate-50 border rounded-lg text-slate-700" dangerouslySetInnerHTML={{ __html: dup.text2 }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!scanning && duplicates.length === 0 && (
            <div className="py-16 text-center text-slate-400 border border-dashed rounded-3xl p-6 font-bold text-xs space-y-1.5">
              <Check className="h-8 w-8 text-emerald-500 mx-auto" />
              <p>Học liệu thơm phức! Chưa phát hiện trùng lặp kết cấu học thuật nào.</p>
              <p className="text-[10px] font-normal text-slate-400">Hãy bấm nút "Bắt đầu quét" phía trên để đo đạc chỉ số chi tiết.</p>
            </div>
          )}

        </div>
      )}

      {/* TAB 3: NHẬT KÝ BÁO LOI COMPLAINTS HỌC SINH */}
      {activeTab === 'feedbacks' && (
        <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-xs space-y-6 animate-in fade-in duration-200">
          
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b pb-4">
            <div className="space-y-1">
              <h3 className="font-extrabold text-slate-900 text-base flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-rose-500" />
                Danh sách báo lỗi từ học sinh (Student Error Reports log)
              </h3>
              <p className="text-xs text-slate-500">
                Bảng thông báo các điểm thắc mắc, phân tích đáp án sai hoặc lỗi chính tả do học sinh gửi lên trực diện khi làm bài luyện tập.
              </p>
            </div>

            {/* Error filters */}
            <div className="flex bg-slate-100 p-1 rounded-xl shrink-0">
              {(['all', 'pending', 'resolved'] as const).map(st => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setFeedbackStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    feedbackStatusFilter === st
                      ? 'bg-white text-indigo-600 shadow-3xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {st === 'all' ? 'Tất cả' : st === 'pending' ? 'Chưa duyệt' : 'Đã khắc phục'}
                </button>
              ))}
            </div>
          </div>

          {feedbacks.length === 0 ? (
            <div className="py-16 text-center text-slate-400 border border-dashed rounded-3xl p-6 font-bold text-xs">
              Chưa gặt hái được bất kỳ báo lỗi nào từ phía học sinh.
            </div>
          ) : (() => {
            const list = feedbacks.filter(f => feedbackStatusFilter === 'all' || f.status === feedbackStatusFilter);
            
            if (list.length === 0) {
              return (
                <div className="py-12 text-center text-slate-400 font-bold text-xs">
                  Không tìm thấy phản hồi trùng trạng thái "{feedbackStatusFilter}".
                </div>
              );
            }

            return (
              <div className="space-y-4 max-h-[550px] overflow-y-auto pr-1">
                {list.map(fb => (
                  <div 
                    key={fb.id} 
                    className={`p-5 rounded-2xl border flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-xs font-semibold hover:shadow-2xs transition-all ${
                      fb.status === 'resolved' 
                        ? 'bg-emerald-50/15 border-slate-200' 
                        : 'bg-amber-50/20 border-slate-200'
                    }`}
                  >
                    <div className="space-y-2 flex-1 leading-relaxed">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-900 font-extrabold text-sm truncate max-w-sm" title={fb.examTitle}>
                          Đề: {fb.examTitle}
                        </span>
                        <span className="bg-amber-100 text-amber-800 text-[10px] font-black font-mono px-2 rounded">
                          CÂU {fb.questionNumber}
                        </span>
                        {fb.status === 'resolved' ? (
                          <span className="bg-emerald-500 text-white font-black text-[9px] px-2 rounded uppercase flex items-center gap-0.5">
                            <Check className="h-2.5 w-2.5" /> Đã sửa
                          </span>
                        ) : (
                          <span className="bg-slate-200 text-slate-600 font-black text-[9px] px-2 rounded uppercase tracking-wider">
                            Đang rà soát
                          </span>
                        )}
                      </div>

                      {/* Flag Quote text content */}
                      <div className="bg-white p-3 border rounded-xl leading-normal text-slate-700 font-medium">
                        <span className="text-[9px] text-slate-400 font-bold block select-none uppercase tracking-wider border-b mb-1.5 pb-0.5">Học sinh mô tả lỗi:</span>
                        <p className="italic text-slate-800 font-serif">"{fb.reportText}"</p>
                      </div>

                      {/* Sender metadata info */}
                      <p className="text-[10px] text-slate-400 flex items-center gap-1.5 font-mono">
                        <span>Học viên: <b className="text-slate-650">{fb.reportedBy}</b></span>
                        <span>•</span>
                        <span>Thời gian: <b>{new Date(fb.createdAt).toLocaleString()}</b></span>
                      </p>
                    </div>

                    {/* Report actions toolbar */}
                    <div className="flex gap-2 shrink-0 self-end md:self-center">
                      <button
                        onClick={() => handleEditFromFeedback(fb)}
                        className="bg-indigo-50 hover:bg-indigo-100 text-indigo-750 font-bold px-3 py-1.5 rounded-lg text-xs cursor-pointer flex items-center gap-1 transition-all border border-indigo-100"
                        title="Tự động mở trình biên tập đặt con trỏ tại đúng câu hỏi bị báo lỗi này"
                      >
                        <Edit3 className="h-3.5 w-3.5" /> Sửa câu này ngay
                      </button>

                      {fb.status === 'pending' && (
                        <button
                          onClick={() => handleResolveFeedback(fb.id)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-3 py-1.5 rounded-lg text-xs cursor-pointer flex items-center gap-0.5 transition-all shadow-xs"
                        >
                          <Check className="h-3.5 w-3.5" /> Khắc phục xong
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

        </div>
      )}

    </div>
  );
}
