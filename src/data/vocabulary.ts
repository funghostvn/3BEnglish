import { VocabItem, VOCAB_A1 } from './vocab_a1';
import { VOCAB_A2 } from './vocab_a2';
import { VOCAB_B1 } from './vocab_b1';
import { VOCAB_B2 } from './vocab_b2';
import { VOCAB_C1 } from './vocab_c1';

export type { VocabItem };

export const ALL_VOCABULARY: VocabItem[] = [
  ...VOCAB_A1,
  ...VOCAB_A2,
  ...VOCAB_B1,
  ...VOCAB_B2,
  ...VOCAB_C1
];

// Helper to get unique topics present in the database
export const ALL_TOPICS: string[] = Array.from(
  new Set(ALL_VOCABULARY.map(item => item.topic))
).sort();

// Helper to filter items by level or topic
export function filterVocabulary(
  level: string | null = null,
  topic: string | null = null,
  search: string | null = null
): VocabItem[] {
  let result = [...ALL_VOCABULARY];

  if (level && level !== 'all') {
    result = result.filter(item => item.level.toLowerCase() === level.toLowerCase());
  }

  if (topic && topic !== 'all') {
    result = result.filter(item => item.topic.toLowerCase() === topic.toLowerCase());
  }

  if (search && search.trim() !== '') {
    const s = search.toLowerCase().trim();
    result = result.filter(item => 
      item.word.toLowerCase().includes(s) || 
      item.definition.toLowerCase().includes(s)
    );
  }

  return result;
}
