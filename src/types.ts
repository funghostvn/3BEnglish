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
}

export interface Question {
  questionNumber: number;
  text: string;
  options: {
    [key: string]: string; // A, B, C, D
  };
  correctAnswer: string; // A | B | C | D
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
}

export interface ExtensionLog {
  id: string;
  userId: string;
  username: string;
  grade: string;
  extendedAt: string;
  extendedTo: string;
  note: string;
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
