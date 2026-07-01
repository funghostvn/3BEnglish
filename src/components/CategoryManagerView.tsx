import React, { useEffect, useMemo, useState } from 'react';
import { Exam, Question, VOCABULARY_THEMES, GRAMMAR_THEMES } from '../types';
import { fetchCollection, updateExamById } from '../services/firestore';
import { Search, Filter, AlertCircle, Edit, Check } from 'lucide-react';

interface CategoryManagerViewProps {
  onShowModal: (config: { type: 'success' | 'warning' | 'danger' | 'info'; title: string; message: string }) => void;
}

export default function CategoryManagerView({ onShowModal }: CategoryManagerViewProps) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonStandardOnly, setNonStandardOnly] = useState(false);

  // Filter params
  const [selectedGrammar, setSelectedGrammar] = useState('all');
  const [selectedVocab, setSelectedVocab] = useState('all');

  // Change modal state
  const [editingLoc, setEditingLoc] = useState<{ examId: string; pIdx: number; qIdx: number } | null>(null);
  const [tempVocab, setTempVocab] = useState('');
  const [tempGrammar, setTempGrammar] = useState('');

  useEffect(() => {
    fetchExams();
  }, []);

  const fetchExams = async () => {
    setLoading(true);
    try {
      const list = await fetchCollection<Exam>('exams');
      setExams(list);
    } catch (err) {
      console.error(err);
      onShowModal({ type: 'danger', title: 'Lỗi tải dữ liệu', message: 'Không thể tải danh sách đề thi. Vui lòng kiểm tra kết nối mạng và tải lại trang.' });
    } finally {
      setLoading(false);
    }
  };

  // Collect flat list of questions across exams along with pointers
  interface FlatQuestion {
    examId: string;
    examTitle: string;
    passageIdx: number;
    passageTitle: string;
    questionIdx: number;
    question: Question;
    currentVocab: string;
    currentGrammar: string;
    isVocabStandard: boolean;
    isGrammarStandard: boolean;
  }

  const getFlatList = (): FlatQuestion[] => {
    const list: FlatQuestion[] = [];
    exams.forEach(ex => {
      (ex.passages || []).forEach((pass, pIdx) => {
        const vCat = pass.vocabularyCategory || '';
        const isVStd = VOCABULARY_THEMES.includes(vCat);
        
        (pass.questions || []).forEach((q, qIdx) => {
          const gCat = q.grammarCategory || '';
          const isGStd = GRAMMAR_THEMES.includes(gCat);

          list.push({
            examId: ex.id,
            examTitle: ex.title,
            passageIdx: pIdx,
            passageTitle: pass.title,
            questionIdx: qIdx,
            question: q,
            currentVocab: vCat,
            currentGrammar: gCat,
            isVocabStandard: isVStd,
            isGrammarStandard: isGStd
          });
        });
      });
    });
    return list;
  };

  const unfiltered = useMemo(() => getFlatList(), [exams]);

  // Filtered queries
  const filtered = useMemo(() => unfiltered.filter(item => {
    // 1. Standard rules anomalous search
    if (nonStandardOnly) {
      if (item.isVocabStandard && item.isGrammarStandard) return false;
    }
    // 2. Grammar matching
    if (selectedGrammar !== 'all') {
      if (item.currentGrammar !== selectedGrammar) return false;
    }
    // 3. Vocab matching
    if (selectedVocab !== 'all') {
      if (item.currentVocab !== selectedVocab) return false;
    }
    return true;
  }), [unfiltered, nonStandardOnly, selectedGrammar, selectedVocab]);

  const handleEditClick = (item: FlatQuestion) => {
    setEditingLoc({
      examId: item.examId,
      pIdx: item.passageIdx,
      qIdx: item.questionIdx
    });
    setTempVocab(item.currentVocab);
    setTempGrammar(item.currentGrammar);
  };

  const handleSaveCategoryUpdate = async () => {
    if (!editingLoc) return;

    try {
      const examToUpdate = exams.find(e => e.id === editingLoc.examId);
      if (!examToUpdate) return;

      // Deep-clone the passage/question being edited so we don't mutate the
      // objects still referenced by the `exams` state array in place.
      const updatedPassages = examToUpdate.passages.map((p, pIdx) => {
        if (pIdx !== editingLoc.pIdx) return p;
        return {
          ...p,
          vocabularyCategory: tempVocab,
          questions: p.questions.map((q, qIdx) => (
            qIdx === editingLoc.qIdx ? { ...q, grammarCategory: tempGrammar } : q
          )),
        };
      });

      await updateExamById(examToUpdate.id, { passages: updatedPassages });

      onShowModal({
        type: 'success',
        title: 'Cập nhật danh mục thành công',
        message: 'Từ điển từ vựng và kết cấu ngữ pháp chủ đề đã được đồng bộ hóa thành công vào đề thi.'
      });

      setEditingLoc(null);
      fetchExams();
    } catch (err) {
      console.error(err);
      onShowModal({ type: 'danger', title: 'Cập nhật thất bại', message: 'Không thể lưu thay đổi phân loại. Vui lòng thử lại.' });
    }
  };

  if (loading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-200">
      
      <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-xs space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h3 className="text-slate-800 font-bold text-lg">Quản trị danh mục Chủ đề & Ngữ pháp Từ vựng</h3>
            <p className="text-slate-400 text-xs mt-1">
              Rà soát và chuẩn hóa bộ câu hỏi cho đúng với <b>{VOCABULARY_THEMES.length} Chủ đề từ vựng</b> và <b>{GRAMMAR_THEMES.length} Chủ đề ngữ pháp chuẩn</b>.
            </p>
          </div>

          <label className="inline-flex items-center gap-2 cursor-pointer bg-red-50 border border-red-200 px-4 py-2 rounded-xl text-red-700 text-xs font-bold active:scale-95 transition-all">
            <input
              type="checkbox"
              checked={nonStandardOnly}
              onChange={(e) => setNonStandardOnly(e.target.checked)}
              className="rounded text-red-600 focus:ring-red-500 font-bold"
            />
            <span>⚠️ Chỉ hiển thị phân loại LỖI lệch chuẩn</span>
          </label>
        </div>

        {/* Global filter bars */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl text-xs">
          <div>
            <label className="text-slate-500 font-bold uppercase tracking-wider block mb-1">Kiểm từ vựng:</label>
            <select
              value={selectedVocab}
              onChange={(e) => setSelectedVocab(e.target.value)}
              className="w-full p-2 border bg-white rounded-lg font-medium text-slate-700"
            >
              <option value="all">Tất cả từ vựng</option>
              {VOCABULARY_THEMES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className="text-slate-500 font-bold uppercase tracking-wider block mb-1">Kiểm ngữ pháp:</label>
            <select
              value={selectedGrammar}
              onChange={(e) => setSelectedGrammar(e.target.value)}
              className="w-full p-2 border bg-white rounded-lg font-medium text-slate-700"
            >
              <option value="all">Tất cả cấu trúc</option>
              {GRAMMAR_THEMES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>

        {/* Questions Grid table list */}
        <div className="overflow-hidden border border-slate-100 rounded-2xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs font-bold border-b border-slate-100 uppercase tracking-wider">
                <th className="px-6 py-4">Có mặt trong Kỳ thi</th>
                <th className="px-6 py-4">Câu hỏi mẫu</th>
                <th className="px-6 py-4">Chủ điểm Từ vựng (Passage)</th>
                <th className="px-6 py-4">Chủ điểm Ngữ pháp</th>
                <th className="px-6 py-4 text-right">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    Không tìm thấy câu hỏi lệch chuẩn nào trong bộ cơ sở dữ liệu hiện tại! 👏
                  </td>
                </tr>
              ) : (
                filtered.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-900 max-w-[180px] break-words">{item.examTitle}</td>
                    <td className="px-6 py-4 max-w-sm truncate text-slate-500 italic">
                      Câu {item.question.questionNumber}: {(item.question.text || '').replace(/<[^>]*>/g, '')}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded-lg ${
                        item.isVocabStandard
                          ? 'bg-green-50 text-green-700 font-medium'
                          : 'bg-red-50 text-red-700 border border-red-200 font-bold'
                      }`}>
                        {item.currentVocab || 'Vô danh'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded-lg ${
                        item.isGrammarStandard
                          ? 'bg-indigo-50 text-indigo-700 font-medium'
                          : 'bg-red-50 text-red-700 border border-red-200 font-bold'
                      }`}>
                        {item.currentGrammar || 'Vô danh'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleEditClick(item)}
                        className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-2.5 py-1.5 rounded-lg border border-indigo-200 cursor-pointer"
                      >
                        Chỉnh sửa
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Editing Dialog Portal inline */}
      {editingLoc && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-150">
            
            <div className="px-5 py-4 bg-indigo-50 border-b flex justify-between items-center">
              <h4 className="font-bold text-slate-800 text-sm">Chỉnh sửa phân loại chủ đề câu hỏi</h4>
              <button onClick={() => setEditingLoc(null)} className="text-slate-400 hover:text-slate-600 font-bold">×</button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div>
                <label className="font-bold block mb-1 uppercase tracking-wider text-slate-500">Chủ đề từ vựng (Chuỗi đồng bộ):</label>
                <select
                  value={tempVocab}
                  onChange={(e) => setTempVocab(e.target.value)}
                  className="w-full p-2 border bg-white rounded-lg font-medium text-slate-700 text-xs"
                >
                  {VOCABULARY_THEMES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

              <div>
                <label className="font-bold block mb-1 uppercase tracking-wider text-slate-500">Chủ tố Ngữ pháp (Chi tiết):</label>
                <select
                  value={tempGrammar}
                  onChange={(e) => setTempGrammar(e.target.value)}
                  className="w-full p-2 border bg-white rounded-lg font-medium text-slate-700 text-xs"
                >
                  {GRAMMAR_THEMES.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>

            <div className="px-5 py-4 bg-slate-50 border-t flex justify-end gap-3">
              <button
                onClick={() => setEditingLoc(null)}
                className="border px-4 py-2 rounded-lg text-xs"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveCategoryUpdate}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-lg text-xs"
              >
                Lưu đồng bộ
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
