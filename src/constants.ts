export const EXAM_CLASSIFICATIONS = [
  "Đề thi chính thức các năm",
  "Đề thi thử từ các đơn vị",
  "Đề minh họa theo chủ đề",
] as const;

export type ExamClassification = typeof EXAM_CLASSIFICATIONS[number];

export const DEFAULT_EXAM_CLASSIFICATION: ExamClassification = "Đề thi thử từ các đơn vị";

// Minimum time (seconds) an exam attempt must take before it is persisted.
// Below this, the attempt is treated as a rage-quit/accidental submit.
export const MIN_ATTEMPT_SECONDS_TO_SAVE = 120;

// Spaced-repetition interval steps (days) used by the SRS review scheduler.
export const SRS_INTERVALS_DAYS = [3, 7, 15, 30] as const;

// Diamond reward economy conversion rates.
export const DIAMOND_VND_RATE = 1000; // 1 diamond = 1000 VND cash
export const DIAMOND_EXTENSION_DAY_RATE = 5; // 5 diamonds = 1 day of account extension
