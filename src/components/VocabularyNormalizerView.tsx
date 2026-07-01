import React, { useEffect, useState } from 'react';
import { collection, getDocs, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Exam, Passage, VOCABULARY_THEMES } from '../types';
import { 
  Search, 
  Filter, 
  CheckCircle, 
  AlertTriangle, 
  Settings, 
  RefreshCw, 
  BookOpen, 
  SlidersHorizontal,
  Compass,
  ArrowRight,
  Database,
  Edit,
  Tag,
  Check,
  Award,
  HelpCircle,
  Sparkles,
  Clock,
  ArrowUpDown,
  CheckSquare,
  Square,
  BarChart4
} from 'lucide-react';

interface VocabularyNormalizerProps {
  onShowModal: (config: { type: 'success' | 'warning' | 'danger' | 'info'; title: string; message: string }) => void;
}

interface PassageNormalizerItem {
  examId: string;
  examTitle: string;
  passageIndex: number;
  passageTitle: string;
  passageContent: string;
  grade: number;
  currentVocab: string;
  isStandard: boolean;
}

export default function VocabularyNormalizerView({ onShowModal }: VocabularyNormalizerProps) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [btnLoading, setBtnLoading] = useState<string | null>(null);

  // Main Tab selection
  const [activeSubTab, setActiveSubTab] = useState<'manual_vocab' | 'batch_ai'>('manual_vocab');

  // New AI Batch Normalization state
  const [selectedExamIds, setSelectedExamIds] = useState<string[]>([]);
  const [batchEvaluating, setBatchEvaluating] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');

  // AI sorting & filtering states
  const [sortBy, setSortBy] = useState<'difficulty' | 'normalized' | 'title'>('normalized');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [batchSearchQuery, setBatchSearchQuery] = useState('');
  const [batchFilterGrade, setBatchFilterGrade] = useState<string>('all');
  const [batchFilterNormalized, setBatchFilterNormalized] = useState<'all' | 'normalized' | 'unnormalized'>('all');

  // Search and Filter criteria
  const [searchVocab, setSearchVocab] = useState('');
  const [searchExam, setSearchExam] = useState('');
  const [filterGrade, setFilterGrade] = useState<string>('all');
  const [showOnlyNonStandard, setShowOnlyNonStandard] = useState(true);

  // Bulk action states
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]); // formatted as "examId_passageIndex"
  const [bulkTargetTheme, setBulkTargetTheme] = useState<string>(VOCABULARY_THEMES[0]);

  // Bulk group map target state
  const [groupMapTarget, setGroupMapTarget] = useState<{ [errorName: string]: string }>({});

  useEffect(() => {
    fetchExams();
  }, []);

  const fetchExams = async () => {
    setLoading(true);
    try {
      const examCol = collection(db, 'exams');
      const snap = await getDocs(examCol);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Exam));
      setExams(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Helper: calculate overall exam difficulty score on a scale from 1 to 100 based on CEFR questions weight
  const calculateDifficultyScore = (passages: Passage[]): number => {
    let totalPoints = 0;
    let qCount = 0;
    const weights: { [key: string]: number } = {
      'A1': 15,
      'A2': 30,
      'B1': 50,
      'B2': 70,
      'C1': 85,
      'C2': 100
    };

    (passages || []).forEach(p => {
      p.questions?.forEach(q => {
        totalPoints += weights[q.difficulty] || 50;
        qCount++;
      });
    });

    return qCount > 0 ? Math.round(totalPoints / qCount) : 50;
  };

  // Helper: Get counting distribution for A1-A2, B1-B2, C1-C2 question difficulties inside an exam
  const getCEFRCounts = (exam: Exam) => {
    const counts = { basic: 0, intermediate: 0, advanced: 0 };
    exam.passages?.forEach(p => {
      p.questions?.forEach(q => {
        const diff = q.difficulty || 'B1';
        if (diff === 'A1' || diff === 'A2') {
          counts.basic++;
        } else if (diff === 'B1' || diff === 'B2') {
          counts.intermediate++;
        } else if (diff === 'C1' || diff === 'C2') {
          counts.advanced++;
        }
      });
    });
    return counts;
  };

  // Helper: get sorted and filtered exams array
  const getSortedExams = (): Exam[] => {
    return [...exams].filter(exam => {
      // search title or examCode
      if (batchSearchQuery.trim()) {
        const query = batchSearchQuery.toLowerCase();
        const titleMatch = exam.title?.toLowerCase().includes(query);
        const codeMatch = exam.examCode?.toLowerCase().includes(query);
        if (!titleMatch && !codeMatch) return false;
      }
      // grade criteria filter
      if (batchFilterGrade !== 'all' && String(exam.grade) !== batchFilterGrade) {
        return false;
      }
      // normalization state criteria filter
      if (batchFilterNormalized === 'normalized' && !exam.lastNormalizedAt) {
        return false;
      }
      if (batchFilterNormalized === 'unnormalized' && exam.lastNormalizedAt) {
        return false;
      }
      return true;
    }).sort((a, b) => {
      // Put unnormalized exams at the top (unnormalized: brand new or empty lastNormalizedAt)
      const isNormA = !!a.lastNormalizedAt;
      const isNormB = !!b.lastNormalizedAt;
      if (isNormA !== isNormB) {
        return isNormA ? 1 : -1; // unnormalized (false) comes first, i.e., top
      }

      let valA: any = '';
      let valB: any = '';

      if (sortBy === 'title') {
        valA = a.title || '';
        valB = b.title || '';
      } else if (sortBy === 'difficulty') {
        valA = a.difficultyScore ?? 0;
        valB = b.difficultyScore ?? 0;
      } else if (sortBy === 'normalized') {
        valA = a.lastNormalizedAt || '';
        valB = b.lastNormalizedAt || '';
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  };

  // Main task: Batch evaluate and normalization of multiple selected exams sequentially (robust, resilient to API congestion)
  const handleStartBatchNormalization = async () => {
    if (selectedExamIds.length === 0) {
      onShowModal({
        type: 'warning',
        title: 'Chưa chọn đề thi',
        message: 'Hãy tích chọn ít nhất 1 đề thi cần chạy chuẩn hóa từ danh sách bên dưới.'
      });
      return;
    }

    setBatchEvaluating(true);
    setBatchProgress('Đang bắt đầu chuẩn hóa phân phối toàn học liệu...');

    try {
      const selectedExamsObj = exams.filter(e => selectedExamIds.includes(e.id));
      const examSnap = await getDocs(collection(db, 'exams'));
      const nowStr = new Date().toISOString();
      let tempExams = [...exams];
      let successCount = 0;
      let failCount = 0;
      let lastErrorMessage = '';

      for (let i = 0; i < selectedExamsObj.length; i++) {
        const exam = selectedExamsObj[i];
        setBatchProgress(`Đang chuẩn hóa đề: "${exam.title}" (${i + 1}/${selectedExamsObj.length})...`);

        const passagesPayload: any[] = [];
        (exam.passages || []).forEach((p, idx) => {
          passagesPayload.push({
            id: `${exam.id}::${idx}`,
            title: p.title || '',
            content: p.content || '',
            questions: (p.questions || []).map(q => ({
              questionNumber: q.questionNumber,
              text: q.text,
              options: q.options,
              correctAnswer: q.correctAnswer
            }))
          });
        });

        if (passagesPayload.length === 0) {
          continue;
        }

        try {
          const res = await fetch("/api/gemini/batch-evaluate-exams", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ passages: passagesPayload })
          });

          // Robust response parsing
          const contentType = res.headers.get("content-type");
          let data: any = {};
          if (contentType && contentType.includes("application/json")) {
            data = await res.json();
          } else {
            const textError = await res.text();
            if (textError.includes("UNAVAILABLE") || textError.includes("503") || textError.includes("high demand")) {
              throw new Error("Mô hình AI hiện đang làm việc quá tải (503 Service Unavailable). Vui lòng thử lại sau.");
            }
            throw new Error(`Đường truyền mạng bị lỗi (Status: ${res.status}). Máy chủ phản hồi không đúng định dạng JSON.`);
          }

          if (!res.ok || !data.success) {
            throw new Error(data.error || "Gặp lỗi khi xử lý đề xuất tại endpoint AI.");
          }

          const results = data.results;
          if (!Array.isArray(results)) {
            throw new Error("Dữ liệu phản hồi từ AI không đúng định dạng mong muốn.");
          }

          // Build group map
          const resultsMap: { [pIdx: number]: any } = {};
          results.forEach(resItem => {
            const parts = resItem.id.split('::');
            if (parts.length === 2) {
              const pIdx = parseInt(parts[1], 10);
              resultsMap[pIdx] = resItem;
            }
          });

          const updatedPassages = exam.passages.map((p, pIdx) => {
            const aiEval = resultsMap[pIdx];
            if (aiEval) {
              const updatedQuestions = (p.questions || []).map(q => {
                const qEval = aiEval.questions?.find((oq: any) => oq.questionNumber === q.questionNumber);
                return {
                  ...q,
                  difficulty: qEval ? qEval.difficulty : q.difficulty,
                  grammarCategory: qEval ? qEval.grammarCategory : q.grammarCategory
                };
              });
              return {
                ...p,
                vocabularyCategory: aiEval.vocabularyCategory || p.vocabularyCategory,
                questions: updatedQuestions
              };
            }
            return p;
          });

          const computedScore = calculateDifficultyScore(updatedPassages);

          const targetDoc = examSnap.docs.find(d => d.data().id === exam.id);
          if (targetDoc) {
            const batch = writeBatch(db);
            batch.update(doc(db, 'exams', targetDoc.id), {
              passages: updatedPassages,
              difficultyScore: computedScore,
              lastNormalizedAt: nowStr
            });
            await batch.commit();
          }

          tempExams = tempExams.map(ex => {
            if (ex.id === exam.id) {
              return {
                ...ex,
                passages: updatedPassages,
                difficultyScore: computedScore,
                lastNormalizedAt: nowStr
              };
            }
            return ex;
          });

          setExams(tempExams);
          successCount++;
        } catch (singleExamErr: any) {
          console.error(`Singly normalizer failed for exam "${exam.title}":`, singleExamErr);
          failCount++;
          lastErrorMessage = singleExamErr.message || "Lỗi chuẩn hóa từ Gemini AI.";
        }

        // Delay 1 second between different exams to respect Gemini AI rate limits politely
        if (i < selectedExamsObj.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      setSelectedExamIds([]);

      if (successCount === selectedExamsObj.length) {
        onShowModal({
          type: 'success',
          title: 'Đã chuẩn hóa thành công lô học liệu 🧭',
          message: `Đã hoàn tất đánh giá và cập nhật đầy đủ cấu trúc từ vựng, ngữ pháp, độ khó câu hỏi và xếp hạng tự động thang điểm cho cả ${successCount} đề thi xuất sắc!`
        });
      } else if (successCount > 0) {
        onShowModal({
          type: 'warning',
          title: 'Chuẩn hóa một phần hoàn tất',
          message: `Đã chuẩn hóa thành công ${successCount}/${selectedExamsObj.length} đề thi. Có ${failCount} đề gặp sự cố do: ${lastErrorMessage}. Bạn có thể chuẩn hóa lại bất kỳ lúc nào!`
        });
      } else {
        throw new Error(lastErrorMessage || "Quá trình chuẩn hóa tất cả các đề thi đã chọn bị gián đoạn do lỗi mô hình AI bận.");
      }

    } catch (err: any) {
      console.error(err);
      onShowModal({
        type: 'danger',
        title: 'Hệ thống AI bận',
        message: err.message || 'Mô hình AI hiện tại đang quá tải hoặc gặp sự cố đường truyền mạng. Vui lòng chạy lại sau giây lát.'
      });
    } finally {
      setBatchEvaluating(false);
      setBatchProgress('');
    }
  };

  // Convert raw DB structure into flat passage items
  const getPassageItems = (): PassageNormalizerItem[] => {
    const list: PassageNormalizerItem[] = [];
    exams.forEach(exam => {
      (exam.passages || []).forEach((passage, idx) => {
        const vocab = passage.vocabularyCategory || '';
        const isStandard = VOCABULARY_THEMES.includes(vocab);
        list.push({
          examId: exam.id,
          examTitle: exam.title,
          passageIndex: idx,
          passageTitle: passage.title || `Đoạn văn ${idx + 1}`,
          passageContent: passage.content || '',
          grade: exam.grade || 10,
          currentVocab: vocab,
          isStandard
        });
      });
    });
    return list;
  };

  const passageItems = getPassageItems();

  // Aggregate unique non-standard themes & counts to show statistics & bulk action triggers
  const getNonStandardSummaries = () => {
    const counts: { [rawTheme: string]: { count: number; passages: PassageNormalizerItem[] } } = {};
    passageItems.forEach(item => {
      if (!item.isStandard) {
        const key = item.currentVocab || '[Chưa được gán]';
        if (!counts[key]) {
          counts[key] = { count: 0, passages: [] };
        }
        counts[key].count += 1;
        counts[key].passages.push(item);
      }
    });

    return Object.entries(counts).map(([rawTheme, data]) => ({
      rawTheme,
      count: data.count,
      passages: data.passages
    })).sort((a, b) => b.count - a.count);
  };

  const nonStandardSummaries = getNonStandardSummaries();

  // Apply search/filters on passage items
  const filteredPassages = passageItems.filter(item => {
    // 1. Filter standard VS non-standard
    if (showOnlyNonStandard && item.isStandard) {
      return false;
    }

    // 2. Search vocabulary raw string
    if (searchVocab && !item.currentVocab.toLowerCase().includes(searchVocab.toLowerCase())) {
      return false;
    }

    // 3. Search exam title
    if (searchExam && !item.examTitle.toLowerCase().includes(searchExam.toLowerCase())) {
      return false;
    }

    // 4. Filter by grade
    if (filterGrade !== 'all' && String(item.grade) !== filterGrade) {
      return false;
    }

    return true;
  });

  // Handle singular passage theme update
  const handleUpdateSinglePassage = async (examId: string, passageIndex: number, targetTheme: string) => {
    setBtnLoading(`single_${examId}_${passageIndex}`);
    try {
      const exam = exams.find(e => e.id === examId);
      if (!exam) return;

      const updatedPassages = [...exam.passages];
      updatedPassages[passageIndex] = {
        ...updatedPassages[passageIndex],
        vocabularyCategory: targetTheme
      };

      const examSnap = await getDocs(collection(db, 'exams'));
      const targetDoc = examSnap.docs.find(d => d.data().id === examId);

      if (targetDoc) {
        await updateDoc(doc(db, 'exams', targetDoc.id), {
          passages: updatedPassages
        });

        // Trigger local memory update to avoid re-fetching the entire DB instantly
        setExams(prev => prev.map(e => {
          if (e.id === examId) {
            return { ...e, passages: updatedPassages };
          }
          return e;
        }));

        onShowModal({
          type: 'success',
          title: 'Đã chuẩn hóa chủ đề',
          message: `Cập nhật thành công chủ đề từ vựng thành '${targetTheme}' cho đoạn văn thuộc đề '${exam.title}'.`
        });
      }
    } catch (err: any) {
      console.error(err);
      onShowModal({
        type: 'danger',
        title: 'Có lỗi xảy ra',
        message: err.message || 'Lỗi lưu thông số chủ đề từ vựng.'
      });
    } finally {
      setBtnLoading(null);
    }
  };

  // Bulk action: Normalize all selected passage items to bulkTargetTheme
  const handleBulkNormalize = async () => {
    if (selectedItemIds.length === 0) {
      onShowModal({
        type: 'warning',
        title: 'Chưa chọn đối tượng',
        message: 'Chứng minh bạn đã tích chọn ít nhất một đoạn văn lệch chuẩn từ danh sách.'
      });
      return;
    }

    setBtnLoading('bulk');
    let successCount = 0;

    try {
      // Group selections by examId to perform fewer doc writes
      const selectionGroup: { [examId: string]: number[] } = {};
      selectedItemIds.forEach(id => {
        const [examId, indexStr] = id.split('::');
        const pIdx = parseInt(indexStr);
        if (!selectionGroup[examId]) {
          selectionGroup[examId] = [];
        }
        selectionGroup[examId].push(pIdx);
      });

      const examSnap = await getDocs(collection(db, 'exams'));

      for (const [examId, indices] of Object.entries(selectionGroup)) {
        const exam = exams.find(e => e.id === examId);
        if (!exam) continue;

        const updatedPassages = [...exam.passages];
        indices.forEach(idx => {
          if (updatedPassages[idx]) {
            updatedPassages[idx].vocabularyCategory = bulkTargetTheme;
          }
        });

        const targetDoc = examSnap.docs.find(d => d.data().id === examId);
        if (targetDoc) {
          await updateDoc(doc(db, 'exams', targetDoc.id), {
            passages: updatedPassages
          });

          // Sync local state
          setExams(prev => prev.map(e => e.id === examId ? { ...e, passages: updatedPassages } : e));
          successCount += indices.length;
        }
      }

      setSelectedItemIds([]);
      onShowModal({
        type: 'success',
        title: 'Khuôn khổ chuẩn hóa lô',
        message: `Đã hiệu chuyển thành công chủ đề '${bulkTargetTheme}' cho ${successCount} đoạn văn.`
      });

    } catch (err: any) {
      console.error(err);
    } finally {
      setBtnLoading(null);
    }
  };

  // Bulk action: Normalize all occurrences of a raw/error vocabulary theme to a standard one
  const handleNormalizeGroup = async (rawTheme: string) => {
    const targetTheme = groupMapTarget[rawTheme];
    if (!targetTheme) {
      onShowModal({
        type: 'warning',
        title: 'Chưa chọn chủ đề chuẩn',
        message: 'Vui lòng chọn 1 danh mục chính thức trong danh sách chuẩn trước khi đổi.'
      });
      return;
    }

    setBtnLoading(`group_${rawTheme}`);
    let successCount = 0;

    try {
      // Get all passages with matching raw theme
      const matchPassages = passageItems.filter(item => item.currentVocab === rawTheme || (rawTheme === '[Chưa được gán]' && !item.currentVocab));
      if (matchPassages.length === 0) return;

      const examSnap = await getDocs(collection(db, 'exams'));

      // Group by exam
      const examGroup: { [examId: string]: number[] } = {};
      matchPassages.forEach(item => {
        if (!examGroup[item.examId]) {
          examGroup[item.examId] = [];
        }
        examGroup[item.examId].push(item.passageIndex);
      });

      for (const [examId, indices] of Object.entries(examGroup)) {
        const exam = exams.find(e => e.id === examId);
        if (!exam) continue;

        const updatedPassages = [...exam.passages];
        indices.forEach(idx => {
          if (updatedPassages[idx]) {
            updatedPassages[idx].vocabularyCategory = targetTheme;
          }
        });

        const targetDoc = examSnap.docs.find(d => d.data().id === examId);
        if (targetDoc) {
          await updateDoc(doc(db, 'exams', targetDoc.id), {
            passages: updatedPassages
          });

          // Sync local state
          setExams(prev => prev.map(e => e.id === examId ? { ...e, passages: updatedPassages } : e));
          successCount += indices.length;
        }
      }

      onShowModal({
        type: 'success',
        title: 'Bản đồ hóa thành công',
        message: `Đã gán và tối ưu chính xác tất cả ${successCount} đoạn văn từ [${rawTheme}] về chuẩn [${targetTheme}].`
      });

    } catch (err: any) {
      console.error(err);
    } finally {
      setBtnLoading(null);
    }
  };

  const handleSelectAllFiltered = () => {
    const allFilteredIds = filteredPassages.map(p => `${p.examId}::${p.passageIndex}`);
    const areAllSelected = allFilteredIds.every(id => selectedItemIds.includes(id));

    if (areAllSelected) {
      setSelectedItemIds(prev => prev.filter(id => !allFilteredIds.includes(id)));
    } else {
      setSelectedItemIds(prev => Array.from(new Set([...prev, ...allFilteredIds])));
    }
  };

  const handleToggleSelectItem = (id: string) => {
    setSelectedItemIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-200">
      
      {/* Intro Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-xs">
        <div className="space-y-1.5 flex-1">
          <h2 className="text-slate-900 font-extrabold text-xl tracking-tight flex items-center gap-2">
            <Compass className="h-5 w-5 text-indigo-600" />
            Quản trị & Chuẩn hóa Học liệu Đề thi
          </h2>
          <p className="text-slate-500 text-xs leading-relaxed max-w-3xl">
            Tính toán, chuẩn hóa phân loại CEFR của câu hỏi, chủ đề ngữ pháp, chủ đề từ vựng và tự động đánh giá xếp loại thang điểm độ khó (1-100) của đề thi. Hỗ trợ chuẩn hóa hàng loạt tối ưu hóa bằng Gemini AI.
          </p>
        </div>
        <button
          onClick={fetchExams}
          disabled={loading}
          className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-all shadow-xs"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Làm mới bộ dữ liệu
        </button>
      </div>

      {/* Sub-tab Navigation */}
      <div className="flex border-b border-slate-200 gap-2">
        <button
          onClick={() => setActiveSubTab('manual_vocab')}
          className={`px-5 py-3 text-xs font-extrabold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'manual_vocab'
              ? 'border-indigo-600 text-indigo-700 font-black'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Compass className="h-4 w-4" />
          Ánh xạ Từ vựng Đoạn văn (Thủ công)
        </button>
        <button
          onClick={() => setActiveSubTab('batch_ai')}
          className={`px-5 py-3 text-xs font-extrabold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'batch_ai'
              ? 'border-indigo-600 text-indigo-700 font-black'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Sparkles className="h-4 w-4 text-amber-500" />
          Chuẩn hóa theo lô bằng AI ⚡ (Gemini)
        </button>
      </div>

      {loading ? (
        <div className="text-center py-24 text-slate-400 text-xs space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent mx-auto" />
          <p className="font-semibold text-slate-500 animate-pulse">Đang nạp và đối chiếu cấu trúc học tài liệu từ hệ thống...</p>
        </div>
      ) : activeSubTab === 'manual_vocab' ? (
        <>
          {/* Section 1: Aggregate / Group analysis & mapped solution */}
          <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-xs space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h3 className="font-extrabold text-slate-900 text-sm md:text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Báo cáo tổng phổ các chủ đề lệch chuẩn ({nonStandardSummaries.length} nhãn thô lệch chuỗi)
              </h3>
              <p className="text-slate-400 text-[11px] mt-1">Các đoạn văn được bóc tách nhãn từ vựng tự do, chưa được liên kết đúng với bộ tiêu chí chuyên môn.</p>
            </div>

            {nonStandardSummaries.length === 0 ? (
              <div className="p-10 border border-dashed border-emerald-200 bg-emerald-50/20 text-center rounded-2xl space-y-2 max-w-3xl mx-auto">
                <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto" />
                <h4 className="font-bold text-slate-800 text-xs">Học liệu sạch và chuẩn hóa hoàn mĩ!</h4>
                <p className="text-[10px] text-slate-400">100% tất cả các cụm đoạn văn đã được gán nhãn thuộc danh sách {VOCABULARY_THEMES.length} chủ đề chỉ định.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {nonStandardSummaries.map((summary, sIdx) => (
                  <div key={sIdx} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col justify-between space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between items-start gap-2">
                        <span className="font-bold font-mono text-xs text-rose-600 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded-lg truncate max-w-[180px]" title={summary.rawTheme}>
                          {summary.rawTheme}
                        </span>
                        <span className="bg-slate-200 text-slate-700 text-[10px] font-bold px-2 rounded-full whitespace-nowrap">
                          {summary.count} đoạn
                        </span>
                      </div>
                      
                      <p className="text-[10px] text-slate-400 leading-normal line-clamp-2">
                        Mẫu sử dụng: "{summary.passages[0]?.passageTitle || ''}" trong <strong>{summary.passages[0]?.examTitle || ''}</strong>
                      </p>
                    </div>

                    <div className="space-y-2 border-t border-slate-200/60 pt-3">
                      <label className="text-[9px] text-slate-400 font-bold uppercase tracking-widest block">Ánh xạ về Chủ đề chuẩn:</label>
                      <div className="flex gap-1.5 text-xs">
                        <select
                          value={groupMapTarget[summary.rawTheme] || ''}
                          onChange={(e) => setGroupMapTarget(prev => ({ ...prev, [summary.rawTheme]: e.target.value }))}
                          className="flex-1 text-[11px] font-semibold bg-white border border-slate-200 rounded-lg p-1.5 focus:outline-hidden text-slate-700"
                        >
                          <option value="">-- Chọn chủ đề chuẩn --</option>
                          {VOCABULARY_THEMES.map(theme => (
                            <option key={theme} value={theme}>{theme}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={btnLoading === `group_${summary.rawTheme}`}
                          onClick={() => handleNormalizeGroup(summary.rawTheme)}
                          className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center justify-center shrink-0 cursor-pointer transition-colors"
                          title="Quyết định ánh xạ tất cả"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: Comprehensive filtering, search & manual modification table */}
          <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="font-extrabold text-slate-900 text-sm md:text-base flex items-center gap-1.5">
                  <SlidersHorizontal className="h-4 w-4 text-indigo-600" />
                  Danh mục quản trị & gán nhãn thủ công ({filteredPassages.length} bài đọc trùng khớp)
                </h3>
                <p className="text-slate-400 text-[11px] mt-0.5">Sử dụng bộ công cụ lọc nâng cao để cập nhật trực quan cho từng đoạn văn, hoặc tích chọn xử lý theo lô.</p>
              </div>

              {/* Only non-standard flag toggle */}
              <button
                type="button"
                onClick={() => setShowOnlyNonStandard(!showOnlyNonStandard)}
                className={`px-3.5 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  showOnlyNonStandard 
                    ? 'bg-amber-50 text-amber-700 border-amber-200' 
                    : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}
              >
                {showOnlyNonStandard ? '⚠️ Chỉ hiển thị đoạn LỆCH CHUẨN' : '👁️ Hiển thị tất cả các đoạn văn'}
              </button>
            </div>

            {/* Filter controls section */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-2xl">
              {/* Search 1: Vocabulary category query name */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Tìm kiếm chủ đề thô:</label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={searchVocab}
                    onChange={(e) => setSearchVocab(e.target.value)}
                    placeholder="E.g. family, studies, tech..."
                    className="w-full bg-white border border-slate-200 p-2 pl-9 rounded-lg text-xs font-semibold focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Search 2: Exam query name */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Tìm theo đề thi:</label>
                <div className="relative">
                  <BookOpen className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={searchExam}
                    onChange={(e) => setSearchExam(e.target.value)}
                    placeholder="E.g. Cầu Giấy, Tốt nghiệp..."
                    className="w-full bg-white border border-slate-200 p-2 pl-9 rounded-lg text-xs font-semibold focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Filter 3: Grade selection filter */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Khối lớp (Grade):</label>
                <select
                  value={filterGrade}
                  onChange={(e) => setFilterGrade(e.target.value)}
                  className="w-full bg-white border border-slate-200 p-2 rounded-lg text-xs font-semibold text-slate-700 focus:outline-hidden"
                >
                  <option value="all">Tất cả các khối</option>
                  <option value="6">Lớp 6</option>
                  <option value="10">Lớp 10</option>
                  <option value="12">Lớp 12</option>
                </select>
              </div>

              {/* Clean Filters btn */}
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    setSearchVocab('');
                    setSearchExam('');
                    setFilterGrade('all');
                  }}
                  className="w-full py-2 bg-slate-200 border border-slate-300 hover:bg-slate-300 rounded-lg text-xs font-bold text-slate-600 cursor-pointer text-center-all transition-colors"
                >
                  Bỏ tất cả bộ lọc
                </button>
              </div>
            </div>

            {/* Bulk Normalization Zone */}
            {selectedItemIds.length > 0 && (
              <div className="bg-indigo-50 border border-indigo-200/80 p-4.5 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-in slide-in-from-top-4 duration-200 text-xs">
                <div className="space-y-1">
                  <p className="font-bold text-indigo-950 flex items-center gap-1.5">
                    <Database className="h-4 w-4" />
                    Chương trình xử lý theo lô: Đang chọn <b>{selectedItemIds.length} mục</b> đoạn văn
                  </p>
                  <p className="text-indigo-600/80 text-[11px]">Chọn một chủ đề chuẩn để chuẩn hóa hàng loạt các đoạn văn đang được tick cùng một lúc.</p>
                </div>

                <div className="flex gap-2 w-full md:w-auto">
                  <select
                    value={bulkTargetTheme}
                    onChange={(e) => setBulkTargetTheme(e.target.value)}
                    className="bg-white border border-indigo-200 text-indigo-950 text-xs font-bold rounded-xl p-2.5 focus:outline-hidden flex-1 md:w-56"
                  >
                    {VOCABULARY_THEMES.map(theme => (
                      <option key={theme} value={theme}>{theme}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={btnLoading === 'bulk'}
                    onClick={handleBulkNormalize}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-all shadow-xs shrink-0 whitespace-nowrap active:scale-95"
                  >
                    Chuẩn hóa theo lô ✔
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedItemIds([])}
                    className="px-3 py-2 bg-slate-200 text-slate-600 hover:bg-slate-300 text-[11px] font-bold rounded-xl transition-all cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Hủy chọn
                  </button>
                </div>
              </div>
            )}

            {/* List / Table */}
            <div className="overflow-x-auto border border-slate-100 rounded-2xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-400 font-bold text-[10px] border-b border-slate-100 uppercase tracking-widest">
                    <th className="py-4 px-4 w-12 text-center">
                      <input
                        type="checkbox"
                        checked={filteredPassages.length > 0 && filteredPassages.every(p => selectedItemIds.includes(`${p.examId}::${p.passageIndex}`))}
                        onChange={handleSelectAllFiltered}
                        className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                      />
                    </th>
                    <th className="py-4 px-4">Bài Đọc Hiểu / Đề Thi</th>
                    <th className="py-4 px-4 w-28">Bộ Môn Lớp</th>
                    <th className="py-4 px-4">Nhãn Từ Vựng Thô</th>
                    <th className="py-4 px-4">Cập Nhật Về Chuẩn Hệ Thống</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPassages.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-400 font-bold">
                        Không tìm thấy bài đọc trùng khớp với tiêu chí tìm kiếm nào.
                      </td>
                    </tr>
                  ) : (
                    filteredPassages.map((item, idx) => {
                      const idKey = `${item.examId}::${item.passageIndex}`;
                      const isSelected = selectedItemIds.includes(idKey);
                      
                      return (
                        <tr 
                          key={idx} 
                          className={`hover:bg-slate-50/50 transition-colors ${
                            isSelected ? 'bg-indigo-50/15' : ''
                          }`}
                        >
                          <td className="py-4 px-4 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSelectItem(idKey)}
                              className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                            />
                          </td>
                          <td className="py-4 px-4 space-y-1">
                            <p className="font-extrabold text-slate-800 text-[12px]">{item.passageTitle}</p>
                            <p className="text-[10px] text-slate-400 font-medium truncate max-w-[280px]" title={item.examTitle}>
                              Đề: <strong>{item.examTitle}</strong>
                            </p>
                          </td>
                          <td className="py-4 px-4 font-bold text-slate-500">
                            <span className="bg-slate-100 text-slate-700 text-[10px] px-2 py-0.5 rounded-md font-mono">
                              Khối lớp {item.grade}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`px-2 py-1 rounded-lg text-[11px] font-extrabold flex items-center justify-start gap-1 w-fit ${
                              item.isStandard
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-red-50 text-red-700 border border-red-200'
                            }`}>
                              <Tag className="h-3 w-3 shrink-0" />
                              {item.currentVocab || '[Chưa gán nhãn]'} {!item.isStandard && '⚠️'}
                            </span>
                          </td>
                          <td className="py-4 px-1">
                            <div className="flex items-center gap-1.5 w-full max-w-xs">
                              <select
                                defaultValue={item.currentVocab && item.isStandard ? item.currentVocab : ''}
                                onChange={(e) => {
                                  if (e.target.value) {
                                    handleUpdateSinglePassage(item.examId, item.passageIndex, e.target.value);
                                  }
                                }}
                                className="text-[11px] font-semibold bg-white border border-slate-200 rounded-lg p-1.5 focus:outline-hidden text-slate-700 flex-1"
                              >
                                <option value="">-- Chuẩn hóa nhanh --</option>
                                {VOCABULARY_THEMES.map(theme => (
                                  <option key={theme} value={theme}>{theme}</option>
                                ))}
                              </select>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* Brand new batch_ai sub-tab layout: Batch normalization through optimize clustering */
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-200">
          
          {/* Controls & Filter Panel */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200/60 shadow-xs space-y-6">
            <div className="border-b border-slate-100 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="font-extrabold text-slate-900 text-sm md:text-base flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-amber-500" />
                  Chuẩn hóa theo lô thông minh thông qua Gemini AI
                </h3>
                <p className="text-slate-400 text-[11px] mt-0.5">
                  Tự động phân loại toàn bộ: <b>Chủ đề từ vựng</b> của đoạn văn, <b>Chủ đề ngữ pháp</b> của câu hỏi, và <b>CEFR độ khó</b> của câu hỏi.
                </p>
              </div>

              {/* Explain optimized clustering */}
              <span className="text-[10px] text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-xl font-bold max-w-sm line-clamp-1">
                ⚡ Gom gộp (grouping/batching) tối đa 5 đoạn văn/yêu cầu để hạn chế dính rate limit
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 bg-slate-50 p-4 rounded-2xl text-xs font-semibold">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Tìm kiếm đề thi:</label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={batchSearchQuery}
                    onChange={(e) => setBatchSearchQuery(e.target.value)}
                    placeholder="Tìm theo tên tuyển hay mã đề..."
                    className="w-full bg-white border border-slate-200 p-2 pl-9 rounded-lg text-xs font-semibold focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Khối học (Grade):</label>
                <select
                  value={batchFilterGrade}
                  onChange={(e) => setBatchFilterGrade(e.target.value)}
                  className="w-full bg-white border border-slate-200 p-2 rounded-lg text-xs font-semibold text-slate-700 focus:outline-hidden"
                >
                  <option value="all">Tất cả các khối</option>
                  <option value="6">Khối 6</option>
                  <option value="10">Khối 10</option>
                  <option value="12">Khối 12</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Trạng thái chuẩn hóa:</label>
                <select
                  value={batchFilterNormalized}
                  onChange={(e) => setBatchFilterNormalized(e.target.value as any)}
                  className="w-full bg-white border border-slate-200 p-2 rounded-lg text-xs font-semibold text-slate-700 focus:outline-hidden"
                >
                  <option value="all">Tất cả đề thi</option>
                  <option value="unnormalized">Chưa chuẩn hóa</option>
                  <option value="normalized">Đã chuẩn hóa</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Sắp xếp theo tiêu chí:</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="w-full bg-white border border-slate-200 p-2 rounded-lg text-xs font-semibold text-slate-700 focus:outline-hidden"
                >
                  <option value="normalized">Thời điểm chuẩn hóa</option>
                  <option value="difficulty">Độ khó đề thi (1-100)</option>
                  <option value="title">Tên gọi đề thi</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Thứ tự sắp xếp:</label>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as any)}
                  className="w-full bg-white border border-slate-200 p-2 rounded-lg text-xs font-semibold text-slate-700 focus:outline-hidden"
                >
                  <option value="desc">Giảm dần / Mới nhất</option>
                  <option value="asc">Tăng dần / Cũ nhất</option>
                </select>
              </div>
            </div>

            {/* Normalizer controller and feedback */}
            <div className="border border-indigo-100 bg-indigo-50/20 rounded-2.5xl p-5 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="space-y-1.5 flex-1 text-center md:text-left">
                <h4 className="font-extrabold text-slate-900 text-sm flex items-center gap-1.5 justify-center md:justify-start">
                  <Database className="h-4 w-4 text-indigo-600" />
                  Cấu hình chương trình phân tích hàng loạt
                </h4>
                <p className="text-slate-500 text-[11px] max-w-xl leading-relaxed">
                  Đã chọn <b className="text-indigo-600 text-xs font-extrabold">{selectedExamIds.length} đề thi</b>. 
                  Khi kích hoạt, Gemini AI sẽ tham chiếu chéo toàn bộ dữ liệu văn bản đọc hiểu và các câu hỏi, tự động xây dựng chỉ mục thang điểm 1-100 của đề và ghi đè trạng thái Firestore đồng bộ.
                </p>
              </div>

              <div className="w-full md:w-auto shrink-0 flex flex-col gap-2">
                <button
                  type="button"
                  disabled={selectedExamIds.length === 0 || batchEvaluating}
                  onClick={handleStartBatchNormalization}
                  className="px-6 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-2xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all shadow-md hover:shadow-indigo-100 disabled:opacity-40 disabled:pointer-events-none active:scale-95"
                >
                  {batchEvaluating ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin text-white" />
                      Đang xử lý phân tích...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 text-amber-300" />
                      Tiến hành chuẩn hóa theo lô ({selectedExamIds.length} đề)
                    </>
                  )}
                </button>
                {selectedExamIds.length > 0 && !batchEvaluating && (
                  <button
                    type="button"
                    onClick={() => setSelectedExamIds([])}
                    className="py-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-700 underline text-center cursor-pointer"
                  >
                    Bỏ chọn tất cả đề thi
                  </button>
                )}
              </div>
            </div>

            {/* In-progress progress notification */}
            {batchEvaluating && (
              <div className="bg-amber-50/50 border border-amber-200/50 p-4 rounded-xl leading-relaxed animate-pulse">
                <p className="text-[11px] font-bold text-amber-800 flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                  </span>
                  Trình tự phân tích AI & Thu thập liên kết database:
                </p>
                <p className="text-[10px] text-amber-600 mt-1 font-mono font-bold">{batchProgress}</p>
              </div>
            )}
          </div>

          {/* List table for Exams */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200/60 shadow-xs space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-50">
              <h3 className="font-extrabold text-slate-900 text-xs md:text-sm">
                Danh sách đề thi trong phân vùng ({getSortedExams().length} đề thi)
              </h3>
              <p className="text-slate-400 text-[10px]">Tích chọn các đề thi bên dưới để đưa vào chương trình chuẩn hóa lô.</p>
            </div>

            <div className="overflow-x-auto border border-slate-100 rounded-2xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-400 font-bold text-[10px] border-b border-slate-100 uppercase tracking-widest">
                    <th className="py-4 px-4 w-12 text-center">
                      <input
                        type="checkbox"
                        checked={getSortedExams().length > 0 && getSortedExams().every(e => selectedExamIds.includes(e.id))}
                        onChange={() => {
                          const sortedExams = getSortedExams();
                          const areAllSelected = sortedExams.length > 0 && sortedExams.every(e => selectedExamIds.includes(e.id));
                          if (areAllSelected) {
                            setSelectedExamIds(prev => prev.filter(id => !sortedExams.some(se => se.id === id)));
                          } else {
                            setSelectedExamIds(prev => Array.from(new Set([...prev, ...sortedExams.map(se => se.id)])));
                          }
                        }}
                        className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                      />
                    </th>
                    <th className="py-4 px-4">Tên tuyển / Đề thi / Mã đề</th>
                    <th className="py-4 px-4 w-28 text-center font-mono">Khối học (Grade)</th>
                    <th className="py-4 px-4 w-24 text-center">Phần / Câu hỏi</th>
                    <th className="py-4 px-4 w-44 text-center">Chỉ mục Độ Khó Đề (1-100)</th>
                    <th className="py-4 px-4 text-center">Phổ Phân Bổ CEFR</th>
                    <th className="py-4 px-4 w-44 text-center">Lần chuẩn hóa cuối</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {getSortedExams().length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400 font-bold">
                        Không tìm thấy đề thi phù hợp với tiêu chuẩn lọc hiện tại.
                      </td>
                    </tr>
                  ) : (
                    getSortedExams().map((exam, idx) => {
                      const isSelected = selectedExamIds.includes(exam.id);
                      
                      // Count total passages and questions in this exam
                      const numPassages = exam.passages?.length || 0;
                      let numQuestions = 0;
                      exam.passages?.forEach(p => {
                        numQuestions += p.questions?.length || 0;
                      });

                      // CEFR distributions
                      const cefr = getCEFRCounts(exam);

                      // Color coding based on Difficulty Score
                      const score = exam.difficultyScore;
                      let difficultyBadgeColor = 'bg-slate-100 text-slate-600';
                      let difficultyTier = 'Chưa xác định';
                      if (score !== undefined) {
                        if (score < 35) {
                          difficultyBadgeColor = 'bg-emerald-50 text-emerald-700 border border-emerald-200';
                          difficultyTier = 'Cơ bản';
                        } else if (score < 68) {
                          difficultyBadgeColor = 'bg-amber-50 text-amber-700 border border-amber-200';
                          difficultyTier = 'Trung bình';
                        } else {
                          difficultyBadgeColor = 'bg-rose-50 text-rose-700 border border-rose-200';
                          difficultyTier = 'Học sinh giỏi / Chuyên';
                        }
                      }

                      return (
                        <tr 
                          key={exam.id}
                          className={`hover:bg-slate-50/50 transition-colors ${
                            isSelected ? 'bg-indigo-50/15 font-semibold' : ''
                          }`}
                        >
                          <td className="py-4 px-4 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setSelectedExamIds(prev => 
                                  prev.includes(exam.id) ? prev.filter(id => id !== exam.id) : [...prev, exam.id]
                                );
                              }}
                              className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                            />
                          </td>
                          <td className="py-4 px-4 space-y-1">
                            <div className="font-extrabold text-slate-800 text-[12px]">{exam.title}</div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              Mã đề: <span className="font-bold text-slate-600">{exam.examCode || 'N/A'}</span>
                            </div>
                          </td>
                          <td className="py-4 px-4 text-center font-mono">
                            <span className="bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded text-[10px]">
                              Khối {exam.grade || 10}
                            </span>
                          </td>
                          <td className="py-4 px-4 text-center font-bold text-xs space-y-0.5 text-slate-600">
                            <div>{numPassages} phần</div>
                            <div className="text-[10px] text-slate-400 font-normal">{numQuestions} câu hỏi</div>
                          </td>
                          <td className="py-4 px-4 text-center">
                            {score === undefined ? (
                              <span className="text-[10px] text-slate-400 font-bold flex items-center gap-1 justify-center">
                                <AlertTriangle className="h-3 w-3 text-amber-400" />
                                Chưa gán nhãn
                              </span>
                            ) : (
                              <div className="space-y-1 inline-block text-center">
                                <div className={`px-2 py-0.5 rounded-full text-[10px] font-black font-mono ${difficultyBadgeColor}`}>
                                  {score} - {difficultyTier}
                                </div>
                                {/* Miniature visually beautiful gauge */}
                                <div className="w-24 bg-slate-100 rounded-full h-1.5 overflow-hidden mx-auto border border-slate-200/40">
                                  <div 
                                    className={`h-full rounded-full ${
                                      score < 35 ? 'bg-emerald-500' : score < 68 ? 'bg-amber-500' : 'bg-rose-500'
                                    }`}
                                    style={{ width: `${score}%` }}
                                  />
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="py-4 px-4">
                            <div className="space-y-1 text-center font-semibold text-[10px] text-slate-500">
                              <div className="flex gap-2 justify-center">
                                <span className="text-emerald-600">A1-A2: <b>{cefr.basic}</b></span>
                                <span className="text-amber-600">B1-B2: <b>{cefr.intermediate}</b></span>
                                <span className="text-rose-600">C1-C2: <b>{cefr.advanced}</b></span>
                              </div>
                              <div className="flex w-28 h-1 my-auto bg-slate-100 rounded-full overflow-hidden mx-auto justify-stretch">
                                <div className="bg-emerald-400" style={{ flexGrow: cefr.basic }} />
                                <div className="bg-amber-400" style={{ flexGrow: cefr.intermediate }} />
                                <div className="bg-rose-400" style={{ flexGrow: cefr.advanced }} />
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-4 text-center text-[10px] text-slate-500 font-bold">
                            {exam.lastNormalizedAt ? (
                              <div className="space-y-0.5 inline-block text-left">
                                <div className="flex items-center gap-1">
                                  <Clock className="h-3 w-3 text-emerald-500" />
                                  <span>{new Date(exam.lastNormalizedAt).toLocaleDateString('vi-VN')}</span>
                                </div>
                                <div className="text-[9px] text-slate-400 pl-4">
                                  {new Date(exam.lastNormalizedAt).toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'})}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400">Chưa chuẩn hóa thô ⏳</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

          </div>

        </div>
      )}

    </div>
  );
}
