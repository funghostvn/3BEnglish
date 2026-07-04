import React, { useEffect, useState, useRef } from 'react';
import { collection, doc, setDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Exam } from '../types';
import { EXAM_CLASSIFICATIONS, DEFAULT_EXAM_CLASSIFICATION } from '../constants';
import {
  Upload,
  FileCode,
  Sparkles,
  FileText,
  Clock,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  X,
  Check,
  Plus,
  Database,
  BookOpen,
  Pencil,
  Eye,
  Trash2,
  AlertTriangle,
  Info
} from 'lucide-react';

const MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024; // 20MB per file

// Accepts either a single exam object, a bare array of exams, or an
// { exams: [...] } wrapper, and always normalizes to Partial<Exam>[].
function normalizeParsedExams(parsed: unknown): Partial<Exam>[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).exams)) {
    return (parsed as any).exams;
  }
  return [parsed as Partial<Exam>];
}

interface ImportExamViewProps {
  onShowModal: (config: { type: 'success' | 'warning' | 'danger' | 'info' | 'confirm'; title: string; message: string }) => void;
}

interface ImportQueueItem {
  id: string;
  sourceName: string;
  importMethod: 'pdf' | 'file_json' | 'manual_paste';
  status: 'waiting' | 'processing' | 'completed' | 'failed';
  progress: string;
  error?: string;
  parsedExam?: Partial<Exam> | null;
  file?: File;
  pastedContent?: string;
  isSelected?: boolean;
}

export default function ImportExamView({ onShowModal }: ImportExamViewProps) {
  const isComponentMounted = useRef(true);
  useEffect(() => {
    isComponentMounted.current = true;
    return () => {
      isComponentMounted.current = false;
    };
  }, []);

  const [importMethod, setImportMethod] = useState<'pdf' | 'file_json' | 'manual_paste'>('pdf');
  const [pastedJson, setPastedJson] = useState('');
  const [pastedTitle, setPastedTitle] = useState('Đề dán thủ công #' + Math.floor(Math.random() * 100));
  const [queue, setQueue] = useState<ImportQueueItem[]>([]);
  const [selectedReviewItem, setSelectedReviewItem] = useState<ImportQueueItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAllSelected, setIsAllSelected] = useState(true);

  // Edit fields for active preview item
  const [editTitle, setEditTitle] = useState('');
  const [editExamName, setEditExamName] = useState('');
  const [editExamCode, setEditExamCode] = useState('');
  const [editGrade, setEditGrade] = useState<number>(10);
  const [editDuration, setEditDuration] = useState<number>(60);
  const [editNumQuestions, setEditNumQuestions] = useState<number>(40);
  const [editPublisher, setEditPublisher] = useState('');
  const [editYear, setEditYear] = useState<number>(new Date().getFullYear());
  const [editClassification, setEditClassification] = useState(DEFAULT_EXAM_CLASSIFICATION);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        if (typeof result === 'string') {
          resolve(result.split(',')[1]);
        } else {
          reject(new Error("Không thể chuyển đổi file sang Base64"));
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  };

  // Synchronize edit fields when the review item changes
  useEffect(() => {
    if (selectedReviewItem && selectedReviewItem.parsedExam) {
      const exam = selectedReviewItem.parsedExam;
      setEditTitle(exam.title || '');
      setEditExamName(exam.examName || exam.title || '');
      setEditExamCode(exam.examCode || '');
      setEditGrade(exam.grade || 10);
      setEditDuration(exam.duration || 60);
      setEditNumQuestions(exam.numQuestions || (exam.passages ? exam.passages.reduce((sum, p) => sum + (p.questions ? p.questions.length : 0), 0) : 40));
      setEditPublisher(exam.publisher || '');
      setEditYear(exam.year || new Date().getFullYear());
      setEditClassification(exam.classification || DEFAULT_EXAM_CLASSIFICATION);
    } else {
      setEditTitle('');
      setEditExamName('');
      setEditExamCode('');
      setEditGrade(10);
      setEditDuration(60);
      setEditNumQuestions(40);
      setEditPublisher('');
      setEditYear(new Date().getFullYear());
      setEditClassification(DEFAULT_EXAM_CLASSIFICATION);
    }
  }, [selectedReviewItem]);

  // Queue background processor for PDF Gemini parsing.
  // isProcessingRef is a synchronous mutex: derived-from-state checks alone
  // (queue.some(status === 'processing')) can race when this effect fires
  // twice in close succession (e.g. two unrelated queue updates) before the
  // "mark as processing" state update has committed, letting two PDFs start
  // parsing concurrently. The ref closes that gap.
  const isProcessingRef = useRef(false);

  useEffect(() => {
    const processNextPdf = async () => {
      if (isProcessingRef.current) return;

      const nextItem = queue.find(item => item.status === 'waiting' && item.importMethod === 'pdf');
      if (!nextItem) return;

      isProcessingRef.current = true;
      setQueue(prev => prev.map(item =>
        item.id === nextItem.id ? { ...item, status: 'processing', progress: 'Đang chuẩn bị file...' } : item
      ));

      try {
        if (!nextItem.file) {
          throw new Error("Không tìm thấy tệp PDF để bóc tách.");
        }

        const base64 = await fileToBase64(nextItem.file);
        if (!isComponentMounted.current) return;

        setQueue(prev => prev.map(item =>
          item.id === nextItem.id ? { ...item, progress: 'Gemini AI đang bóc tách cấu trúc...' } : item
        ));

        const response = await fetch('/api/gemini/parse-exam', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileBase64: base64,
            mimeType: nextItem.file.type,
            option: nextItem.sourceName
          })
        });

        const respData = await response.json();
        if (!response.ok) {
          throw new Error(respData.error || 'Gemini không phản hồi hoặc hết thời gian.');
        }

        if (!isComponentMounted.current) return;

        const updatedItem = {
          ...nextItem,
          status: 'completed' as const,
          progress: 'Bóc tách thành công ✨',
          parsedExam: respData.exam
        };
        setQueue(prev => prev.map(item => (item.id === nextItem.id ? updatedItem : item)));
        // Auto-select the freshly parsed item for review.
        setSelectedReviewItem(updatedItem);

      } catch (err: any) {
        console.error(err);
        if (!isComponentMounted.current) return;
        setQueue(prev => prev.map(item =>
          item.id === nextItem.id
            ? { ...item, status: 'failed', progress: 'Bóc tách thất bại ❌', error: err.message || 'Lỗi bóc tách AI.' }
            : item
        ));
      } finally {
        isProcessingRef.current = false;
      }
    };

    processNextPdf();
  }, [queue]);

  // Handle file choice for method 1 (PDF Upload)
  const handlePdfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const oversizedNames: string[] = [];
    const newItems: ImportQueueItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > MAX_PDF_SIZE_BYTES) {
        oversizedNames.push(file.name);
        continue;
      }
      newItems.push({
        id: `pdf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        sourceName: file.name,
        importMethod: 'pdf',
        status: 'waiting',
        progress: 'Đang xếp hàng chờ xử lý...',
        file: file,
        isSelected: isAllSelected
      });
    }

    if (oversizedNames.length > 0) {
      onShowModal({
        type: 'warning',
        title: 'Tệp PDF quá lớn',
        message: `Các tệp sau vượt quá giới hạn ${MAX_PDF_SIZE_BYTES / (1024 * 1024)}MB và đã bị bỏ qua: ${oversizedNames.join(', ')}. Vui lòng nén hoặc tách nhỏ tệp trước khi tải lên.`
      });
    }

    setQueue(prev => [...prev, ...newItems]);
    e.target.value = ''; // Clear file input
  };

  // Handle file choice for method 2 (JSON file import)
  const handleJsonTxtUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newItems: ImportQueueItem[] = [];

    Array.from(files).forEach((file: File) => {
      const reader = new FileReader();
      const itemId = `json_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      reader.onload = (event) => {
        try {
          const text = event.target?.result as string;
          const parsed = JSON.parse(text);
          const examsToImport = normalizeParsedExams(parsed);

          // Generate a queue item for each exam structure in the file
          const items: ImportQueueItem[] = examsToImport.map((exam, index) => ({
            id: `${itemId}_${index}`,
            sourceName: examsToImport.length > 1 ? `${file.name} (Đề ${index + 1})` : file.name,
            importMethod: 'file_json',
            status: 'completed',
            progress: 'Nạp file thành công ✔',
            parsedExam: exam,
            isSelected: isAllSelected
          }));

          setQueue(prev => {
            const updated = [...prev, ...items];
            if (items.length > 0) {
              setSelectedReviewItem(items[0]);
            }
            return updated;
          });

        } catch (err: any) {
          setQueue(prev => [
            ...prev,
            {
              id: itemId,
              sourceName: file.name,
              importMethod: 'file_json',
              status: 'failed',
              progress: 'Lỗi định dạng tệp ❌',
              error: `Lỗi đọc cú pháp JSON: ${err.message}`,
              isSelected: isAllSelected
            }
          ]);
        }
      };
      reader.readAsText(file);
    });

    e.target.value = ''; // Clean file input
  };

  // Handle manual JSON content paste
  const handlePasteImport = () => {
    if (!pastedJson.trim()) {
      onShowModal({
        type: 'warning',
        title: 'Trống dữ liệu',
        message: 'Vui lòng dán chuỗi JSON cấu trúc đề thi vào khung chữ.'
      });
      return;
    }

    try {
      const parsed = JSON.parse(pastedJson.trim());
      const exams = normalizeParsedExams(parsed);

      const newItems: ImportQueueItem[] = exams.map((exam, idx) => ({
        id: `paste_${Date.now()}_${idx}`,
        sourceName: exams.length > 1 ? `${pastedTitle} (Đề ${idx + 1})` : pastedTitle,
        importMethod: 'manual_paste',
        status: 'completed',
        progress: 'Phân tích chuỗi hợp lệ ✔',
        parsedExam: exam,
        isSelected: isAllSelected
      }));

      setQueue(prev => {
        const updated = [...prev, ...newItems];
        setSelectedReviewItem(newItems[0]);
        return updated;
      });

      onShowModal({
        type: 'success',
        title: 'Nạp JSON thành công',
        message: `Đã dán và phân tích cú pháp của ${newItems.length} đề thi thành công vào hàng đợi.`
      });

      setPastedJson('');
    } catch (err: any) {
      onShowModal({
        type: 'danger',
        title: 'Lỗi định dạng cấu trúc JSON',
        message: `Đầu vào dán của bạn chứa lỗi cú pháp JSON: ${err.message}. Hãy kiểm tra đóng mở ngoặc hoặc dấu phẩy!`
      });
    }
  };

  // Generate Sample JSON to paste easily
  const handleFillSampleJson = () => {
    const sample = {
      title: "Đề thi tuyển sinh vào lớp 6 môn Tiếng Anh Cầu Giấy năm 2026 - Bản mẫu",
      examName: "Đề thi tuyển sinh vào lớp 6 môn Tiếng Anh Cầu Giấy năm 2026",
      examCode: "CG-2026-PREVIEW",
      grade: 6,
      numQuestions: 3,
      duration: 45,
      publisher: "Trường THCS Cầu Giấy",
      year: 2026,
      passages: [
        {
          title: "Part 1: Grammar and Vocabulary",
          content: "Choose the correct word to complete the sentence.",
          vocabularyCategory: "School and studies",
          questions: [
            {
              questionNumber: 1,
              text: "Our teacher suggests that we ______ more attention to vocabulary learning.",
              options: {
                "A": "pay",
                "B": "paid",
                "C": "paying",
                "D": "to pay"
              },
              correctAnswer: "A",
              explanation: "Cấu trúc giả định với động từ 'suggest': S + suggest + that + S + (should) + V-bare.",
              difficulty: "B1",
              grammarCategory: "Subjunctive"
            },
            {
              questionNumber: 2,
              text: "Listen! Someone ______ at the door.",
              options: {
                "A": "knocks",
                "B": "is knocking",
                "C": "has knocked",
                "D": "knocked"
              },
              correctAnswer: "B",
              explanation: "Câu mệnh lệnh 'Listen!' làm dấu hiệu nhận biết của thì Hiện tại tiếp diễn.",
              difficulty: "A1",
              grammarCategory: "Present continuous tense"
            },
            {
              questionNumber: 3,
              text: "Give the correct form of the verb: She ______ (go) to school by bike every day.",
              answerType: "text",
              options: {},
              correctAnswer: "goes",
              explanation: "Thì Hiện tại đơn với chủ ngữ ngôi thứ 3 số ít: thêm -es vào động từ 'go'. Câu tự luận: học sinh gõ đáp án, nhiều biến thể chấp nhận được ngăn cách bằng dấu '|'.",
              difficulty: "A1",
              grammarCategory: "Verb tenses"
            }
          ]
        }
      ]
    };
    setPastedJson(JSON.stringify(sample, null, 2));
    setPastedTitle("Đề thi tuyển sinh mẫu 2026");
  };

  // Apply visual changes currently made in form fields back to queue object, before database writes
  const handleApplyMetaEdit = () => {
    if (!selectedReviewItem) return;

    const updatedExam: Partial<Exam> = {
      ...(selectedReviewItem.parsedExam || {}),
      title: editTitle,
      examName: editExamName,
      examCode: editExamCode,
      grade: editGrade,
      duration: editDuration,
      numQuestions: editNumQuestions,
      publisher: editPublisher,
      year: editYear,
      classification: editClassification
    };
    const updatedItem = {
      ...selectedReviewItem,
      sourceName: editTitle,
      parsedExam: updatedExam
    };

    setQueue(prev => prev.map(item => (item.id === selectedReviewItem.id ? updatedItem : item)));
    setSelectedReviewItem(updatedItem);

    onShowModal({
      type: 'success',
      title: 'Đã lưu tạm điều chỉnh!',
      message: 'Thông tin chỉnh sửa đã được đồng bộ vào hàng đợi bóc tách để chờ ghi DB.'
    });
  };

  // Store a single completed item in SQLite/Firestore
  const handleSaveToDatabase = async (item: ImportQueueItem) => {
    if (!item.parsedExam) return false;

    try {
      const targetCode = (item.parsedExam.examCode || "").trim();
      if (targetCode && targetCode !== "Mã đề ngẫu nhiên") {
        const q = query(collection(db, 'exams'), where('examCode', '==', targetCode));
        const examSnap = await getDocs(q);
        if (!examSnap.empty) {
          onShowModal({
            type: 'danger',
            title: 'Trùng mã đề thi',
            message: `Không thể lưu đề thi "${item.parsedExam.title || 'không tên'}". Mã đề thi "${targetCode}" đã tồn tại trong hệ thống. Vui lòng đổi mã đề thi khác!`
          });
          return false;
        }
      }

      const generatedId = `exam_${Date.now()}_` + Math.floor(Math.random() * 1000);
      const newExam: Exam = {
        id: generatedId,
        title: item.parsedExam.title || "Đề thi chưa định tên",
        examName: item.parsedExam.examName || item.parsedExam.title || "Đề thi chưa định tên",
        examCode: item.parsedExam.examCode || "Mã đề ngẫu nhiên",
        grade: Number(item.parsedExam.grade) || 10,
        numQuestions: Number(item.parsedExam.numQuestions) || (item.parsedExam.passages ? item.parsedExam.passages.reduce((sum, p) => sum + (p.questions ? p.questions.length : 0), 0) : 40),
        duration: Number(item.parsedExam.duration) || 60,
        publisher: item.parsedExam.publisher || "Chưa rõ nguồn",
        year: Number(item.parsedExam.year) || new Date().getFullYear(),
        createdAt: new Date().toISOString(),
        passages: item.parsedExam.passages || [],
        classification: item.parsedExam.classification || DEFAULT_EXAM_CLASSIFICATION
      };

      // Use setDoc with the generated id (not addDoc) so the Firestore
      // document id always matches newExam.id — other views resolve exam
      // docs directly via doc(db,'exams', exam.id) rather than re-querying,
      // and an addDoc-assigned random id would silently break that.
      await setDoc(doc(db, 'exams', generatedId), newExam);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  // Save selected completed items in the list in batch (theo lô)
  const handleBatchSave = async () => {
    const selectedCompleted = queue.filter(item => item.isSelected && item.status === 'completed' && item.parsedExam);
    if (selectedCompleted.length === 0) {
      onShowModal({
        type: 'warning',
        title: 'Chưa chọn đề thô',
        message: 'Hoặc hàng đợi chưa có đề thi bóc tách hoàn tất, hoặc bạn chưa tích chọn đề nào để ghi cơ sở dữ liệu.'
      });
      return;
    }

    setLoading(true);
    let successCount = 0;
    
    for (const item of selectedCompleted) {
      const ok = await handleSaveToDatabase(item);
      if (ok) {
        successCount++;
        // Remove item from queue as it is processed successfully
        setQueue(prev => prev.filter(q => q.id !== item.id));
      }
    }

    setLoading(false);
    setSelectedReviewItem(null);

    onShowModal({
      type: 'success',
      title: 'Đồng bộ lô hoàn tất!',
      message: `Đã nạp và lưu vĩnh viễn ${successCount}/${selectedCompleted.length} đề thi bóc tách thành công vào Cloud Firestore.`
    });
  };

  // Toggle selection for individual items
  const handleToggleSelect = (id: string) => {
    setQueue(prev => prev.map(item => 
      item.id === id ? { ...item, isSelected: !item.isSelected } : item
    ));
  };

  // Toggle select all
  const handleToggleSelectAll = () => {
    const newVal = !isAllSelected;
    setIsAllSelected(newVal);
    setQueue(prev => prev.map(item => ({ ...item, isSelected: newVal })));
  };

  // Remove single item from queue
  const handleRemoveFromQueue = (id: string) => {
    setQueue(prev => prev.filter(item => item.id !== id));
    if (selectedReviewItem?.id === id) {
      setSelectedReviewItem(null);
    }
  };

  // Clear queue
  const handleClearQueue = () => {
    setQueue([]);
    setSelectedReviewItem(null);
  };

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-200">
      
      {/* Upper Grid: Setup Input & Instructions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Side: Three Options of Input */}
        <div className="lg:col-span-7 bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-xs space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h2 className="font-extrabold text-slate-900 text-xl tracking-tight">Khu nạp & Bóc tách học liệu</h2>
              <p className="text-slate-400 text-xs mt-1">Chọn 1 trong 3 cách thức để nạp cấu trúc đề thi mới vào hàng đợi bóc tách.</p>
            </div>
            <span className="p-2.5 bg-indigo-50 text-indigo-700 rounded-xl">
              <Database className="h-5 w-5" />
            </span>
          </div>

          {/* Option Selector Tabs */}
          <div className="grid grid-cols-3 gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200/50">
            <button
              onClick={() => setImportMethod('pdf')}
              className={`flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                importMethod === 'pdf'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sparkles className="h-4 w-4 shrink-0 text-indigo-500" />
              <span>1. Upload PDF (Gemini)</span>
            </button>
            <button
              onClick={() => setImportMethod('file_json')}
              className={`flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                importMethod === 'file_json'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileCode className="h-4 w-4 shrink-0 text-slate-500" />
              <span>2. File JSON/TXT</span>
            </button>
            <button
              onClick={() => setImportMethod('manual_paste')}
              className={`flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                importMethod === 'manual_paste'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="h-4 w-4 shrink-0 text-slate-500" />
              <span>3. Dán tay JSON</span>
            </button>
          </div>

          {/* Tab 1 Content: PDF & Gemini AI */}
          {importMethod === 'pdf' && (
            <div className="space-y-4 pt-1">
              <div className="border border-indigo-200 bg-indigo-50/20 p-5 rounded-2.5xl space-y-3">
                <span className="bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase font-mono tracking-wider">
                  MÔ HÌNH BÓC TÁCH: GEMINI 1.5/2.5 BENTO
                </span>
                <p className="text-slate-700 text-xs leading-relaxed">
                  Trí tuệ nhân tạo Gemini tích hợp của chúng tôi sẽ xử lý OCR toàn bộ đề thi PDF (gồm cả bảng biểu, tranh vẽ và đoạn văn đọc hiểu), tự động lập chỉ mục từ vựng, ngữ pháp cốt lõi CEFR, tạo định dạng câu trắc nghiệm chuẩn chỉnh.
                </p>
                <p className="text-slate-500 text-[10px]^ pb-1 leading-normal font-medium">
                  * Hỗ trợ tải nhiều file PDF cùng một lúc để bóc tách tuần tự trong hàng đợi thông minh.
                </p>

                <div className="flex items-center justify-center w-full">
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-indigo-200 hover:border-indigo-400 bg-white/70 hover:bg-indigo-50/10 rounded-2xl cursor-pointer transition-all">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center px-4">
                      <Upload className="h-8 w-8 text-indigo-500 animate-pulse mb-2" />
                      <p className="text-xs text-slate-600 font-bold">Kéo thả hoặc Nhấp vào đây để tải PDF</p>
                      <p className="text-[10px] text-slate-400 mt-1">Chấp nhận .pdf (Hỗ trợ nạp theo lô liên hoàn)</p>
                    </div>
                    <input
                      type="file"
                      accept=".pdf"
                      multiple
                      onChange={handlePdfUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2 Content: JSON/TXT Upload */}
          {importMethod === 'file_json' && (
            <div className="space-y-4 pt-1">
              <div className="border border-slate-200 bg-slate-50 p-5 rounded-2.5xl space-y-3">
                <span className="bg-slate-700 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase font-mono tracking-wider">
                  NẠP TỆP SẮP ARCHIVE SẴN
                </span>
                <p className="text-slate-700 text-xs leading-relaxed">
                  Nếu bạn đã lưu trữ cấu trúc đề thi dạng JSON chuẩn của hệ thống hoặc nhận được file cấu trúc từ các giáo viên khác, hãy chọn tải các file <code className="bg-white px-1.5 py-0.5 border text-rose-600 font-mono text-[10px] rounded">.json</code> hoặc <code className="bg-white px-1.5 py-0.5 border text-rose-600 font-mono text-[10px] rounded">.txt</code> để nạp nhanh hàng loạt không cần qua AI xử lý lại.
                </p>

                <div className="flex items-center justify-center w-full">
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 hover:border-indigo-400 bg-white/70 hover:bg-slate-50 rounded-2xl cursor-pointer transition-all">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center px-4">
                      <FileCode className="h-8 w-8 text-indigo-500 mb-2" />
                      <p className="text-xs text-slate-600 font-bold">Kéo thả hoặc Click để tải tệp cấu trúc JSON</p>
                      <p className="text-[10px] text-slate-400 mt-1">Chấp nhận .json hoặc .txt chứa mảng / một đề thi</p>
                    </div>
                    <input
                      type="file"
                      accept=".json,.txt"
                      multiple
                      onChange={handleJsonTxtUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3 Content: Paste Manual JSON */}
          {importMethod === 'manual_paste' && (
            <div className="space-y-4 pt-1">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Tiêu đề thô cho phân đoạn dán:</label>
                  <button
                    type="button"
                    onClick={handleFillSampleJson}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-bold cursor-pointer"
                  >
                    Sinh mẫu JSON đề thi 🛠️
                  </button>
                </div>
                <input
                  type="text"
                  value={pastedTitle}
                  onChange={(e) => setPastedTitle(e.target.value)}
                  className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-indigo-500 font-bold"
                  placeholder="Nhập tiêu đề hoặc để mặc định để phân biệt..."
                />

                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block pt-2">Nội dung văn bản JSON:</label>
                <textarea
                  value={pastedJson}
                  onChange={(e) => setPastedJson(e.target.value)}
                  rows={6}
                  className="w-full text-xs p-3.5 font-mono bg-slate-900 text-slate-100 border border-slate-700/50 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                  placeholder="Dán mã cấu trúc JSON (đối tượng đơn lẻ hoặc mảng chứa nhiều đề thi)..."
                />

                <button
                  type="button"
                  onClick={handlePasteImport}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="h-4 w-4" /> Nạp chuỗi đã dán vào hàng đợi bóc tách
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Right Side: Quick Instructions Panel */}
        <div className="lg:col-span-5 bg-gradient-to-br from-slate-900 to-indigo-950 p-6 md:p-8 rounded-3xl text-white space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <h3 className="font-bold text-base tracking-tight text-indigo-300 flex items-center gap-2">
              <Info className="h-4 w-4 shrink-0" /> Bản mẫu cấu trúc học liệu chuẩn (JSON Pattern)
            </h3>
            <p className="text-slate-300 text-xs leading-relaxed">
              Dù bóc tách bằng AI hay nhập dữ liệu tĩnh, cấu trúc học tập luôn tuân thủ mô hình phân đoạn (Passages) chứa câu hỏi (Questions) bên trong. 
            </p>

            <div className="bg-black/40 p-4 rounded-xl border border-white/10 font-mono text-[10px] text-slate-300 space-y-1.5 h-64 overflow-y-auto">
              <p className="text-indigo-400">// Thuộc tính cha của đề thi</p>
              <p><span className="text-emerald-400">"title"</span>: "Đề thi khảo sát lớp 10 năm ...",</p>
              <p><span className="text-emerald-400">"grade"</span>: 10, <span className="text-slate-500">// Số lớp học (6 / 10 / 12)</span></p>
              <p><span className="text-emerald-400">"duration"</span>: 60, <span className="text-slate-500">// Thời gian làm bài phút</span></p>
              <p><span className="text-emerald-400">"passages"</span>: [</p>
              <p className="pl-4 text-amber-300">// Mỗi bài đọc hiểu hoặc cụm câu hỏi là 1 passage</p>
              <p className="pl-4">{`{`}</p>
              <p className="pl-8"><span className="text-emerald-400">"title"</span>: "Phần đọc hiểu số 1",</p>
              <p className="pl-8"><span className="text-emerald-400">"content"</span>: "[Bài khoá tiếng Anh hoặc chỉ thị đề bài]",</p>
              <p className="pl-8"><span className="text-emerald-400">"questions"</span>: [</p>
              <p className="pl-12">{`{`}</p>
              <p className="pl-16"><span className="text-emerald-400">"questionNumber"</span>: 1,</p>
              <p className="pl-16"><span className="text-emerald-400">"text"</span>: "Nội dung câu hỏi bài viết...",</p>
              <p className="pl-16"><span className="text-emerald-400">"options"</span>: {`{ "A": "...", "B": "..." }`},</p>
              <p className="pl-16"><span className="text-emerald-400">"correctAnswer"</span>: "A",</p>
              <p className="pl-16"><span className="text-emerald-400">"explanation"</span>: "Lời giải chi tiết ngữ pháp",</p>
              <p className="pl-16"><span className="text-emerald-400">"difficulty"</span>: "B1",</p>
              <p className="pl-16"><span className="text-emerald-400">"grammarCategory"</span>: "Tense rules"</p>
              <p className="pl-12">{`}`}</p>
              <p className="pl-8">]</p>
              <p className="pl-4">{`}`}</p>
              <p>]</p>
            </div>
          </div>

          <div className="pt-4 border-t border-white/10 text-xs text-slate-400 leading-normal font-sans">
            Mẹo: Bóc tách bằng <strong className="text-indigo-400 font-bold">Gemini AI</strong> cho phép băm file PDF bất kì. Sau khi có kết quả thô, hãy điều chỉnh tiêu đề chi tiết ở bảng rà soát bên dưới trước khi đồng ý nạp.
          </div>
        </div>

      </div>

      {/* Middle Grid: Queue / Batch Processing Area */}
      <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <h3 className="font-extrabold text-slate-900 text-lg tracking-tight flex items-center gap-2">
              Hàng đợi xử lý thông tin ({queue.length} đề thô)
            </h3>
            <p className="text-slate-400 text-xs">Các đề thi bóc tách thành công nằm ở trạng thái sẵn sàng để kiểm tra nội dung và nạp vào Cloud Firestore.</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {queue.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleClearQueue}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Xóa hàng đợi
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleBatchSave}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-all active:scale-[0.98]"
                >
                  <Database className="h-4 w-4" /> Ghi các đề đã chọn vào DB ({queue.filter(q => q.isSelected && q.status === 'completed').length})
                </button>
              </>
            )}
          </div>
        </div>

        {queue.length === 0 ? (
          <div className="py-12 text-center text-slate-400 space-y-2">
            <Clock className="h-10 w-10 mx-auto text-slate-300 stroke-1" />
            <p className="text-xs font-bold">Hàng đợi bóc tách đang trống.</p>
            <p className="text-[10px] text-slate-400 max-w-md mx-auto leading-normal">Bạn hãy chọn tệp PDF bóc tách AI, tải các file .json cấu trúc tĩnh hoặc dán thông tin để hệ thống tiến hành lập hàng đợi tại đây.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 uppercase tracking-widest font-bold text-[10px]">
                  <th className="py-3 px-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={handleToggleSelectAll}
                      className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                    />
                  </th>
                  <th className="py-3 px-4">Tên đề thi / Nguồn nạp</th>
                  <th className="py-3 px-4">Phân loại</th>
                  <th className="py-3 px-4">Thông số bóc tách</th>
                  <th className="py-3 px-4">Trạng thái</th>
                  <th className="py-3 px-4 text-right">Tác vụ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {queue.map((item) => {
                  const exam = item.parsedExam;
                  const totalQuestions = exam?.passages 
                    ? exam.passages.reduce((c, p) => c + (p.questions?.length || 0), 0)
                    : (exam?.numQuestions || 0);

                  return (
                    <tr 
                      key={item.id} 
                      className={`hover:bg-slate-50/50 transition-colors ${
                        selectedReviewItem?.id === item.id ? 'bg-indigo-50/30' : ''
                      }`}
                    >
                      <td className="py-4 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={!!item.isSelected}
                          onChange={() => handleToggleSelect(item.id)}
                          disabled={item.status !== 'completed'}
                          className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 disabled:opacity-35"
                        />
                      </td>
                      <td className="py-4 px-4 font-semibold text-slate-800">
                        <div className="truncate max-w-[280px]" title={item.sourceName}>
                          {item.sourceName}
                        </div>
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-md font-extrabold font-mono mt-1 inline-block bg-slate-100 text-slate-500">
                          {item.importMethod === 'pdf' ? '📖 PDF & Gemini AI' :
                           item.importMethod === 'file_json' ? '📁 Tệp JSON/TXT' : '⌨ Dán tay JSON'}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-slate-500">
                        {exam ? (
                          <div className="space-y-0.5 font-bold">
                            <span className="bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.5 rounded">
                              Khối lớp {exam.grade || 10}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-300">N/A</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        {exam ? (
                          <div className="space-y-1 text-slate-600 font-bold text-[11px]">
                            <p>⏱ {exam.duration || 60} phút | ✏ {totalQuestions} câu hỏi</p>
                            <p className="text-[10px] text-slate-400 font-medium truncate max-w-[180px]">
                              Nguồn: {exam.publisher || 'Chưa định nguồn'}
                            </p>
                          </div>
                        ) : (
                          <span className="text-slate-300">Đang chờ cấu trúc...</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-1.5">
                          {item.status === 'processing' && (
                            <>
                              <RefreshCw className="h-3.5 w-3.5 text-indigo-600 animate-spin shrink-0" />
                              <span className="text-indigo-600 font-extrabold animate-pulse leading-none">{item.progress}</span>
                            </>
                          )}
                          {item.status === 'waiting' && (
                            <>
                              <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                              <span className="text-amber-500 font-bold leading-none">{item.progress}</span>
                            </>
                          )}
                          {item.status === 'completed' && (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                              <span className="text-emerald-700 font-extrabold leading-none">{item.progress}</span>
                            </>
                          )}
                          {item.status === 'failed' && (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1">
                                <AlertCircle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                                <span className="text-rose-600 font-bold leading-none">{item.progress}</span>
                              </div>
                              {item.error && (
                                <p className="text-[9px] text-rose-500 max-w-[180px] truncate leading-normal" title={item.error}>
                                  Lỗi: {item.error}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {item.status === 'completed' && (
                            <>
                              <button
                                type="button"
                                onClick={() => setSelectedReviewItem(item)}
                                className="p-1 px-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                                title="Rà soát"
                              >
                                <Pencil className="h-3.5 w-3.5" /> Rà soát đề & Sửa
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  const ok = await handleSaveToDatabase(item);
                                  if (ok) {
                                    onShowModal({
                                      type: 'success',
                                      title: 'Đăng ký thành công',
                                      message: `Đề thi '${item.parsedExam?.title}' đã được ghi nhận thành công.`
                                    });
                                    setQueue(prev => prev.filter(q => q.id !== item.id));
                                    if (selectedReviewItem?.id === item.id) {
                                      setSelectedReviewItem(null);
                                    }
                                  } else {
                                    onShowModal({
                                      type: 'danger',
                                      title: 'Có lỗi xảy ra',
                                      message: 'Lỗi ghi vĩnh viễn dữ liệu Firestore. Vui lòng rà soát cài đặt liên kết Firebase của bạn.'
                                    });
                                  }
                                }}
                                className="p-1 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-lg transition-colors cursor-pointer"
                                title="Lưu trực tiếp"
                              >
                                Lưu đề
                              </button>
                            </>
                          )}
                          {item.status === 'failed' && (
                            <button
                              type="button"
                              onClick={() => {
                                setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'waiting', progress: 'Đang chuẩn bị file...' } : q));
                              }}
                              className="p-1 px-2.5 bg-amber-50 hover:bg-amber-100 text-amber-700 font-bold rounded-lg cursor-pointer"
                              title="Thử lại"
                            >
                              Thử lại
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveFromQueue(item.id)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-lg shrink-0 cursor-pointer transition-colors"
                            title="Xóa ra khỏi hàng đợi"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lower Grid: Comprehensive Preview, Edit and Validation before Database write */}
      {selectedReviewItem && selectedReviewItem.parsedExam && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 animate-in slide-in-from-bottom duration-200">
          
          {/* Left Block: Meta Editor */}
          <div className="xl:col-span-5 bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-xs space-y-5">
            <h3 className="font-extrabold text-slate-900 text-base tracking-tight flex items-center justify-between border-b pb-3 mb-2">
              <span>Rà soát & Điều chỉnh thuộc tính</span>
              <span className="text-xs bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full">
                Sửa thô
              </span>
            </h3>

            <div className="space-y-4 text-xs font-bold text-slate-700">
              <div>
                <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Tên hiển thị (Tiêu đề):</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 font-semibold"
                />
              </div>

              <div>
                <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Tên cuộc thi chính thức:</label>
                <input
                  type="text"
                  value={editExamName}
                  onChange={(e) => setEditExamName(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Mã đề / Ký hiệu:</label>
                  <input
                    type="text"
                    value={editExamCode}
                    onChange={(e) => setEditExamCode(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 text-slate-700 font-mono font-bold"
                    placeholder="E.g. CG-2025"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Phân định Lớp (Khối):</label>
                  <select
                    value={editGrade}
                    onChange={(e) => setEditGrade(Number(e.target.value))}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 font-semibold"
                  >
                    <option value={6}>Khối 6 (Sát hạch chuyên)</option>
                    <option value={10}>Khối 10 (Tuyển sinh)</option>
                    <option value={12}>Khối 12 (Tốt nghiệp THPT)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Thời lượng (Phút):</label>
                  <input
                    type="number"
                    value={editDuration}
                    onChange={(e) => setEditDuration(Number(e.target.value))}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Tổng Số câu hỏi gốc:</label>
                  <input
                    type="number"
                    value={editNumQuestions}
                    onChange={(e) => setEditNumQuestions(Number(e.target.value))}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Nhà xuất bản / Đơn vị đề xuất:</label>
                  <input
                    type="text"
                    value={editPublisher}
                    onChange={(e) => setEditPublisher(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Năm tổ chức:</label>
                  <input
                    type="number"
                    value={editYear}
                    onChange={(e) => setEditYear(Number(e.target.value))}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 uppercase tracking-wider text-[9px] mb-1">Phân loại đề thi:</label>
                <select
                  value={editClassification}
                  onChange={(e) => setEditClassification(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 font-semibold text-xs"
                >
                  {EXAM_CLASSIFICATIONS.map(cls => (
                    <option key={cls} value={cls}>{cls}</option>
                  ))}
                </select>
              </div>

              <div className="pt-4 grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={handleApplyMetaEdit}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-xs flex items-center justify-center gap-1 cursor-pointer active:scale-95"
                >
                  <Check className="h-4 w-4" /> Đồng bộ điều chỉnh lên Hàng đợi
                </button>
              </div>
            </div>
          </div>

          {/* Right Block: Interactive Structure Viewer */}
          <div className="xl:col-span-7 bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-xs flex flex-col justify-between max-h-[720px] overflow-hidden">
            <div className="space-y-4 overflow-y-auto pr-1 flex-1 min-h-0">
              <h3 className="font-extrabold text-slate-900 text-base tracking-tight border-b pb-3 mb-2 flex items-center gap-1.5 shrink-0">
                <BookOpen className="h-4 w-4 text-indigo-600" /> Cấu trúc phân đoạn bóc tách ({selectedReviewItem.parsedExam.passages?.length || 0} bài khoá)
              </h3>

              <div className="space-y-6">
                {selectedReviewItem.parsedExam.passages?.map((passage, pIdx) => (
                  <div key={pIdx} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="bg-slate-200 text-slate-700 text-[10px] font-extrabold px-2 py-0.5 rounded tracking-wide">
                        SƠ ĐỒ PHÂN HOẠCH SỐ {pIdx + 1}
                      </span>
                      {passage.vocabularyCategory && (
                        <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded font-bold">
                          Theme chính: {passage.vocabularyCategory}
                        </span>
                      )}
                    </div>

                    <div className="font-bold text-slate-800 text-xs">
                      {passage.title || 'Mục tiêu đề phân đoạn'}
                    </div>

                    <p className="text-[11px] text-slate-500 break-words whitespace-pre-line bg-white/70 p-3 rounded-xl border border-slate-200/40">
                      {passage.content || 'Nội dung bài khóa / đề dẫn.'}
                    </p>

                    {/* Question inside passage */}
                    <div className="space-y-3.5 pt-2">
                      <p className="text-[10px] font-bold text-indigo-950 uppercase tracking-widest block">Danh sách câu hỏi kèm theo ({passage.questions?.length || 0} câu):</p>
                      
                      {passage.questions?.map((q, qIdx) => (
                        <div key={qIdx} className="bg-white p-3.5 border border-slate-200 rounded-xl space-y-2 text-[11px]">
                          <div className="flex items-center justify-between">
                            <span className="font-extrabold text-indigo-600">
                              Câu hỏi số {q.questionNumber}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              {q.difficulty && (
                                <span className="bg-slate-100 text-slate-500 px-1.5 rounded text-[9px] font-bold">
                                  {q.difficulty}
                                </span>
                              )}
                              {q.grammarCategory && (
                                <span className="bg-amber-50 text-amber-700 px-1.5 rounded text-[9px] font-bold">
                                  {q.grammarCategory}
                                </span>
                              )}
                            </div>
                          </div>

                          <div 
                            className="font-semibold text-slate-800"
                            dangerouslySetInnerHTML={{ __html: q.text }}
                          />

                          {/* Options — or the accepted text answer(s) for free-text questions */}
                          {(!q.options || Object.keys(q.options).length === 0 || q.answerType === 'text') ? (
                            <div className="p-1.5 px-2.5 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-800 font-bold">
                              ✍️ Tự luận — Đáp án chấp nhận: {q.correctAnswer}
                            </div>
                          ) : (
                          <div className="grid grid-cols-2 gap-2 text-slate-600 font-medium">
                            {Object.entries(q.options).map(([optKey, optVal]) => (
                              <div key={optKey} className={`p-1.5 px-2.5 rounded-lg border ${
                                q.correctAnswer === optKey
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-bold'
                                  : 'bg-slate-50 border-slate-100'
                              }`}>
                                <span className="font-extrabold mr-1">{optKey}.</span> {optVal}
                              </div>
                            ))}
                          </div>
                          )}

                          {q.explanation && (
                            <p className="p-2 bg-slate-50 text-slate-500 font-serif rounded-lg border border-slate-100 italic leading-relaxed text-[10px]^">
                              Giải thích: {q.explanation}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>

                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 mt-4 flex items-center justify-between gap-4 shrink-0">
              <div className="text-[10px] font-medium text-slate-400">
                Hãy chắc chắn đã click nút <strong className="text-slate-600">Đồng bộ điều chỉnh</strong> nếu bạn thay đổi các ô nhập bên trái.
              </div>
              <button
                type="button"
                onClick={async () => {
                  const ok = await handleSaveToDatabase(selectedReviewItem);
                  if (ok) {
                    onShowModal({
                      type: 'success',
                      title: 'Đăng ký thành công',
                      message: `Đề thi '${selectedReviewItem.parsedExam?.title}' đã được ghi nhận thành công.`
                    });
                    setQueue(prev => prev.filter(q => q.id !== selectedReviewItem.id));
                    setSelectedReviewItem(null);
                  } else {
                    onShowModal({
                      type: 'danger',
                      title: 'Có lỗi xảy ra',
                      message: 'Lỗi ghi vĩnh viễn dữ liệu Firestore. Vui lòng rà soát cài đặt liên kết Firebase của bạn.'
                    });
                  }
                }}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                Ghi đề thi này vào Database ✔
              </button>
            </div>
          </div>

        </div>
      )}

    </div>
  );
}
