export interface User {
  id: string;
  username: string;
  name: string;
  password?: string;
  email: string;
  phone: string;
  grade: string; // '6' | '10' | '12' | 'admin'
  role: 'student' | 'admin' | 'guest';
  expiresAt: string; // ISO date-time
  createdAt: string; // ISO date-time
  diamonds?: number; // reward currency balance, missing means 0
  lastStreakDiamondDate?: string; // date-only (YYYY-MM-DD) — dedupes the daily streak bonus
}

export interface Question {
  questionNumber: number;
  text: string;
  // 'multiple_choice' (default when absent) or 'text' — free-text questions
  // carry an empty options map and store accepted answer variants in
  // correctAnswer, separated by "|" (e.g. "was going | went").
  answerType?: 'multiple_choice' | 'text';
  options: {
    [key: string]: string; // A, B, C, D — empty object for answerType 'text'
  };
  correctAnswer: string; // A | B | C | D, or accepted text variants for answerType 'text'
  explanation: string;
  difficulty: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  grammarCategory: string; // Verb tenses, Passive voice, etc.
  originalExamId?: string;
  originalQuestionNumber?: number;
}

export interface Passage {
  title: string;
  content: string; // HTML support preserved
  vocabularyCategory?: string; // Family life, Music, etc.
  questions: Question[];
}

export interface Exam {
  id: string;
  title: string;
  examName: string;
  examCode: string;
  grade: number; // 6 | 10 | 12
  numQuestions: number;
  duration: number; // minutes
  publisher: string;
  year: number;
  createdAt: string;
  passages: Passage[];
  classification?: string; // e.g., 'Đề thi chính thức các năm' | 'Đề thi thử từ các đơn vị' | 'Đề minh họa theo chủ đề'
  difficultyScore?: number; // scale 1-100 built from CEFR question distribution
  lastNormalizedAt?: string; // ISO timestamp of the last batch normalization
}

export interface CategoryPerf {
  correct: number;
  wrong: number;
}

export interface Attempt {
  id: string;
  examId: string;
  examTitle: string;
  examCode?: string;
  userId: string;
  username: string;
  grade: number; // 6 | 10 | 12
  correctCount: number;
  totalCount: number;
  score: number;
  timeSpent: number; // seconds
  createdAt: string;
  answers: { [qNumber: string]: string };
  weakGrammar: string[];
  weakVocab: string[];
  // Per-category correct/wrong counts for this attempt. Optional: attempts
  // recorded before this field was added won't have it, so consumers must
  // fall back to weakGrammar/weakVocab-based counting for older data.
  grammarPerf?: { [category: string]: CategoryPerf };
  vocabPerf?: { [category: string]: CategoryPerf };
  difficultyPerf?: { [level: string]: CategoryPerf };
}

export interface ExtensionLog {
  id: string;
  userId: string;
  username: string;
  grade: string;
  extendedAt: string;
  extendedTo: string;
  note: string;
  // Diamond redemption log fields (reuses this collection instead of a new
  // one — the live Firestore only allows already-existing collections).
  // Absent/'admin' means a manual admin-granted extension, same as before.
  source?: 'admin' | 'diamond_extension' | 'diamond_cashout';
  diamondsSpent?: number;
  cashAmount?: number; // VND, only set for 'diamond_cashout'
  status?: 'pending' | 'approved' | 'rejected'; // only meaningful for 'diamond_cashout'
}

export interface QuestionFeedback {
  id: string;
  examId: string;
  examTitle: string;
  questionNumber: number;
  reportedBy: string;
  reportText: string;
  createdAt: string;
  status: 'pending' | 'resolved';
}

export interface SRSItem {
  id?: string;
  userId: string;
  examId: string;
  questionNumber: number;
  interval: number; // 3, 7, 15, 30
  status: 'pending' | 'mastered';
  nextReviewDate: string; // ISO string
  lastReviewedDate: string; // ISO string
}

export const VOCABULARY_THEMES = [
  "Family life",
  "Human environment",
  "Music",
  "Better community",
  "Inventions",
  "Heritage",
  "Cultural diversity",
  "Learning ways",
  "Environmental protection",
  "Lifelong learning",
  "Healthy life",
  "Generation gap",
  "Future cities",
  "ASEAN Vietnam",
  "Global warming",
  "Education options",
  "Becoming independent",
  "Social issues",
  "Ecosystem",
  "Life stories",
  "Multicultural world",
  "Green living",
  "Urbanisation",
  "Work world",
  "Artificial intelligence",
  "Mass media",
  "Wildlife conservation",
  "Career paths"
];

export const GRAMMAR_THEMES = [
  "Verb tenses",
  "Passive voice",
  "Conditionals",
  "Reported speech",
  "Relative clauses",
  "Clause links",
  "Verb forms",
  "Other grammar"
];

export const DIFFICULTY_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
