import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Search, 
  BookOpen, 
  Star, 
  Volume2, 
  Sparkles, 
  CheckCircle, 
  ArrowLeft, 
  ArrowRight, 
  RotateCw, 
  Library, 
  Trash2, 
  Check, 
  AlertCircle,
  HelpCircle,
  RefreshCw,
  FolderOpen,
  Upload,
  FileText,
  Info,
  BarChart3,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ALL_VOCABULARY, ALL_TOPICS, VocabItem } from '../data/vocabulary';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, getDocs, doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';

interface VocabularyViewProps {
  currentUser: {
    id: string;
    name: string;
    role: string;
  };
  onShowModal: (config: {
    type: 'success' | 'danger' | 'info' | 'confirm';
    title: string;
    message: string;
    onConfirm?: () => void;
  }) => void;
}

export default function VocabularyView({ currentUser, onShowModal }: VocabularyViewProps) {
  // Navigation states
  const [activeSubTab, setActiveSubTab] = useState<'lookup' | 'practice' | 'import'>('lookup');

  // Check if current user is authorized to import (admin or teacher)
  const isAuthorizedToImport = currentUser.role === 'admin' || currentUser.role === 'teacher';

  // Safeguard: Redirect unauthorized users to lookup tab
  useEffect(() => {
    if (activeSubTab === 'import' && !isAuthorizedToImport) {
      setActiveSubTab('lookup');
    }
  }, [activeSubTab, isAuthorizedToImport]);

  // Database of user's personal bookmark list
  const [personalList, setPersonalList] = useState<VocabItem[]>([]);
  const [loadingPersonal, setLoadingPersonal] = useState(false);

  // Database of imported common vocabulary library from Firestore
  const [importedList, setImportedList] = useState<VocabItem[]>([]);
  const [loadingImported, setLoadingImported] = useState(false);

  // Merged states
  const [mergedVocabulary, setMergedVocabulary] = useState<VocabItem[]>([]);
  const [mergedTopics, setMergedTopics] = useState<string[]>([]);

  // Search and Filtering states for Lookup
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [selectedTopic, setSelectedTopic] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Reset page to 1 on filter or search query change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedLevel, selectedTopic]);

  // Flashcards practice states
  const [practiceSource, setPracticeSource] = useState<'all' | 'personal'>('all');
  const [practiceLevel, setPracticeLevel] = useState<string>('all');
  const [practiceTopic, setPracticeTopic] = useState<string>('all');
  const [practiceWords, setPracticeWords] = useState<VocabItem[]>([]);
  
  // Active flashcard parameters
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [guessMode, setGuessMode] = useState<'word_first' | 'definition_first'>('word_first');
  const [masteredIds, setMasteredIds] = useState<string[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // File Import States
  const [importLevel, setImportLevel] = useState<'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'>('C1');
  const [fileName, setFileName] = useState('');
  const [fileContentText, setFileContentText] = useState('');
  const [clearExistingBeforeImport, setClearExistingBeforeImport] = useState(false);
  const [parsedItems, setParsedItems] = useState<Omit<VocabItem, 'id'>[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importFinished, setImportFinished] = useState(false);
  const [importStats, setImportStats] = useState({ total: 0, ready: 0, dups: 0 });

  // Load personal vocabulary & imported vocabulary from Firestore
  useEffect(() => {
    fetchPersonalVocabulary();
    fetchImportedVocabulary();
  }, [currentUser]);

  const fetchPersonalVocabulary = async () => {
    const isGuest = currentUser.role === 'guest' || !currentUser.id;
    setLoadingPersonal(true);
    try {
      if (isGuest) {
        const local = localStorage.getItem(`personal_vocab_${currentUser.id || 'guest'}`);
        if (local) {
          setPersonalList(JSON.parse(local));
        } else {
          setPersonalList([]);
        }
      } else {
        const q = query(
          collection(db, 'vocab_practice'), 
          where('userId', '==', currentUser.id)
        );
        const querySnapshot = await getDocs(q);
        const fetched: VocabItem[] = [];
        querySnapshot.forEach((doc) => {
          fetched.push(doc.data() as VocabItem);
        });
        setPersonalList(fetched.sort((a, b) => b.word.localeCompare(a.word)));
      }
    } catch (error: any) {
      console.error("Error loading personal vocabulary:", error);
      handleFirestoreError(error, OperationType.LIST, 'vocab_practice');
    } finally {
      setLoadingPersonal(false);
    }
  };

  const fetchImportedVocabulary = async () => {
    setLoadingImported(true);
    try {
      const q = collection(db, 'vocabulary_library');
      const querySnapshot = await getDocs(q);
      const fetched: VocabItem[] = [];
      querySnapshot.forEach((doc) => {
        fetched.push(doc.data() as VocabItem);
      });
      setImportedList(fetched);
    } catch (error: any) {
      console.error("Error loading dynamic vocabulary library:", error);
      handleFirestoreError(error, OperationType.LIST, 'vocabulary_library');
    } finally {
      setLoadingImported(false);
    }
  };

  // Merge static and dynamic lists
  useEffect(() => {
    const seen = new Set<string>();
    const merged: VocabItem[] = [];

    // Prioritize static items first
    ALL_VOCABULARY.forEach(item => {
      const key = `${item.word.toLowerCase().trim()}_${item.level.toLowerCase().trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    });

    // Add dynamic items second
    importedList.forEach(item => {
      const key = `${item.word.toLowerCase().trim()}_${item.level.toLowerCase().trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    });

    // Sort by word
    setMergedVocabulary(merged.sort((a, b) => a.word.localeCompare(b.word)));
  }, [importedList]);

  // Derive all topics (merged list)
  useEffect(() => {
    const topics = new Set<string>();
    mergedVocabulary.forEach(item => {
      if (item.topic) {
        topics.add(item.topic.trim());
      }
    });
    setMergedTopics(Array.from(topics).sort());
  }, [mergedVocabulary]);

  // Compute statistics of vocabulary per CEFR level
  const cefrStats = useMemo(() => {
    const levels: ('A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2')[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    
    return levels.map(lvl => {
      const lowerLvl = lvl.toLowerCase();
      
      const staticCount = ALL_VOCABULARY.filter(item => item.level.toLowerCase() === lowerLvl).length;
      const importedCount = importedList.filter(item => item.level.toLowerCase() === lowerLvl).length;
      const totalCount = mergedVocabulary.filter(item => item.level.toLowerCase() === lowerLvl).length;
      const savedCount = personalList.filter(item => item.level.toLowerCase() === lowerLvl).length;
      
      return {
        level: lvl,
        staticCount,
        importedCount,
        totalCount,
        savedCount
      };
    });
  }, [importedList, mergedVocabulary, personalList]);

  // Toggle saving vocabulary item to personal notebook
  const handleToggleBookmark = async (item: VocabItem) => {
    const isGuest = currentUser.role === 'guest' || !currentUser.id;
    const isBookmarked = personalList.some(p => p.id === item.id);

    try {
      if (isBookmarked) {
        // Remove bookmark
        const updatedList = personalList.filter(p => p.id !== item.id);
        setPersonalList(updatedList);
        
        if (isGuest) {
          localStorage.setItem(`personal_vocab_guest`, JSON.stringify(updatedList));
        } else {
          const docId = `${currentUser.id}_${item.id}`;
          try {
            await deleteDoc(doc(db, 'vocab_practice', docId));
          } catch (error: any) {
            handleFirestoreError(error, OperationType.DELETE, `vocab_practice/${docId}`);
          }
        }
      } else {
        // Add bookmark
        const updatedList = [...personalList, item];
        setPersonalList(updatedList);

        if (isGuest) {
          localStorage.setItem(`personal_vocab_guest`, JSON.stringify(updatedList));
        } else {
          const docId = `${currentUser.id}_${item.id}`;
          try {
            await setDoc(doc(db, 'vocab_practice', docId), {
              ...item,
              userId: currentUser.id,
              createdAt: new Date().toISOString()
            });
          } catch (error: any) {
            handleFirestoreError(error, OperationType.WRITE, `vocab_practice/${docId}`);
          }
        }
      }
    } catch (err: any) {
      console.error("Error toggling bookmark:", err);
      onShowModal({
        type: 'danger',
        title: 'Lỗi đồng bộ',
        message: 'Không thể đồng bộ danh sách từ vựng cá nhân với đám mây Firestore.'
      });
      if (err.message && err.message.startsWith('{')) {
        throw err;
      }
    }
  };

  // Text-To-Speech Pronunciation helper
  const handleSpeak = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.85;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    } else {
      alert("Trình duyệt không hỗ trợ Text-to-Speech.");
    }
  };

  // Prepare and filter flashcards list whenever source, level, topic, or updates happen
  useEffect(() => {
    let pool = practiceSource === 'all' ? [...mergedVocabulary] : [...personalList];

    if (practiceLevel !== 'all') {
      pool = pool.filter(item => item.level.toLowerCase() === practiceLevel.toLowerCase());
    }

    if (practiceTopic !== 'all') {
      pool = pool.filter(item => item.topic.toLowerCase() === practiceTopic.toLowerCase());
    }

    setPracticeWords(pool);
    setCurrentIndex(0);
    setIsFlipped(false);
  }, [practiceSource, practiceLevel, practiceTopic, personalList, mergedVocabulary]);

  // Handle flashcard navigation keyboard listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeSubTab !== 'practice' || practiceWords.length === 0) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setIsFlipped(prev => !prev);
      } else if (e.code === 'ArrowRight') {
        handleNextCard();
      } else if (e.code === 'ArrowLeft') {
        handlePrevCard();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSubTab, practiceWords, currentIndex]);

  const handleNextCard = () => {
    if (practiceWords.length === 0) return;
    setIsFlipped(false);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % practiceWords.length);
    }, 150);
  };

  const handlePrevCard = () => {
    if (practiceWords.length === 0) return;
    setIsFlipped(false);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev - 1 + practiceWords.length) % practiceWords.length);
    }, 150);
  };

  // Toggle a word is rated as "Mastered"
  const handleToggleMastered = (item: VocabItem) => {
    if (masteredIds.includes(item.id)) {
      setMasteredIds(prev => prev.filter(id => id !== item.id));
    } else {
      setMasteredIds(prev => [...prev, item.id]);
      // Auto-pronounce when mastering makes the UI incredibly satisfying
      handleSpeak(item.word);
    }
  };

  // Reset mastered progress
  const resetMasterySession = () => {
    setMasteredIds([]);
    setCurrentIndex(0);
    setIsFlipped(false);
  };

  // Word de-duplication helper
  const isDuplicateItem = (word: string, lvl: string, ignoreDynamicForLevel?: string) => {
    const checkKey = `${word.toLowerCase().trim()}_${lvl.toLowerCase().trim()}`;
    
    // check static
    const existsInStatic = ALL_VOCABULARY.some(item => 
      `${item.word.toLowerCase().trim()}_${item.level.toLowerCase().trim()}` === checkKey
    );
    if (existsInStatic) return 'Thư viện mặc định';

    if (ignoreDynamicForLevel && lvl.toLowerCase() === ignoreDynamicForLevel.toLowerCase()) {
      return null;
    }

    // check dynamic/imported
    const existsInImported = importedList.some(item => 
      `${item.word.toLowerCase().trim()}_${item.level.toLowerCase().trim()}` === checkKey
    );
    if (existsInImported) return 'Thư viện đã nhập';

    return null;
  };

  // Helper CSV parser to correctly parse line with quoted values containing commas
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);

    return result.map(val => {
      let cleaned = val.trim();
      if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        cleaned = cleaned.substring(1, cleaned.length - 1);
      }
      return cleaned.replace(/""/g, '"').trim();
    });
  };

  // Parsing individual txt line
  const parseVocabularyLine = (line: string, level: string): Omit<VocabItem, 'id'> | null => {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const lowerTrimmed = trimmed.toLowerCase();
    // Skip headers of files starting with common header words
    if (lowerTrimmed.startsWith('no.,topic,word') || lowerTrimmed.startsWith('no,topic,word') || lowerTrimmed.startsWith('topic,word,type')) {
      return null;
    }

    // Try CSV format (preferred) split by comma with quote support
    const csvParts = parseCSVLine(trimmed);
    if (csvParts.length >= 5) {
      // Formats: No.,Topic,Word,Type,Pronunciation,Definition (6 columns or more)
      if (csvParts.length >= 6) {
        return {
          topic: csvParts[1] || 'Chung',
          word: csvParts[2],
          type: csvParts[3] || 'n.',
          pronunciation: csvParts[4] || '//',
          definition: csvParts[5] || '',
          level: level as any
        };
      } else {
        // Format: Topic,Word,Type,Pronunciation,Definition (5 columns)
        return {
          topic: csvParts[0] || 'Chung',
          word: csvParts[1],
          type: csvParts[2] || 'n.',
          pronunciation: csvParts[3] || '//',
          definition: csvParts[4] || '',
          level: level as any
        };
      }
    }

    // Fallback if it looks like a simple comma-separated row: word, definition
    if (trimmed.includes(',') && !trimmed.includes('|') && !trimmed.includes(';') && !trimmed.includes('\t')) {
      const parts = csvParts;
      if (parts.length >= 2) {
        return {
          word: parts[0],
          type: 'n.',
          pronunciation: '//',
          definition: parts.slice(1).join(', '),
          topic: 'Chung',
          level: level as any
        };
      }
    }

    // Format 1: | delimiter (most recommended)
    if (trimmed.includes('|')) {
      const parts = trimmed.split('|').map(s => s.trim());
      if (parts.length >= 2) {
        return {
          word: parts[0],
          type: parts[1] || 'n.',
          pronunciation: parts[2] || '//',
          definition: parts[3] || '',
          topic: parts[4] || 'Chung',
          level: level as any
        };
      }
    }

    // Format 2: ; delimiter
    if (trimmed.includes(';')) {
      const parts = trimmed.split(';').map(s => s.trim());
      if (parts.length >= 2) {
        return {
          word: parts[0],
          type: parts[1] || 'n.',
          pronunciation: parts[2] || '//',
          definition: parts[3] || '',
          topic: parts[4] || 'Chung',
          level: level as any
        };
      }
    }

    // Format 3: Tab delimiter
    if (trimmed.includes('\t')) {
      const parts = trimmed.split('\t').map(s => s.trim());
      if (parts.length >= 2) {
        return {
          word: parts[0],
          type: parts[1] || 'n.',
          pronunciation: parts[2] || '//',
          definition: parts[3] || '',
          topic: parts[4] || 'Chung',
          level: level as any
        };
      }
    }

    // Format 4: Word (Type) /Pronunciation/ - Definition [Topic]
    const complexRegex = /^([^(/\s:]+)(?:\s*\(([^)]+)\))?(?:\s*\/([^/]+)\/)?\s*[-:]\s*([^[\]]+)(?:\[([^\]]+)\])?$/;
    const match = trimmed.match(complexRegex);
    if (match) {
      const word = match[1].trim();
      const type = match[2] ? match[2].trim() : 'n.';
      const pronunciation = match[3] ? `/${match[3].trim()}/` : '//';
      const definition = match[4].trim();
      const topic = match[5] ? match[5].trim() : 'Chung';
      return {
        word,
        type,
        pronunciation,
        definition,
        topic,
        level: level as any
      };
    }

    // Format 5: simple "word - definition" or "word: definition"
    const simpleParts = trimmed.split(/[-:]/).map(s => s.trim());
    if (simpleParts.length >= 2) {
      return {
        word: simpleParts[0],
        type: 'n.',
        pronunciation: '//',
        definition: simpleParts.slice(1).join(' - '),
        topic: 'Chung',
        level: level as any
      };
    }

    // Fallback: If it's just a single word
    return {
      word: trimmed,
      type: 'n.',
      pronunciation: '//',
      definition: 'Đang cập nhật diễn giải',
      topic: 'Chung',
      level: level as any
    };
  };

  const processTextContent = (text: string, level: string) => {
    const lines = text.split(/\r?\n/);
    const parsed: Omit<VocabItem, 'id'>[] = [];
    const seenLocal = new Set<string>();
    let dupCount = 0;

    lines.forEach(line => {
      const item = parseVocabularyLine(line, level);
      if (item) {
        const lowerWord = item.word.toLowerCase().trim();
        const dupType = isDuplicateItem(item.word, level, clearExistingBeforeImport ? level : undefined);
        
        if (dupType || seenLocal.has(lowerWord)) {
          dupCount++;
        }
        
        seenLocal.add(lowerWord);
        parsed.push(item);
      }
    });

    setParsedItems(parsed);
    setImportStats({
      total: parsed.length,
      dups: dupCount,
      ready: parsed.length - dupCount
    });
  };

  useEffect(() => {
    if (fileContentText) {
      processTextContent(fileContentText, importLevel);
    } else {
      setParsedItems([]);
      setImportStats({ total: 0, dups: 0, ready: 0 });
    }
  }, [fileContentText, importLevel, clearExistingBeforeImport, importedList]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.txt')) {
        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
            setFileContentText(event.target.result as string);
          }
        };
        reader.readAsText(file);
      } else {
        onShowModal({
          type: 'danger',
          title: 'Định dạng sai',
          message: 'Vui lòng chỉ tải lên tài liệu văn bản đuôi mở rộng .txt'
        });
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.name.endsWith('.txt')) {
        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
            setFileContentText(event.target.result as string);
          }
        };
        reader.readAsText(file);
      } else {
        onShowModal({
          type: 'danger',
          title: 'Định dạng sai',
          message: 'Vui lòng chỉ tải lên tài liệu văn bản đuôi mở rộng .txt'
        });
      }
    }
  };

  const executeVocabularyImport = async () => {
    if (parsedItems.length === 0) return;
    setIsImporting(true);
    setImportProgress('Bắt đầu phân tích & lưu trữ từ vựng...');

    try {
      // 1. Clear existing dynamic library items for this level if selected
      if (clearExistingBeforeImport) {
        const itemsToDelete = importedList.filter(item => item.level.toLowerCase() === importLevel.toLowerCase());
        if (itemsToDelete.length > 0) {
          setImportProgress(`Đang xóa ${itemsToDelete.length} từ vựng đã nhập cấp độ [${importLevel}]...`);
          const delBatchSize = 500;
          for (let d = 0; d < itemsToDelete.length; d += delBatchSize) {
            const chunkToDelete = itemsToDelete.slice(d, d + delBatchSize);
            const delBatch = writeBatch(db);
            chunkToDelete.forEach(item => {
              delBatch.delete(doc(db, 'vocabulary_library', item.id));
            });
            await delBatch.commit();
          }
        }
      }

      // Local tracking of seen words/levels to skip duplicate lines in the file itself (internal deduplication)
      const seenLocally = new Set<string>();
      const readyToImport: Omit<VocabItem, 'id'>[] = [];

      parsedItems.forEach(item => {
        const uniqueKey = `${item.word.toLowerCase().trim()}_${item.level.toLowerCase().trim()}`;
        const isDup = isDuplicateItem(
          item.word, 
          item.level, 
          clearExistingBeforeImport ? importLevel : undefined
        );
        if (!isDup && !seenLocally.has(uniqueKey)) {
          seenLocally.add(uniqueKey);
          readyToImport.push(item);
        }
      });

      if (readyToImport.length === 0) {
        onShowModal({
          type: 'info',
          title: 'Không có từ mới',
          message: 'Toàn bộ từ vựng trong file tải mở rộng đều trùng lặp với thư viện mặc định hoặc thư viện đã lưu trước.'
        });
        setIsImporting(false);
        return;
      }

      // Write in batches of 500
      const batchSize = 500;
      
      for (let i = 0; i < readyToImport.length; i += batchSize) {
        const chunk = readyToImport.slice(i, i + batchSize);
        const batch = writeBatch(db);
        
        chunk.forEach(item => {
          const documentId = `${item.level.toLowerCase().trim()}_${item.word.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
          const docRef = doc(db, 'vocabulary_library', documentId);
          
          batch.set(docRef, {
            ...item,
            id: documentId,
            createdAt: new Date().toISOString()
          });
        });
        
        setImportProgress(`Đang ghi dữ liệu từ vựng (${i + chunk.length} / ${readyToImport.length})...`);
        try {
          await batch.commit();
        } catch (error: any) {
          handleFirestoreError(error, OperationType.WRITE, 'vocabulary_library');
        }
      }

      setImportFinished(true);
      await fetchImportedVocabulary(); // Reload list
      
      onShowModal({
        type: 'success',
        title: 'Nhập thành công',
        message: clearExistingBeforeImport
          ? `Đã làm sạch cấp độ [${importLevel}] và thêm mới ${readyToImport.length} từ vựng từ tệp tin lên đám mây!`
          : `Đã tự động loại bỏ trùng lặp và ghi nhận ${readyToImport.length} từ vựng mới cấp độ [${importLevel}] lên đám mây!`
      });
    } catch (error: any) {
      console.error("Error importing vocabulary library:", error);
      onShowModal({
        type: 'danger',
        title: 'Cơ sở dữ liệu lỗi',
        message: 'Lỗi ghi chép dữ liệu hàng loạt lên đám mây Firestore: ' + error.message
      });
    } finally {
      setIsImporting(false);
      setImportProgress('');
    }
  };

  // Filtered vocabulary selection for lookup query
  const filteredLookupList = mergedVocabulary.filter(item => {
    const matchesLevel = selectedLevel === 'all' || item.level.toLowerCase() === selectedLevel.toLowerCase();
    const matchesTopic = selectedTopic === 'all' || item.topic.toLowerCase() === selectedTopic.toLowerCase();
    
    const searchClean = searchQuery.toLowerCase().trim();
    const matchesSearch = searchQuery === '' || 
      item.word.toLowerCase().includes(searchClean);

    return matchesLevel && matchesTopic && matchesSearch;
  });

  const ITEMS_PER_PAGE = 20;
  const totalPages = Math.ceil(filteredLookupList.length / ITEMS_PER_PAGE);

  const paginatedList = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredLookupList.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredLookupList, currentPage]);

  const renderCefrStatsCard = (classNameAdd: string = '') => (
    <div className={`bg-white p-5 rounded-2xl border border-slate-200/80 shadow-3xs space-y-3 ${classNameAdd}`}>
      <div className="flex items-center justify-between pb-1 border-b border-slate-100">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-indigo-500" /> Thống kê từ vựng CEFR
        </h3>
      </div>

      <div className="space-y-2.5">
        {cefrStats.map((stat) => {
          const percentage = mergedVocabulary.length > 0 
            ? Math.round((stat.totalCount / mergedVocabulary.length) * 100) 
            : 0;

          return (
            <div 
              key={stat.level}
              onClick={() => setSelectedLevel(stat.level)}
              className={`p-2 rounded-xl border transition-all cursor-pointer group select-none ${
                selectedLevel === stat.level
                  ? 'bg-indigo-50/40 border-indigo-250 shadow-3xs scale-101'
                  : 'border-slate-100/70 hover:bg-slate-50/70 hover:border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-black tracking-wide ${
                    stat.level.startsWith('A') 
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                      : stat.level.startsWith('B')
                      ? 'bg-sky-50 text-sky-700 border border-sky-100'
                      : 'bg-purple-50 text-purple-705 border border-purple-100'
                  }`}>
                    {stat.level}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 group-hover:text-indigo-650 transition-colors">
                    {stat.level === 'A1' ? 'Cơ bản' : stat.level === 'A2' ? 'Sơ cấp' : stat.level === 'B1' ? 'Trung cấp' : stat.level === 'B2' ? 'Trung cao cấp' : stat.level === 'C1' ? 'Cao cấp' : 'Thành thạo'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-slate-700">
                  <span>{stat.totalCount} từ</span>
                  {stat.savedCount > 0 && (
                    <span className="flex items-center text-rose-500" title={`Đã lưu ${stat.savedCount} từ`}>
                      <Star className="h-3 w-3 fill-rose-500 text-rose-500 mr-0.5" />
                      {stat.savedCount}
                    </span>
                  )}
                </div>
              </div>

              {/* Bar indicator */}
              <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-300 ${
                    selectedLevel === stat.level
                      ? 'bg-indigo-600'
                      : stat.level.startsWith('A')
                      ? 'bg-emerald-500'
                      : stat.level.startsWith('B')
                      ? 'bg-sky-500'
                      : 'bg-purple-500'
                  }`}
                  style={{ width: `${Math.max(percentage, 2)}%` }}
                />
              </div>

              {/* Detail row */}
              <div className="flex justify-between items-center mt-1 text-[9px] text-slate-400 font-bold px-0.5">
                <span>Tỷ lệ: {percentage}% lý thuyết</span>
                <span>Mặc định: {stat.staticCount} | Nhập thêm: {stat.importedCount}</span>
              </div>
            </div>
          );
        })}

        <div className="text-[9.5px] text-slate-400 font-bold pt-1.5 border-t border-slate-100 flex justify-between items-center px-1">
          <span>Tổng cộng: {mergedVocabulary.length} từ</span>
          <span>Đã học/lưu: {personalList.length} từ</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      
      {/* Upper header section */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-3xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
              <Library className="h-5 w-5" />
            </span>
            <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Học Từ Vựng & Flashcards</h2>
          </div>
          <p className="text-xs text-slate-500 font-medium">
            Tra cứu từ điển học thuật {mergedVocabulary.length} mục chính thức cho kỳ thi lớp 6, 10, và 12. Phát triển vốn từ và rèn luyện trí nhớ qua thẻ thông minh.
          </p>
        </div>

        {/* Tab switch for Lookup / Practice / Import */}
        <div className="flex bg-slate-100 p-1 rounded-xl shrink-0 border border-slate-200/30">
          <button
            onClick={() => setActiveSubTab('lookup')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeSubTab === 'lookup'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Search className="h-3.5 w-3.5" /> Tra cứu từ vựng
          </button>
          <button
            onClick={() => setActiveSubTab('practice')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeSubTab === 'practice'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" /> Luyện tập Flashcards
          </button>
          {isAuthorizedToImport && (
            <button
              onClick={() => {
                setActiveSubTab('import');
                // reset import status when switching tabs
                setFileName('');
                setParsedItems([]);
                setImportFinished(false);
              }}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                activeSubTab === 'import'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Upload className="h-3.5 w-3.5 text-indigo-600" /> Nhập từ vựng (.txt) 📥
            </button>
          )}
        </div>
      </div>

      {/* RENDER VIEW 1: VOCABULARY LOOKUP */}
      {activeSubTab === 'lookup' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* SEARCH FILTERS AND STATISTICS (LEFT COLUMN) */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-3xs space-y-4">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest">Bộ lọc từ điển</h3>
              
              {/* Keywords Finder */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Tìm từ</label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="E.g. computer, brave, climate..."
                    className="w-full text-xs p-3 pl-9 bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-indigo-500 text-slate-800 font-semibold"
                  />
                  <Search className="absolute left-3 top-3.5 h-3.5 w-3.5 text-slate-400" />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-3.5 text-[10px] text-slate-400 font-bold hover:text-slate-700"
                    >
                      Xóa
                    </button>
                  )}
                </div>
              </div>

              {/* CEFR Level filter */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Trình độ CEFR</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {['all', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => setSelectedLevel(lvl)}
                      className={`py-2 px-1 text-center rounded-lg text-xs font-bold cursor-pointer transition-all border ${
                        selectedLevel === lvl
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-2xs'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      {lvl === 'all' ? 'Tất cả' : lvl}
                    </button>
                  ))}
                </div>
              </div>

              {/* Topic Select filter */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Chủ đề từ vựng</label>
                <select
                  value={selectedTopic}
                  onChange={(e) => setSelectedTopic(e.target.value)}
                  className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden text-slate-700 font-semibold cursor-pointer"
                >
                  <option value="all">Tất cả chủ đề</option>
                  {mergedTopics.map((topic) => (
                    <option key={topic} value={topic}>{topic}</option>
                  ))}
                </select>
              </div>

              {/* Clear filters Button */}
              {(selectedLevel !== 'all' || selectedTopic !== 'all' || searchQuery !== '') && (
                <button
                  onClick={() => {
                    setSelectedLevel('all');
                    setSelectedTopic('all');
                    setSearchQuery('');
                  }}
                  className="w-full text-xs font-bold text-indigo-600 hover:text-indigo-800 pt-2 text-center block"
                >
                  Thiết lập lại bộ lọc
                </button>
              )}
            </div>

            {/* QUICK STATS */}
            <div className="bg-slate-900 text-white p-5 rounded-2xl shadow-3xs space-y-3 relative overflow-hidden">
              <div className="absolute right-[-10px] bottom-[-15px] opacity-10">
                <Sparkles className="w-24 h-24" />
              </div>
              <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-[#f59e0b]">Trạng thái mục từ cá nhân</h4>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold">{personalList.length}</span>
                <span className="text-xs text-slate-300 font-medium">từ đã lưu</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-normal">
                Các từ được gắn dấu sao (star) đỏ sẽ lập tức lưu vào danh mục liên quan đến tài khoản học tập của bạn, cho phép luyện thi Flashcard bất kỳ lúc nào.
              </p>
            </div>

            {/* CEFR STATISTICS CARD */}
            {renderCefrStatsCard('hidden lg:block')}
          </div>

          {/* RESULTS DIRECTORY LISTING (RIGHT COLUMN) */}
          <div className="lg:col-span-8 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400 font-bold">
                Tìm thấy <span className="text-slate-700">{filteredLookupList.length}</span> mục từ vựng thích hợp
              </p>
              
              {personalList.length > 0 && (
                <button
                  onClick={() => {
                    setSelectedLevel('all');
                    setSelectedTopic('all');
                    setSearchQuery('');
                    // To show only saved, we filter through a custom mode. We can type word names as source
                    onShowModal({
                      type: 'info',
                      title: 'Sổ tay cá nhân',
                      message: `Bạn đang có ${personalList.length} từ đã lưu. Bạn có thể lựa chọn thẻ "Luyện tập Flashcards" và đặt Nguồn học là "Sổ tay cá nhân" để ghi nhớ.`
                    });
                  }}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" /> Sổ tay của tôi ({personalList.length})
                </button>
              )}
            </div>

            {filteredLookupList.length === 0 ? (
              <div className="bg-white p-12 text-center rounded-2xl border border-dashed border-slate-300 text-slate-500">
                <AlertCircle className="h-8 w-8 text-slate-301 mx-auto mb-2" />
                <p className="text-sm font-semibold">Không tìm thấy từ vựng nào phù hợp.</p>
                <p className="text-xs text-slate-400">Hãy thử gõ từ khóa khác hoặc thay đổi bộ lọc cấp độ/chủ đề.</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {paginatedList.map((item, index) => {
                    const isSaved = personalList.some(p => p.id === item.id);
                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: Math.min(index * 0.02, 0.2) }}
                        className="bg-white p-4.5 rounded-2xl border border-slate-200/80 shadow-3xs hover:border-indigo-200 hover:shadow-2xs transition-all flex flex-col justify-between"
                      >
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between">
                            {/* Level Badge */}
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md ${
                                item.level === 'A1' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                                item.level === 'A2' ? 'bg-teal-50 text-teal-700 border border-teal-100' :
                                item.level === 'B1' ? 'bg-sky-50 text-sky-700 border border-sky-100' :
                                item.level === 'B2' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' :
                                'bg-purple-50 text-purple-700 border border-purple-100'
                              }`}>
                                CEFR {item.level}
                              </span>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide truncate max-w-[130px]" title={item.topic}>
                                {item.topic}
                              </span>
                            </div>

                            {/* Star Toggle Button */}
                            <button
                              onClick={() => handleToggleBookmark(item)}
                              className="p-1.5 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors"
                              title={isSaved ? "Bỏ lưu từ" : "Lưu vào tủ cá nhân"}
                            >
                              <Star className={`h-4.5 w-4.5 ${isSaved ? 'text-rose-500 fill-rose-500' : 'text-slate-300'}`} />
                            </button>
                          </div>

                          {/* Word, Pronunciation Speaker */}
                          <div>
                            <div className="flex items-baseline gap-2">
                              <h4 className="text-base font-extrabold text-slate-900 font-sans tracking-tight">{item.word}</h4>
                              <span className="text-xs font-bold text-indigo-600 font-mono">{item.type}</span>
                            </div>
                            
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-xs text-slate-400 font-mono font-medium">{item.pronunciation}</span>
                              <button
                                onClick={() => handleSpeak(item.word)}
                                className="p-1 hover:bg-indigo-50 text-indigo-500 rounded-sm cursor-pointer transition-colors"
                                title="Nghe phát âm chuẩn chuẩn"
                              >
                                <Volume2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>

                          {/* Interpretation */}
                          <p className="text-xs text-slate-600 font-medium leading-relaxed bg-slate-50/50 p-2.5 rounded-lg border border-slate-100">
                            {item.definition}
                          </p>
                        </div>

                        <div className="border-t border-slate-100 pt-3 mt-3.5 flex items-center justify-between text-[10px] text-slate-400 font-bold uppercase">
                          <span>Đã chuẩn hóa</span>
                          <span className="text-slate-500">ID: {item.id}</span>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {/* PAGINATION CONTROLS */}
                {totalPages > 1 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-3xs">
                    <div className="text-xs text-slate-500 font-medium select-none">
                      Hiển thị từ <span className="text-slate-700 font-semibold">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> đến{" "}
                      <span className="text-slate-700 font-semibold">
                        {Math.min(currentPage * ITEMS_PER_PAGE, filteredLookupList.length)}
                      </span>{" "}
                      trong tổng số <span className="text-indigo-600 font-black">{filteredLookupList.length}</span> từ vựng
                    </div>

                    <div className="flex items-center gap-1.5">
                      {/* Prev Button */}
                      <button
                        onClick={() => {
                          setCurrentPage(prev => Math.max(prev - 1, 1));
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        disabled={currentPage === 1}
                        className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-all cursor-pointer"
                        title="Trang trước"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>

                      {/* Pages List */}
                      <div className="flex items-center gap-1">
                        {(() => {
                          const pages = [];
                          const maxVisible = 5;
                          let start = Math.max(1, currentPage - 2);
                          let end = Math.min(totalPages, start + maxVisible - 1);
                          
                          if (end - start + 1 < maxVisible) {
                            start = Math.max(1, end - maxVisible + 1);
                          }

                          if (start > 1) {
                            pages.push(
                              <button
                                key={1}
                                onClick={() => {
                                  setCurrentPage(1);
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                className={`w-8 h-8 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
                                  currentPage === 1
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'text-slate-600 hover:bg-slate-50 border border-transparent'
                                }`}
                              >
                                1
                              </button>
                            );
                            if (start > 2) {
                              pages.push(<span key="dots-start" className="text-slate-400 text-xs font-bold px-1 select-none">...</span>);
                            }
                          }

                          for (let p = start; p <= end; p++) {
                            pages.push(
                              <button
                                key={p}
                                onClick={() => {
                                  setCurrentPage(p);
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                className={`w-8 h-8 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
                                  currentPage === p
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'text-slate-600 hover:bg-slate-50 text-slate-800 border border-transparent hover:border-slate-100'
                                }`}
                              >
                                {p}
                              </button>
                            );
                          }

                          if (end < totalPages) {
                            if (end < totalPages - 1) {
                              pages.push(<span key="dots-end" className="text-slate-400 text-xs font-bold px-1 select-none">...</span>);
                            }
                            pages.push(
                              <button
                                key={totalPages}
                                onClick={() => {
                                  setCurrentPage(totalPages);
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                className={`w-8 h-8 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
                                  currentPage === totalPages
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'text-slate-600 hover:bg-slate-50 border border-transparent'
                                }`}
                              >
                                {totalPages}
                              </button>
                            );
                          }

                          return pages;
                        })()}
                      </div>

                      {/* Next Button */}
                      <button
                        onClick={() => {
                          setCurrentPage(prev => Math.min(prev + 1, totalPages));
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        disabled={currentPage === totalPages}
                        className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-all cursor-pointer"
                        title="Trang sau"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {/* CEFR STATISTICS CARD (Rendered on Mobile only, at the bottom) */}
            {renderCefrStatsCard('block lg:hidden mt-6')}
          </div>
        </div>
      )}

      {/* RENDER VIEW 2: FLASHCARD PRACTICE */}
      {activeSubTab === 'practice' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* SEARCH SELECTIONS PANEL (LEFT COLUMN) */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-3xs space-y-4">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest">Nguồn Học tập Flashcard</h3>
              
              {/* Pool selection: All vs personal */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Lựa chọn nguồn từ</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      setPracticeSource('all');
                      setPracticeTopic('all');
                      setPracticeLevel('all');
                    }}
                    className={`p-3 rounded-xl border text-xs font-bold text-center cursor-pointer flex flex-col items-center gap-1.5 transition-all ${
                      practiceSource === 'all'
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Library className="h-4 w-4" />
                    <span>Toàn bộ thư viện ({mergedVocabulary.length})</span>
                  </button>
                  <button
                    onClick={() => {
                      setPracticeSource('personal');
                      setPracticeTopic('all');
                      setPracticeLevel('all');
                    }}
                    className={`p-3 rounded-xl border text-xs font-bold text-center cursor-pointer flex flex-col items-center gap-1.5 transition-all ${
                      practiceSource === 'personal'
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <FolderOpen className="h-4 w-4 text-amber-500 fill-amber-500" />
                    <span>Sổ tay của tôi ({personalList.length})</span>
                  </button>
                </div>
              </div>

              {/* CEFR Level filter */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Trình độ từ vựng</label>
                <select
                  value={practiceLevel}
                  onChange={(e) => setPracticeLevel(e.target.value)}
                  className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden text-slate-700 font-semibold cursor-pointer"
                >
                  <option value="all">Tất cả trình độ</option>
                  <option value="A1">CEFR A1</option>
                  <option value="A2">CEFR A2</option>
                  <option value="B1">CEFR B1</option>
                  <option value="B2">CEFR B2</option>
                  <option value="C1">CEFR C1</option>
                </select>
              </div>

              {/* Topic Select filter */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Chủ đề cần luyện</label>
                <select
                  value={practiceTopic}
                  onChange={(e) => setPracticeTopic(e.target.value)}
                  className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden text-slate-700 font-semibold cursor-pointer"
                >
                  <option value="all">Tất cả chủ đề</option>
                  {/* Filter topic options that belong to source list for cleanliness */}
                  {mergedTopics.filter(t => {
                    const pool = practiceSource === 'all' ? mergedVocabulary : personalList;
                    return pool.some(item => item.topic.toLowerCase() === t.toLowerCase());
                  }).map((topic) => (
                    <option key={topic} value={topic}>{topic}</option>
                  ))}
                </select>
              </div>

              {/* Guessing directions mode selection */}
              <div className="space-y-1 pt-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Chế độ hiển thị mặt trước</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setGuessMode('word_first'); setIsFlipped(false); }}
                    className={`py-2 px-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                      guessMode === 'word_first'
                        ? 'bg-indigo-50 border border-indigo-200 text-indigo-700'
                        : 'bg-slate-50 border border-slate-200 text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    Xem từ đoán nghĩa
                  </button>
                  <button
                    onClick={() => { setGuessMode('definition_first'); setIsFlipped(false); }}
                    className={`py-2 px-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                      guessMode === 'definition_first'
                        ? 'bg-indigo-50 border border-indigo-200 text-indigo-700'
                        : 'bg-slate-50 border border-slate-200 text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    Xem nghĩa đoán từ
                  </button>
                </div>
              </div>
            </div>

            {/* LEARNING TRACKER PANEL */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-3xs space-y-3.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Tiến trình đợt học</h4>
                {masteredIds.length > 0 && (
                  <button 
                    onClick={resetMasterySession}
                    className="text-[10px] font-bold text-red-500 hover:text-red-700 flex items-center gap-1"
                  >
                    <RefreshCw className="h-3 w-3" />Đặt lại học tập
                  </button>
                )}
              </div>
              
              <div className="flex justify-between items-center text-xs font-semibold text-slate-500">
                <span>Số từ đã thuộc lòng:</span>
                <span className="text-indigo-600 font-extrabold">{masteredIds.length} / {practiceWords.length}</span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-indigo-600 rounded-full transition-all duration-300" 
                  style={{ width: `${practiceWords.length > 0 ? (masteredIds.length / practiceWords.length) * 100 : 0}%` }}
                />
              </div>

              <div className="text-[10px] text-slate-400 font-medium leading-relaxed">
                Mẹo: Nhấn nút <strong className="text-slate-600">Space</strong> để lật thẻ, <strong className="text-slate-600">Left/Right arrows</strong> thay đổi từ kế tiếp hoặc nhấn phím để duy trì tốc độ ôn tập.
              </div>
            </div>
          </div>

          {/* DYNAMIC FLIP CARD PANEL (RIGHT COLUMN) */}
          <div className="lg:col-span-8 flex flex-col justify-between space-y-4">
            
            {practiceWords.length === 0 ? (
              <div className="bg-white p-16 rounded-3xl border border-slate-200/80 shadow-3xs text-center flex-1 flex flex-col justify-center items-center">
                <BookOpen className="h-12 w-12 text-slate-300 mb-2 animate-pulse" />
                <p className="text-sm font-bold text-slate-700 leading-snug">Không có mục học tập thảo luận phù hợp.</p>
                <p className="text-xs text-slate-400 max-w-[280px] mt-1 mx-auto">
                  {practiceSource === 'personal' 
                    ? "Sổ tay cá nhân của bạn hiện chưa có từ vựng nào được đánh dấu. Hãy quay lại mục Tra cứu từ vựng để thêm một số từ trước."
                    : "Không tìm thấy từ vựng tương ứng trong thư viện với tiêu chuẩn bộ lọc đã chọn."
                  }
                </p>
                {practiceSource === 'personal' && (
                  <button
                    onClick={() => setActiveSubTab('lookup')}
                    className="mt-4 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    Sang thư viện tra cứu <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ) : (
              // ACTIVE DEPLOYED CARD DISPLAY
              <div className="space-y-6 flex-1 flex flex-col justify-between">
                
                {/* Header indicators */}
                <div className="flex justify-between items-center text-xs font-bold text-slate-400">
                  <span>Mục ôn {currentIndex + 1} trên {practiceWords.length} mục</span>
                  <div className="flex gap-1.5">
                    {masteredIds.includes(practiceWords[currentIndex].id) && (
                      <span className="flex items-center gap-1 bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded border border-emerald-200 text-[10px]">
                        <Check className="h-3 w-3" /> ĐÃ THUỘC
                      </span>
                    )}
                  </div>
                </div>

                {/* THE 3D FLIPPING CARD COMPONENT */}
                <div 
                  className="w-full aspect-video min-h-[300px] md:min-h-[350px] relative cursor-pointer"
                  onClick={() => setIsFlipped(prev => !prev)}
                >
                  <motion.div
                    className="w-full h-full relative transition-all duration-500"
                    style={{ transformStyle: 'preserve-3d' }}
                    animate={{ rotateY: isFlipped ? 180 : 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  >
                    
                    {/* CARD MINIMAL FRONT FACE */}
                    <div 
                      className={`absolute inset-0 w-full h-full bg-white rounded-3xl border border-slate-200/90 shadow-xs p-6 flex flex-col justify-between`}
                      style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-extrabold px-2.5 py-1 bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-md uppercase">
                          CEFR {practiceWords[currentIndex].level}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest max-w-[200px] truncate">
                          {practiceWords[currentIndex].topic}
                        </span>
                      </div>

                      {/* Display Front Content based on mode */}
                      <div className="text-center space-y-3.5 my-auto">
                        {guessMode === 'word_first' ? (
                          <>
                            <h3 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight">
                              {practiceWords[currentIndex].word}
                            </h3>
                            <div className="flex items-center justify-center gap-2">
                              <span className="text-xs font-bold text-indigo-600 font-mono">
                                ({practiceWords[currentIndex].type})
                              </span>
                              <span className="text-xs text-slate-400 font-mono font-medium">
                                {practiceWords[currentIndex].pronunciation}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation(); // prevent flipping
                                  handleSpeak(practiceWords[currentIndex].word);
                                }}
                                className="p-1.5 hover:bg-indigo-50 text-indigo-500 rounded-lg cursor-pointer transition-colors"
                              >
                                <Volume2 className="h-4 w-4" />
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="px-6 md:px-12 space-y-2.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Định nghĩa tiếng Anh:</span>
                            <p className="text-sm md:text-base text-slate-700 font-semibold leading-relaxed">
                              "{practiceWords[currentIndex].definition}"
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="text-center text-[10px] text-slate-400 font-bold uppercase py-1 border-t border-slate-100 flex items-center justify-center gap-1">
                        <RotateCw className="h-3 w-3 text-indigo-505" /> Bấm vào thẻ hoặc nhấn Space để đối chiếu nghĩa
                      </div>
                    </div>

                    {/* CARD MINIMAL BACK FACE */}
                    <div 
                      className={`absolute inset-0 w-full h-full bg-slate-900 text-white rounded-3xl border border-slate-900 shadow-md p-6 flex flex-col justify-between`}
                      style={{ 
                        backfaceVisibility: 'hidden', 
                        WebkitBackfaceVisibility: 'hidden',
                        transform: 'rotateY(180deg)' 
                      }}
                    >
                      <div className="flex justify-between items-center border-b border-white/10 pb-3">
                        <span className="text-[10px] font-bold tracking-wider text-[#38bdf8] uppercase">
                          {practiceWords[currentIndex].topic}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-extrabold bg-white/10 text-white px-2 py-0.5 rounded border border-white/10">
                            CEFR {practiceWords[currentIndex].level}
                          </span>
                        </div>
                      </div>

                      {/* Display Back Content based on mode */}
                      <div className="text-center space-y-4 my-auto px-4">
                        {guessMode === 'word_first' ? (
                          <div className="space-y-3">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Định nghĩa & Diễn giải từ vựng:</span>
                            <p className="text-sm md:text-base font-semibold leading-relaxed text-slate-200">
                              "{practiceWords[currentIndex].definition}"
                            </p>
                            <span className="text-[10px] text-slate-400 italic block mt-1">
                              Word class: <strong className="text-[#38bdf8] font-mono not-italic">{practiceWords[currentIndex].type}</strong>
                            </span>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Đáp án từ vựng chính xác:</span>
                            <h3 className="text-4xl font-extrabold text-[#38bdf8] tracking-tight">
                              {practiceWords[currentIndex].word}
                            </h3>
                            <div className="flex items-center justify-center gap-2">
                              <span className="text-xs text-indigo-300 font-mono font-bold">
                                ({practiceWords[currentIndex].type})
                              </span>
                              <span className="text-xs text-slate-300 font-mono font-semibold">
                                {practiceWords[currentIndex].pronunciation}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation(); // prevent flipping
                                  handleSpeak(practiceWords[currentIndex].word);
                                }}
                                className="p-1.5 hover:bg-slate-800 text-white rounded-lg cursor-pointer transition-colors"
                              >
                                <Volume2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Flashcard operations */}
                      <div className="pt-3 border-t border-white/10 flex items-center justify-between">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleBookmark(practiceWords[currentIndex]);
                          }}
                          className="flex items-center gap-1.5 text-xs font-bold text-slate-300 hover:text-white"
                        >
                          <Star className={`h-4 w-4 ${personalList.some(p => p.id === practiceWords[currentIndex].id) ? 'text-rose-500 fill-rose-500' : 'text-slate-400'}`} />
                          <span>Sổ tay</span>
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleMastered(practiceWords[currentIndex]);
                          }}
                          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            masteredIds.includes(practiceWords[currentIndex].id)
                              ? 'bg-emerald-600 text-white'
                              : 'bg-white/10 text-slate-200 hover:bg-white/15'
                          }`}
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          <span>{masteredIds.includes(practiceWords[currentIndex].id) ? 'Dọn khỏi đợt ôn' : 'Đánh dấu Thuộc lòng'}</span>
                        </button>
                      </div>
                    </div>

                  </motion.div>
                </div>

                {/* BOTTOM MANUAL CONTROLS */}
                <div className="flex gap-4 items-center justify-between">
                  <button
                    onClick={handlePrevCard}
                    className="flex-1 py-3 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-200 rounded-xl font-bold text-xs flex items-center justify-center gap-1 shadow-3xs cursor-pointer active:scale-98 transition-transform"
                  >
                    <ArrowLeft className="h-4 w-4" /> Từ trước đó
                  </button>
                  <button
                    onClick={() => setIsFlipped(prev => !prev)}
                    className="p-3 bg-indigo-50 border border-indigo-100 text-indigo-700 hover:bg-indigo-100 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    title="Lật thẻ"
                  >
                    <RotateCw className="h-4 w-4" /> Lật thẻ
                  </button>
                  <button
                    onClick={handleNextCard}
                    className="flex-1 py-3 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-200 rounded-xl font-bold text-xs flex items-center justify-center gap-1 shadow-3xs cursor-pointer active:scale-98 transition-transform"
                  >
                    Từ kế tiếp <ArrowRight className="h-4 w-4" />
                  </button>
                </div>

              </div>
            )}
          </div>
        </div>
      )}

      {/* RENDER VIEW 3: VOCABULARY IMPORT */}
      {activeSubTab === 'import' && isAuthorizedToImport && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in">
          
          {/* CONF AND GUIDE PANEL (LEFT COLUMN) */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-3xs space-y-4">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">
                <Info className="h-4 w-4 text-indigo-500" /> Cấu hình Nhập (.txt)
              </h3>

              {/* CEFR Level selection to attach imported words to */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Trình độ từ vựng Gốc</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => {
                        setImportLevel(lvl as any);
                        // Re-preview items with the newly selected level
                        if (fileName && parsedItems.length > 0) {
                          const updated = parsedItems.map(item => ({ ...item, level: lvl as any }));
                          setParsedItems(updated);
                        }
                      }}
                      className={`py-2 px-1 text-center rounded-lg text-xs font-bold transition-all border ${
                        importLevel === lvl
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-2xs'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-1 leading-normal font-medium">
                  Tất cả từ vựng được phân tách trong tập tin .txt tải lên sẽ được ghi nhận dưới trình độ này.
                </p>
              </div>

              {/* Wipe-out existing vocab of selected level option */}
              <div className="pt-3 border-t border-slate-100">
                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={clearExistingBeforeImport}
                    onChange={(e) => setClearExistingBeforeImport(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-700 block">Xóa sạch dữ liệu đã lưu</span>
                    <span className="text-[10px] font-medium text-slate-500 leading-normal block">
                      Xóa toàn bộ từ vựng đã nhập trước đó của trình độ <b className="text-indigo-600 font-bold">{importLevel}</b> trước khi thêm mới.
                    </span>
                  </div>
                </label>
              </div>

              {/* Format guidelines helper box */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Hướng dẫn Định dạng tệp</h4>
                <div className="text-[11px] text-slate-600 space-y-2 leading-relaxed">
                  <p>Để hệ thống tự động nhận dạng chính xác, vui lòng chuẩn bị tệp tin <b>.txt</b> theo định dạng CSV sau:</p>
                  
                  <div className="space-y-1.5 font-mono text-[9.5px] bg-white p-2 rounded-lg border border-slate-200 leading-tight">
                    <p className="text-indigo-650 font-bold">// Dòng đầu tiên (Tiêu đề tệp):</p>
                    <p className="text-slate-700 font-semibold">No.,Topic,Word,Type,Pronunciation,Definition</p>
                    <p className="text-indigo-650 font-bold mt-2">// Các dòng dữ liệu tiếp theo:</p>
                    <p>1,Animals,skunk,n.,/skAnk/,"Small black-and-white mammal producing strong unpleasant smell."</p>
                    <p>2,Animals,flock,n.,/fla:k/,"A group of birds of the same type together."</p>
                    <p className="text-slate-400 mt-2 italic">// Lưu ý: Nếu định nghĩa có dấu phẩy (,), vui lòng đặt định nghĩa trong cặp dấu ngoặc kép "" để tránh phân tách sai cột.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* STATUS STATS PREVIEW (ONLY AFTER CHOSEN FILE) */}
            {fileName && parsedItems.length > 0 && (
              <div className="bg-slate-900 text-emerald-100 p-5 rounded-2xl shadow-3xs space-y-4 relative overflow-hidden">
                <div className="absolute right-[-10px] bottom-[-20px] opacity-10 text-emerald-300">
                  <FileText className="w-24 h-24" />
                </div>
                <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400">Thông báo Phân tích Tệp</h4>

                <div className="space-y-2 font-semibold">
                  <div className="flex justify-between text-xs pb-1 border-b border-white/10 font-medium text-slate-350">
                    <span>Tổng số dòng đọc được:</span>
                    <strong className="text-white text-sm">{importStats.total} từ</strong>
                  </div>
                  <div className="flex justify-between text-xs pb-1 border-b border-white/10 font-medium text-slate-350">
                    <span>Trùng lặp tự động loại bỏ:</span>
                    <strong className="text-rose-455 text-sm">{importStats.dups} từ</strong>
                  </div>
                  <div className="flex justify-between text-xs font-medium text-emerald-305">
                    <span>Sẵn sàng lưu trữ an toàn:</span>
                    <strong className="text-emerald-400 text-lg">{importStats.ready} từ</strong>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isImporting || importStats.ready === 0}
                  onClick={executeVocabularyImport}
                  className={`w-full py-3 rounded-xl text-xs font-extrabold uppercase tracking-wider shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer ${
                    isImporting || importStats.ready === 0
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed shadow-none'
                      : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 hover:scale-101 active:scale-99'
                  }`}
                >
                  {isImporting ? (
                    <>
                      <RotateCw className="h-4 w-4 animate-spin text-slate-900" />
                      <span>{importProgress || 'Đang đồng bộ...'}</span>
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" /> Bắt đầu đồng bộ ({importStats.ready})
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* UPLOAD BOX OR INTERACTIVE PREVIEW LISTING (RIGHT COLUMN) */}
          <div className="lg:col-span-8 flex flex-col justify-start">
            {!fileName ? (
              <div 
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                className={`py-20 px-8 rounded-3xl border-2 border-dashed text-center flex flex-col justify-center items-center transition-all min-h-[450px] bg-white relative ${
                  dragActive 
                    ? 'border-indigo-505 bg-indigo-50/50 scale-[0.99]' 
                    : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50/40'
                }`}
              >
                <div className="p-4 bg-indigo-50 text-indigo-600 rounded-full mb-4">
                  <Upload className="h-8 w-8 animate-bounce" />
                </div>
                
                <h3 className="text-base font-extrabold text-slate-800 leading-tight">Tải lên danh sách học tập (.txt)</h3>
                <p className="text-xs text-slate-505 max-w-[380px] mt-1.5 leading-relaxed font-semibold">
                  Kéo và thả tệp văn bản từ máy tính của bạn vào đây, hoặc nhấn để duyệt lựa chọn tệp .txt chứa danh mục.
                </p>

                <label className="mt-6 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-xs shadow-sm cursor-pointer hover:shadow-md transition-all">
                  Lựa chọn tệp tin từ thiết bị
                  <input
                    type="file"
                    accept=".txt"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>

                <div className="mt-8 pt-6 border-t border-slate-100 w-full max-w-[420px] text-left text-[11px] text-slate-400 space-y-1.5 px-4 leading-normal font-medium">
                  <p className="font-bold uppercase tracking-wider text-slate-500 mb-1">💡 LƯU Ý QUAN TRỌNG:</p>
                  <p>• Hệ thống sẽ tự động đối chiếu các mục từ vựng mới với thư viện mặc định.</p>
                  <p>• Loại bỏ toàn bộ từ vựng song trùng để tránh nhiễu và lưu bộ nhớ đám mây của bạn.</p>
                </div>
              </div>
            ) : (
              // ACTIVE PREVIEW OF THE PARSED FILE
              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-3xs flex flex-col h-full min-h-[500px]">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                      <FileText className="h-4.5 w-4.5 text-indigo-500" />
                      Xem trước: <span className="text-indigo-600 max-w-[200px] truncate">{fileName}</span>
                    </h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">
                      Trình độ gán: <span className="text-indigo-600">CEFR {importLevel}</span>
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setFileName('');
                      setParsedItems([]);
                    }}
                    className="text-xs text-red-500 hover:text-red-700 font-bold"
                  >
                    Hủy tệp hiện tại (X)
                  </button>
                </div>

                {parsedItems.length === 0 ? (
                  <div className="flex flex-col justify-center items-center my-auto py-12 text-slate-400">
                    <AlertCircle className="h-8 w-8 text-amber-500 mb-2" />
                    <p className="text-xs font-bold">Không tìm thấy từ vựng hợp lệ trong tệp.</p>
                    <p className="text-[10px] text-slate-400">Kiểm tra lại dấu tách dòng hoặc dòng trống.</p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto max-h-[500px] pr-1 space-y-2">
                    {parsedItems.map((item, id) => {
                      const dupSource = isDuplicateItem(item.word, item.level, clearExistingBeforeImport ? importLevel : undefined);
                      return (
                        <div 
                          key={id}
                          className={`p-3 rounded-xl border text-xs flex justify-between items-center transition-all ${
                            dupSource 
                              ? 'bg-rose-50/50 border-rose-100 text-slate-400 opacity-60' 
                              : 'bg-slate-50/70 border-slate-200/70 text-slate-800'
                          }`}
                        >
                          <div className="space-y-1 max-w-[80%]">
                            <div className="flex items-center gap-2">
                              <h4 className={`font-extrabold text-sm ${dupSource ? 'line-through text-slate-450' : 'text-slate-900'}`}>{item.word}</h4>
                              <span className="text-[10px] font-bold text-indigo-500 font-mono italic">({item.type})</span>
                              {item.pronunciation && (
                                <span className="text-[10px] text-slate-450 font-mono font-medium">{item.pronunciation}</span>
                              )}
                            </div>
                            <p className="text-slate-500 font-medium text-[11px] leading-snug">{item.definition}</p>
                            <span className="text-[9px] px-1.5 py-0.5 bg-slate-200 border border-slate-300 rounded font-bold uppercase text-slate-500">
                              Chủ đề: {item.topic}
                            </span>
                          </div>

                          {dupSource ? (
                            <span className="px-2 py-1 bg-rose-100 text-rose-750 rounded-md font-bold text-[9px] uppercase tracking-wide">
                              Trùng ({dupSource})
                            </span>
                          ) : (
                            <span className="px-2 py-1 bg-emerald-100 text-emerald-850 rounded-md font-bold text-[9px] uppercase tracking-wide font-sans">
                              Sẵn sàng
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
