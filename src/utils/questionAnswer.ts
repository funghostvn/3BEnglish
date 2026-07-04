import { Question } from '../types';

// A question is free-text (tự luận ngắn) when it's explicitly marked as such
// or simply has no MCQ options. Legacy exams always carry A-D options, so
// they are unaffected by this detection.
export function isTextInputQuestion(q: Pick<Question, 'answerType' | 'options'>): boolean {
  if (q.answerType === 'text') return true;
  return !q.options || Object.keys(q.options).length === 0;
}

// Tolerant normalization for comparing student-typed answers: trim, lowercase,
// collapse inner whitespace, unify curly apostrophes/quotes, and strip
// trailing sentence punctuation so "He's gone." matches "he's gone".
export function normalizeTextAnswer(raw: string): string {
  return raw
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, '')
    .trim();
}

// For text questions, correctAnswer may list several accepted variants
// separated by "|", e.g. "was going | went".
export function acceptedTextAnswers(correctAnswer: string): string[] {
  return correctAnswer
    .split('|')
    .map(normalizeTextAnswer)
    .filter(v => v.length > 0);
}

// Single correctness gate used by grading, SRS transitions and review UI so
// MCQ and text questions can never drift apart.
export function isAnswerCorrect(q: Question, ans: string | undefined): boolean {
  if (ans === undefined) return false;
  if (isTextInputQuestion(q)) {
    const normalized = normalizeTextAnswer(ans);
    if (!normalized) return false;
    return acceptedTextAnswers(q.correctAnswer).includes(normalized);
  }
  return ans === q.correctAnswer;
}

// Human-readable correct answer for the review screen: the option letter for
// MCQ, or the accepted variant(s) joined with " / " for text questions.
export function formatCorrectAnswerDisplay(q: Question): string {
  if (isTextInputQuestion(q)) {
    return q.correctAnswer
      .split('|')
      .map(v => v.trim())
      .filter(v => v.length > 0)
      .join(' / ');
  }
  return q.correctAnswer;
}
