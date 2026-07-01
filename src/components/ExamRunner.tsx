import React from 'react';
import { BookOpen, Award, CheckCircle, AlertCircle, Bookmark, ArrowRight, ArrowLeft, Send, RefreshCw, AlertTriangle, Clock } from 'lucide-react';
import { ExamSession } from '../hooks/useExamSession';

type FontSize = 'sm' | 'base' | 'lg' | 'xl';

function getPassageTitleClass(size: FontSize) {
  switch (size) {
    case 'sm': return 'text-base font-bold text-slate-800 mb-2';
    case 'lg': return 'text-xl md:text-2xl font-bold text-slate-800 mb-3';
    case 'xl': return 'text-2xl md:text-3xl font-bold text-slate-800 mb-4';
    case 'base':
    default: return 'text-lg md:text-xl font-bold text-slate-800 mb-2.5';
  }
}

function getPassageContentClass(size: FontSize) {
  switch (size) {
    case 'sm': return 'text-xs md:text-sm text-slate-700 leading-relaxed space-y-3 font-normal whitespace-pre-line';
    case 'lg': return 'text-base md:text-lg text-slate-700 leading-relaxed space-y-4 font-normal whitespace-pre-line';
    case 'xl': return 'text-lg md:text-xl text-slate-700 leading-relaxed space-y-5 font-normal whitespace-pre-line';
    case 'base':
    default: return 'text-sm md:text-base text-slate-700 leading-relaxed space-y-3.5 font-normal whitespace-pre-line';
  }
}

function getQuestionTextClass(size: FontSize) {
  switch (size) {
    case 'sm': return 'text-sm font-semibold text-slate-800 leading-snug whitespace-pre-line';
    case 'lg': return 'text-lg md:text-xl font-semibold text-slate-800 leading-snug whitespace-pre-line';
    case 'xl': return 'text-xl md:text-2xl font-bold text-slate-800 leading-snug whitespace-pre-line';
    case 'base':
    default: return 'text-base md:text-lg font-semibold text-slate-800 leading-snug whitespace-pre-line';
  }
}

function getOptionTextClass(size: FontSize) {
  switch (size) {
    case 'sm': return 'text-xs md:text-sm text-slate-700';
    case 'lg': return 'text-sm md:text-base text-slate-700';
    case 'xl': return 'text-base md:text-lg text-slate-700';
    case 'base':
    default: return 'text-[13px] md:text-sm text-slate-700';
  }
}

function formatTimerDisplay(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Full-screen quiz-taking UI shared by PracticeView and CustomTrainingView.
// All state/behavior lives in useExamSession(); this component is purely
// presentational and only requires activeExam + currentQuestion to be set.
export default function ExamRunner({ session }: { session: ExamSession }) {
  const {
    activeExam, currentQuestion, questionsList,
    userAnswers, markedQuestions, activeQuestionIdx, setActiveQuestionIdx,
    graded, scoreSummary, setScoreSummary,
    feedbackText, setFeedbackText, reportingQNum, setReportingQNum,
    layoutMode, setLayoutMode, practiceFontSize, setPracticeFontSize,
    showAllPassages, setShowAllPassages, activeMobileTab, setActiveMobileTab,
    timeRemaining, passageRefs,
    getActivePassageIdx, jumpToPassage, handleSelectOption, toggleMarked,
    submitExam, handleReportFeedback, handleRetake, quitExam,
  } = session;

  if (!activeExam || !currentQuestion) return null;

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
          <div className="bg-slate-800 p-0.5 rounded-lg border border-slate-700 flex text-[10px] md:text-xs font-bold items-center gap-0.5">
            <span className="text-slate-400 pl-1.5 pr-1 select-none text-[10px]">Cỡ chữ:</span>
            <button type="button" onClick={() => setPracticeFontSize('sm')} className={`px-2 py-1 rounded-md transition-all cursor-pointer ${practiceFontSize === 'sm' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`} title="Chữ nhỏ">A-</button>
            <button type="button" onClick={() => setPracticeFontSize('base')} className={`px-2 py-1 rounded-md transition-all cursor-pointer ${practiceFontSize === 'base' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`} title="Mặc định">A</button>
            <button type="button" onClick={() => setPracticeFontSize('lg')} className={`px-2 py-1 rounded-md transition-all cursor-pointer ${practiceFontSize === 'lg' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`} title="Chữ lớn">A+</button>
            <button type="button" onClick={() => setPracticeFontSize('xl')} className={`px-2 py-1 rounded-md transition-all cursor-pointer ${practiceFontSize === 'xl' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`} title="Cực lớn">A++</button>
          </div>

          <div className="bg-slate-800 p-0.5 rounded-lg border border-slate-700 flex text-[10px] md:text-xs">
            <button type="button" onClick={() => setLayoutMode('single')} className={`px-2.5 py-1.5 rounded-md font-bold transition-all cursor-pointer whitespace-nowrap ${layoutMode === 'single' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'}`} title="Cách 1: Hiển thị từng câu">1 Câu 1️⃣</button>
            <button type="button" onClick={() => setLayoutMode('passage_all')} className={`px-2.5 py-1.5 rounded-md font-bold transition-all cursor-pointer whitespace-nowrap ${layoutMode === 'passage_all' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'}`} title="Cách 2: Hiển thị cả đoạn">Cả đoạn 📚</button>
          </div>

          <div className="flex items-center gap-2">
            <div className="bg-slate-800/80 px-2.5 md:px-3 py-1 rounded-xl text-center flex items-center gap-1.5 border border-slate-700">
              <Clock className="h-3.5 w-3.5 text-indigo-400" />
              <span className="font-mono font-bold text-indigo-300 text-xs md:text-sm">{formatTimerDisplay(timeRemaining)}</span>
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
        <button type="button" onClick={() => setActiveMobileTab('passage')} className={`flex-1 py-3 text-center text-xs font-bold border-b-2 transition-all cursor-pointer ${activeMobileTab === 'passage' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}>
          📖 Đọc bài {(!showAllPassages ? `(Phần ${getActivePassageIdx() + 1})` : `(${activeExam.passages.length})`)}
        </button>
        <button type="button" onClick={() => setActiveMobileTab('question')} className={`flex-1 py-3 text-center text-xs font-bold border-b-2 transition-all cursor-pointer ${activeMobileTab === 'question' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}>
          ✏️ Trả lời ({activeQuestionIdx + 1}/{questionsList.length})
        </button>
      </div>

      {/* 2-Column Main Workspace */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0 bg-white">

        {/* LEFT: Section Passage Reading Area */}
        <div className={`flex-1 md:w-1/2 p-3.5 md:p-4.5 overflow-y-auto border-r border-slate-200 min-h-0 ${activeMobileTab === 'passage' ? 'block' : 'hidden md:block'}`}>
          <div className="flex items-center justify-between border-b border-slate-100 pb-1.5 mb-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-indigo-600" />
              <span className="font-bold text-slate-900 text-xs uppercase tracking-wider">Đoạn văn đọc hiểu</span>
            </div>
            <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              <button type="button" onClick={() => setShowAllPassages(false)} className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer ${!showAllPassages ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}>Đoạn liên quan</button>
              <button type="button" onClick={() => setShowAllPassages(true)} className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer ${showAllPassages ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}>Tất cả ({activeExam.passages.length})</button>
            </div>
          </div>

          <div className="prose max-w-none space-y-4">
            {activeExam.passages.map((passage, pIdx) => {
              const isPassageActive = (passage.questions || []).some(q => q.questionNumber === currentQuestion.questionNumber);
              if (!showAllPassages && !isPassageActive) return null;

              return (
                <div
                  key={pIdx}
                  ref={el => { passageRefs.current[pIdx] = el; }}
                  className={`transition-all duration-300 p-3.5 md:p-4 rounded-xl ${isPassageActive ? 'bg-indigo-50/50 border border-indigo-200 shadow-xs ring-4 ring-indigo-500/5' : 'opacity-65'}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="bg-indigo-100 text-indigo-700 text-[10px] px-2 py-0.5 rounded-md font-bold uppercase">
                      Sơ đồ {pIdx + 1} {isPassageActive && '🌟 (Đoạn tương ứng)'}
                    </span>
                    {passage.vocabularyCategory && (
                      <span className="bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.5 rounded font-medium">Chủ đề: {passage.vocabularyCategory}</span>
                    )}
                  </div>

                  <h3 className={getPassageTitleClass(practiceFontSize)}>{passage.title}</h3>
                  <div className={getPassageContentClass(practiceFontSize)} dangerouslySetInnerHTML={{ __html: passage.content }} />
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT: Active Question Stage */}
        <div className={`flex-1 md:w-1/2 flex flex-col overflow-y-auto p-3.5 md:p-4.5 bg-slate-50 min-h-0 ${activeMobileTab === 'question' ? 'flex' : 'hidden md:flex'}`}>

          {layoutMode === 'passage_all' ? (
            <div className="space-y-4 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between bg-white px-4 py-2 rounded-xl border border-slate-200/60 shadow-xs shrink-0">
                <div className="text-slate-600 text-xs font-semibold">
                  Đoạn văn <span className="text-slate-900 font-bold">{getActivePassageIdx() + 1}</span> / {activeExam.passages.length}
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={getActivePassageIdx() === 0} onClick={() => jumpToPassage(getActivePassageIdx() - 1)} className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold disabled:opacity-40 flex items-center gap-1 transition-all cursor-pointer">
                    <ArrowLeft className="h-3.5 w-3.5" /> Đoạn trước
                  </button>
                  <button type="button" disabled={getActivePassageIdx() === activeExam.passages.length - 1} onClick={() => jumpToPassage(getActivePassageIdx() + 1)} className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold disabled:opacity-40 flex items-center gap-1 transition-all cursor-pointer">
                    Đoạn tiếp <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="space-y-4 flex-1 overflow-y-auto pr-1">
                {[...(activeExam.passages[getActivePassageIdx()]?.questions || [])].sort((a, b) => a.questionNumber - b.questionNumber).map((q) => (
                  <div key={q.questionNumber} className="bg-white p-3.5 md:p-4.5 rounded-xl border border-slate-200/80 shadow-xs space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-150 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="bg-indigo-600 text-white font-extrabold text-[10px] px-2 py-0.5 rounded-md">Câu {q.questionNumber}</span>
                        <span className="bg-slate-100 text-slate-500 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded">CEFR: {q.difficulty}</span>
                        {q.grammarCategory && (
                          <span className="bg-slate-100 text-slate-500 text-[9px] px-1.5 py-0.5 rounded">Ngữ pháp: {q.grammarCategory}</span>
                        )}
                      </div>

                      <button type="button" onClick={() => toggleMarked(q.questionNumber)} className={`text-xs font-bold p-1 rounded-md transition-colors cursor-pointer ${markedQuestions[q.questionNumber] ? 'text-amber-500' : 'text-slate-400 hover:text-slate-600'}`}>
                        <Bookmark className={`h-4 w-4 ${markedQuestions[q.questionNumber] ? 'fill-current' : ''}`} />
                      </button>
                    </div>

                    <h4 className={getQuestionTextClass(practiceFontSize)} dangerouslySetInnerHTML={{ __html: q.text }} />

                    <div className="grid grid-cols-1 gap-2.5 pt-1.5">
                      {Object.entries(q.options).sort((a, b) => a[0].localeCompare(b[0])).map(([key, value]) => {
                        const isSelected = userAnswers[q.questionNumber] === key;
                        const isCorrect = q.correctAnswer === key;

                        let optionColor = 'border-slate-200 hover:border-indigo-400 bg-white hover:bg-indigo-50/25 text-slate-700';
                        if (isSelected) optionColor = 'border-indigo-600 bg-indigo-50/40 text-indigo-900 font-bold';
                        if (graded) {
                          if (isCorrect) optionColor = 'border-green-500 bg-green-50 text-green-800 font-bold';
                          else if (isSelected) optionColor = 'border-red-500 bg-red-50 text-red-800 font-bold';
                          else optionColor = 'border-slate-200 bg-white text-slate-400 opacity-60';
                        }

                        return (
                          <button key={key} onClick={() => handleSelectOption(q.questionNumber, key)} disabled={graded} className={`w-full text-left p-2.5 md:p-3 rounded-lg border flex items-start gap-2.5 transition-all cursor-pointer ${optionColor}`}>
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 ${isSelected ? 'bg-indigo-600 text-white' : graded && isCorrect ? 'bg-green-600 text-white' : graded && isSelected ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                              {key}
                            </span>
                            <span className={getOptionTextClass(practiceFontSize)} dangerouslySetInnerHTML={{ __html: value }} />
                          </button>
                        );
                      })}
                    </div>

                    {graded && (
                      <div className="border-t border-slate-100 pt-3 space-y-2.5 mt-2">
                        <div className={`p-3.5 rounded-xl flex gap-2.5 text-xs ${userAnswers[q.questionNumber] === q.correctAnswer ? 'bg-green-50/80 border border-green-200/50 text-green-900' : 'bg-red-50/80 border border-red-200/50 text-red-900'}`}>
                          {userAnswers[q.questionNumber] === q.correctAnswer ? (
                            <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                          )}
                          <div>
                            <p className="font-bold">
                              {userAnswers[q.questionNumber] === q.correctAnswer ? 'Chính xác! 🎉' : `Đáp án đúng phải là: ${q.correctAnswer}`}
                            </p>
                            {q.explanation && (
                              <p className="text-slate-600 text-[11px] leading-relaxed mt-1 whitespace-pre-line"><b>Giải thích:</b> {q.explanation}</p>
                            )}
                          </div>
                        </div>

                        {reportingQNum !== q.questionNumber ? (
                          <button onClick={() => setReportingQNum(q.questionNumber)} className="text-amber-600 hover:text-amber-800 text-[10px] font-semibold flex items-center gap-1 cursor-pointer">
                            <AlertTriangle className="h-3 w-3" /> Báo lỗi câu hỏi này
                          </button>
                        ) : (
                          <form onSubmit={handleReportFeedback} className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 space-y-2.5 mt-1 animate-in slide-in-from-top-2 duration-150">
                            <p className="text-[10px] text-amber-800 font-bold">Nội dung báo lỗi Câu {q.questionNumber}:</p>
                            <textarea value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-amber-500" placeholder="Có nhầm lẫn ở lời giải, gõ chữ trùng..." rows={2} required />
                            <div className="flex gap-2 justify-end">
                              <button type="button" onClick={() => setReportingQNum(null)} className="bg-white border text-[11px] font-bold px-2.5 py-1 rounded-lg cursor-pointer text-slate-500">Hủy</button>
                              <button type="submit" className="bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold px-3.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer">Gửi phản hồi</button>
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
            <>
              <div className="flex items-center justify-between bg-white px-4 py-1.5 md:py-2 rounded-xl border border-slate-200/60 shadow-xs mb-3 shrink-0">
                <div className="text-slate-500 text-xs font-semibold">
                  Câu hỏi <span className="text-slate-900 font-bold">{activeQuestionIdx + 1}</span> / {questionsList.length}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => toggleMarked(currentQuestion.questionNumber)} className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${markedQuestions[currentQuestion.questionNumber] ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}>
                    <Bookmark className={`h-3.5 w-3.5 ${markedQuestions[currentQuestion.questionNumber] ? 'fill-current' : ''}`} />
                    {markedQuestions[currentQuestion.questionNumber] ? 'Đã ghim' : 'Ghim câu hỏi'}
                  </button>
                </div>
              </div>

              <div className="bg-white p-4 md:p-5 rounded-xl border border-slate-200/80 shadow-xs space-y-4 flex-1 flex flex-col justify-between">

                <div className="space-y-4">
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    <span className="bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded">CEFR: {currentQuestion.difficulty}</span>
                    {currentQuestion.grammarCategory && (
                      <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium">Ngữ pháp: {currentQuestion.grammarCategory}</span>
                    )}
                  </div>

                  <h4 className={getQuestionTextClass(practiceFontSize)} dangerouslySetInnerHTML={{ __html: currentQuestion.text }} />

                  <div className="grid grid-cols-1 gap-2.5 pt-2">
                    {Object.entries(currentQuestion.options).sort((a, b) => a[0].localeCompare(b[0])).map(([key, value]) => {
                      const isSelected = userAnswers[currentQuestion.questionNumber] === key;
                      const isCorrect = currentQuestion.correctAnswer === key;

                      let optionColor = 'border-slate-200 hover:border-indigo-400 bg-white hover:bg-indigo-50/20 text-slate-700';
                      if (isSelected) optionColor = 'border-indigo-600 bg-indigo-50/40 text-indigo-900 font-bold';
                      if (graded) {
                        if (isCorrect) optionColor = 'border-green-500 bg-green-50 text-green-800 font-bold';
                        else if (isSelected) optionColor = 'border-red-500 bg-red-50 text-red-800 font-bold';
                        else optionColor = 'border-slate-200 bg-white text-slate-400 opacity-60';
                      }

                      return (
                        <button
                          key={key}
                          onClick={() => handleSelectOption(currentQuestion.questionNumber, key)}
                          disabled={graded}
                          className={`w-full text-left p-2.5 md:p-3 rounded-lg border flex items-start gap-2.5 active:scale-99 transition-all cursor-pointer ${optionColor}`}
                          style={{ minHeight: '40px' }}
                        >
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 ${isSelected ? 'bg-indigo-600 text-white' : graded && isCorrect ? 'bg-green-600 text-white' : graded && isSelected ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                            {key}
                          </span>
                          <span className={getOptionTextClass(practiceFontSize)} dangerouslySetInnerHTML={{ __html: value }} />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {graded && (
                  <div className="border-t border-slate-100 pt-6 mt-6 space-y-4">
                    <div className={`p-4 rounded-2xl flex gap-3 ${userAnswers[currentQuestion.questionNumber] === currentQuestion.correctAnswer ? 'bg-green-50/80 border border-green-200/50 text-green-900' : 'bg-red-50/80 border border-red-200/50 text-red-900'}`}>
                      {userAnswers[currentQuestion.questionNumber] === currentQuestion.correctAnswer ? (
                        <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
                      )}
                      <div>
                        <p className="font-bold text-sm">
                          {userAnswers[currentQuestion.questionNumber] === currentQuestion.correctAnswer ? 'Đúng rồi! Tuyệt vời 👏' : `Chưa đúng! Đáp án đúng của bạn phải là ${currentQuestion.correctAnswer}`}
                        </p>
                        {currentQuestion.explanation && (
                          <p className="text-slate-600 text-xs leading-relaxed mt-1 whitespace-pre-line"><b>Giải thích:</b> {currentQuestion.explanation}</p>
                        )}
                      </div>
                    </div>

                    {reportingQNum !== currentQuestion.questionNumber ? (
                      <button onClick={() => setReportingQNum(currentQuestion.questionNumber)} className="text-amber-600 hover:text-amber-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer mt-2">
                        <AlertTriangle className="h-4 w-4" /> Báo cáo sai sót/phản hồi đáp án này
                      </button>
                    ) : (
                      <form onSubmit={handleReportFeedback} className="p-4 bg-amber-50 rounded-xl border border-amber-200 space-y-3 mt-2 animate-in slide-in-from-top duration-150">
                        <p className="text-xs text-amber-800 font-bold">Nội dung phản hồi cho Câu {currentQuestion.questionNumber}:</p>
                        <textarea value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-amber-500" placeholder="Mô tả cụ thể lý do bạn thấy đáp án chưa chính xác..." rows={3} required />
                        <div className="flex gap-2 justify-end">
                          <button type="button" onClick={() => setReportingQNum(null)} className="bg-white border border-slate-300 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer">Hủy</button>
                          <button type="submit" className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-4 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer"><Send className="h-3.5 w-3.5" /> Gửi phản hồi</button>
                        </div>
                      </form>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-slate-100 shrink-0">
                  <button onClick={() => setActiveQuestionIdx(Math.max(0, activeQuestionIdx - 1))} disabled={activeQuestionIdx === 0} className="flex items-center gap-1 text-slate-600 hover:text-slate-900 border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 cursor-pointer">
                    <ArrowLeft className="h-3.5 w-3.5" /> Câu trước
                  </button>
                  <div className="text-[10px] text-slate-400 font-medium font-mono">Mã đề: {activeExam.examCode}</div>
                  <button onClick={() => setActiveQuestionIdx(Math.min(questionsList.length - 1, activeQuestionIdx + 1))} disabled={activeQuestionIdx === questionsList.length - 1} className="flex items-center gap-1 bg-slate-900 text-white hover:bg-slate-800 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 cursor-pointer">
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
                  if (isRight) bgBtn = 'bg-green-100 text-green-800 border-green-300 font-bold';
                  else if (isAns) bgBtn = 'bg-red-100 text-red-800 border-red-300 font-bold';
                  else bgBtn = 'bg-slate-100 text-slate-400 border-slate-200';
                  if (isActive) bgBtn += ' ring-2 ring-indigo-500 ring-offset-2';
                }

                return (
                  <button key={q.questionNumber} onClick={() => setActiveQuestionIdx(idx)} className={`w-8 h-8 rounded-lg border text-xs flex items-center justify-center font-bold active:scale-95 transition-all cursor-pointer ${bgBtn}`}>
                    {q.questionNumber}
                  </button>
                );
              })}
            </div>

            {graded && (
              <div className="mt-3 flex flex-wrap gap-3 items-center justify-between border-t border-slate-150 pt-3 text-xs">
                <div className="flex gap-3">
                  <span className="flex items-center gap-1.5 text-green-700 font-semibold text-[11px]"><div className="w-2.5 h-2.5 rounded-full bg-green-500" /> Đúng</span>
                  <span className="flex items-center gap-1.5 text-red-700 font-semibold text-[11px]"><div className="w-2.5 h-2.5 rounded-full bg-red-400" /> Sai</span>
                  <span className="flex items-center gap-1.5 text-slate-400 text-[11px]"><div className="w-2.5 h-2.5 rounded-full bg-slate-300" /> Chưa trả lời</span>
                </div>

                <button onClick={handleRetake} className="flex items-center gap-1 text-indigo-700 hover:text-indigo-900 border border-indigo-200 hover:bg-indigo-50 text-[10px] sm:text-xs font-bold px-2.5 py-1 rounded-lg transition-all cursor-pointer">
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
