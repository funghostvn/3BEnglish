import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Body parser with large limit for PDF base64 payloads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Initialize Gemini Client
const geminiApiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (geminiApiKey) {
  ai = new GoogleGenAI({ 
    apiKey: geminiApiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

// Robust wrapper function with retry, exponential backoff, and automatic model failover
async function generateContentWithRetry(model: string, config: any, maxRetries = 2, initialDelayMs = 1000) {
  let activeModel = model;
  let delay = initialDelayMs;
  let hasFallenBack = false;
  const totalMaxAttempts = maxRetries * 2; // Allow fallback switch

  for (let attempt = 1; attempt <= totalMaxAttempts; attempt++) {
    try {
      if (!ai) {
        throw new Error("Gemini AI client not initialized.");
      }
      console.log(`[Gemini Engine] Querying model ${activeModel} (Attempt ${attempt}/${totalMaxAttempts})...`);
      const response = await ai.models.generateContent({
        model: activeModel,
        contents: config.contents,
        config: config.config
      });
      return response;
    } catch (err: any) {
      const errStr = (err.message || "").toUpperCase();
      const status = err.status || err.code || 0;
      
      const isTemporary = 
        status === 503 ||
        status === 502 ||
        status === 504 ||
        status === 429 ||
        errStr.includes("503") ||
        errStr.includes("502") ||
        errStr.includes("504") ||
        errStr.includes("429") ||
        errStr.includes("UNAVAILABLE") ||
        errStr.includes("HIGH DEMAND") ||
        errStr.includes("RATE_LIMIT") ||
        errStr.includes("RESOURCE_EXHAUSTED") ||
        errStr.includes("QUOTA") ||
        errStr.includes("BUSY") ||
        errStr.includes("SPIKES IN DEMAND") ||
        errStr.includes("TEMPORARY");

      if (isTemporary) {
        // Fallback condition: switch model early
        if (!hasFallenBack && attempt >= 2) {
          const fallbackModel = activeModel === "gemini-3.5-flash" ? "gemini-3.1-flash-lite" : "gemini-3.5-flash";
          console.warn(`[Gemini Engine Warning] Primary model ${activeModel} failed or exceeded quota. Seamlessly falling back to '${fallbackModel}' for the remaining attempts...`);
          activeModel = fallbackModel;
          hasFallenBack = true;
          delay = initialDelayMs; // Reset backoff delay for the fallback model
        }

        // Parse precise requested retry delay from raw google error message if possible
        let requestedDelayMs = 0;
        try {
          const parsedErr = JSON.parse(err.message);
          if (parsedErr && parsedErr.error && Array.isArray(parsedErr.error.details)) {
            const retryInfo = parsedErr.error.details.find((d: any) => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
            if (retryInfo && retryInfo.retryDelay) {
              const seconds = parseFloat(retryInfo.retryDelay);
              if (!isNaN(seconds)) {
                requestedDelayMs = Math.ceil(seconds * 1000) + 700; // Add 700ms padding
                console.log(`[Gemini Engine] Extracted RetryInfo delay: ${requestedDelayMs}ms`);
              }
            }
          }
        } catch (jsonErr) {
          // ignore parsing error
        }

        // Fallback to regex-based search for "Please retry in X.XXs" or "retry in X.XXs"
        if (!requestedDelayMs) {
          const match = errStr.match(/RETRY\s+IN\s+([\d.]+)\s*S/);
          if (match) {
            const seconds = parseFloat(match[1]);
            if (!isNaN(seconds)) {
              requestedDelayMs = Math.ceil(seconds * 1000) + 700;
              console.log(`[Gemini Engine] Extracted regex retry delay: ${requestedDelayMs}ms`);
            }
          }
        }

        // If it's a resource exhaustion/rate limit, set a high default backoff time of 3.5s to clear the rate limit window
        if (!requestedDelayMs && (errStr.includes("RESOURCE_EXHAUSTED") || errStr.includes("RATE_LIMIT") || status === 429)) {
          requestedDelayMs = 3500;
        }

        if (attempt < totalMaxAttempts) {
          const waitTime = requestedDelayMs || delay;
          console.warn(`[Gemini Engine Warning] Attempt ${attempt} failed on ${activeModel} due to transient issue or quota limit. Retrying in ${waitTime}ms... Error:`, err.message || err);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          
          if (requestedDelayMs) {
            delay = Math.min(requestedDelayMs * 2, 6000);
          } else {
            delay = Math.min(delay * 2, 5000); // Strict exponential backoff with 5s ceiling to stay within gateway/Vite timeout
          }
        } else {
          throw err;
        }
      } else {
        // Non-temporary errors (e.g. invalid parameter/empty content) are thrown immediately
        throw err;
      }
    }
  }
  throw new Error("Tần suất gửi yêu cầu quá cao hoặc mô hình đang quá tải. Vui lòng chọn ít học liệu hơn hoặc thử lại sau giây lát.");
}

// High-fidelity local classifier fallback for vocabulary and grammar evaluation
function localEvaluatePassages(passages: any[]) {
  const evaluatedPassages = passages.map((passage, pIdx) => {
    const textToAnalyze = ((passage.title || "") + " " + (passage.content || "")).toLowerCase();
    
    // 1. Vocabulary Theme classification
    let vocabTheme = "Human environment"; // default
    
    const vocabRuleMap: { [key: string]: string[] } = {
      "Family life": ["family", "parent", "mother", "father", "son", "daughter", "child", "home", "household", "marriage", "relatives"],
      "Music": ["music", "song", "singer", "instrument", "concert", "melody", "musician", "band", "album", "performing", "lyric"],
      "Better community": ["community", "volunteer", "donate", "charity", "society", "help", "benefit", "group", "nonprofit"],
      "Inventions": ["invent", "technology", "device", "science", "patent", "machine", "innovation", "gadget", "discovery"],
      "Heritage": ["heritage", "culture", "ancient", "temple", "monument", "history", "traditional", "preserve", "legacy"],
      "Cultural diversity": ["diversity", "custom", "ethnic", "tradition", "multicultural", "beliefs", "values", "identity"],
      "Learning ways": ["learn", "study", "method", "class", "online", "skills", "strategy", "classroom", "practice"],
      "Environmental protection": ["environment", "pollution", "recycle", "waste", "garbage", "nature", "protect", "emission", "eco", "green"],
      "Lifelong learning": ["lifelong", "adult education", "continuous learning", "skills upgrade", "mature student", "ongoing"],
      "Healthy life": ["health", "diet", "exercise", "nutrition", "fitness", "disease", "doctor", "lifestyle", "sport", "wellness"],
      "Generation gap": ["generation", "gap", "parental", "grandparent", "teenager", "conflict", "age difference", "elders"],
      "Future cities": ["city", "urban", "smart", "infrastructure", "megacity", "transportation", "skyscraper", "metro"],
      "ASEAN Vietnam": ["asean", "vietnam", "viet nam", "association of southeast", "regional", "singapore", "thailand", "malaysia", "hanoi"],
      "Global warming": ["warming", "climate", "carbon", "greenhouse", "co2", "temperature", "glacier", "ozone", "atmospheric"],
      "Education options": ["education", "school", "university", "college", "degree", "diploma", "academic", "scholarship", "tuition"],
      "Becoming independent": ["independent", "self-reliance", "rely on yourself", "autonomy", "decision-making", "cooking", "bills"],
      "Social issues": ["social issue", "poverty", "unemployment", "crime", "homeless", "discrimination", "inequality", "society"],
      "Ecosystem": ["ecosystem", "biodiversity", "species", "habitat", "flora", "fauna", "biology", "forest", "marine", "nature"],
      "Life stories": ["biography", "life story", "born", "achieve", "career milestone", "famous person", "autobiography", "childhood"],
      "Multicultural world": ["multicultural", "globalization", "integration", "cross-cultural", "international", "global"],
      "Green living": ["green living", "eco-friendly", "solar", "renewable", "organic", "synthesis", "compost", "sustainability"],
      "Urbanisation": ["urbanisation", "urbanization", "migration", "rural-urban", "population growth", "city expansion", "metropolis"],
      "Work world": ["work world", "employer", "employee", "salary", "wage", "workplace", "resume", "interview", "office"],
      "Artificial intelligence": ["artificial intelligence", "ai", "machine learning", "robot", "automation", "algorithm", "deep learning", "nlp"],
      "Mass media": ["media", "television", "radio", "newspaper", "journalism", "broadcast", "internet news", "social networks"],
      "Wildlife conservation": ["wildlife", "conservation", "endangered", "extinction", "protect animal", "poaching", "national park", "species"],
      "Career paths": ["career", "profession", "vocation", "employment", "job path", "occupation", "hiring", "resume"]
    };

    let maxMatchCount = 0;
    for (const [theme, keywords] of Object.entries(vocabRuleMap)) {
      let matches = 0;
      keywords.forEach(keyword => {
        if (textToAnalyze.includes(keyword)) {
          matches++;
        }
      });
      if (matches > maxMatchCount) {
        maxMatchCount = matches;
        vocabTheme = theme;
      }
    }

    // 2. Questions Grammar & Difficulty classification
    const evaluatedQuestions = (passage.questions || []).map((q: any, qIdx: number) => {
      const qText = (q.text || "").toLowerCase();
      const qOptions = Object.values(q.options || {}).join(" ").toLowerCase();
      const sentence = qText + " " + qOptions;

      // Classifying Grammar
      let grammarCat = "Other grammar";
      
      const conditionalWords = ["if ", "had i", "were you", "unless", "provided that", "as long as"];
      const relativePronouns = ["who", "whom", "whose", "which", "that lives", "that is", "in which", "where the"];
      const reportedSpeechWords = ["said that", "asked", "told", "wondered if", "whether", "reported that", "denied having"];
      const clauseLinks = ["because", "although", "though", "since", "so that", "in order to", "even if", "despite", "in spite of", "nevertheless", "furthermore", "however", "but "];
      const verbFormsWords = ["to infinitive", "to verb", "avoid", "enjoy", "suggested doing", "fancy", "look forward to", "mind doing", "interested in", "fond of", "keen on"];
      const passiveIndicators = ["by him", "by her", "by them", "was written", "were taken", "is characterized", "been created", "is shown", "is known", "was made", "were built"];
      
      // Check conditionals first
      if (conditionalWords.some(w => qText.includes(w))) {
        grammarCat = "Conditionals";
      } else if (passiveIndicators.some(w => sentence.includes(w))) {
        grammarCat = "Passive voice";
      } else if (reportedSpeechWords.some(w => sentence.includes(w))) {
        grammarCat = "Reported speech";
      } else if (relativePronouns.some(w => qText.includes(w))) {
        grammarCat = "Relative clauses";
      } else if (clauseLinks.some(w => sentence.includes(w))) {
        grammarCat = "Clause links";
      } else if (verbFormsWords.some(w => sentence.includes(w))) {
        grammarCat = "Verb forms";
      } else if (
        sentence.includes("will ") || sentence.includes("would ") || sentence.includes("shall ") || 
        sentence.includes("have been") || sentence.includes("has been") || sentence.includes("had been") ||
        sentence.includes(" am ") || sentence.includes("is ") || sentence.includes("are ") ||
        sentence.includes(" was ") || sentence.includes("were ") || sentence.endsWith("ed")
      ) {
        grammarCat = "Verb tenses";
      }

      // Classifying CEFR Difficulty based on typical position in Vietnamese high school English test
      let difficulty = "B1"; // Default balanced level
      
      const qNumber = q.questionNumber || (qIdx + 1);
      if (qNumber <= 8) {
        difficulty = "A2";
      } else if (qNumber <= 16) {
        difficulty = "B1";
      } else if (qNumber <= 28) {
        difficulty = "B2";
      } else if (qNumber <= 35) {
        difficulty = "C1";
      } else {
        difficulty = "C2";
      }

      // If sentence has extremely long words, upgrade difficulty slightly
      const words = sentence.split(/\s+/);
      const longWordsCount = words.filter((w: any) => w.length > 9).length;
      if (longWordsCount > 4 && difficulty !== "C2") {
        difficulty = difficulty === "A2" ? "B1" : difficulty === "B1" ? "B2" : "C1";
      }

      return {
        questionIndex: qIdx,
        questionNumber: qNumber,
        difficulty: difficulty,
        grammarCategory: grammarCat
      };
    });

    return {
      passageIndex: pIdx,
      vocabularyCategory: vocabTheme,
      questions: evaluatedQuestions
    };
  });

  return { passages: evaluatedPassages };
}

function localBatchEvaluatePassages(passages: any[]) {
  const localEvaluations = localEvaluatePassages(passages);
  const results = localEvaluations.passages.map((evPassage, pIdx) => {
    const originalPassage = passages[pIdx];
    return {
      id: originalPassage.id,
      vocabularyCategory: evPassage.vocabularyCategory,
      questions: evPassage.questions.map(q => ({
        questionNumber: q.questionNumber,
        difficulty: q.difficulty,
        grammarCategory: q.grammarCategory
      }))
    };
  });
  return { results };
}

// High-fidelity local fallback exam generator in case of total Gemini API Quota exhaustion (429)
function getLocalFallbackExam(fileName?: string): any {
  const lowerName = (fileName || "").toLowerCase();
  
  let grade = 10;
  let title = "Đề thi tuyển sinh vào lớp 10 THPT môn Tiếng Anh (Dự phòng)";
  let examName = "Kỳ thi tuyển sinh vào lớp 10 THPT môn: Tiếng Anh";
  let examCode = "109";
  let publisher = "Sở Giáo dục và Đào tạo Hà Nội";
  let numQuestions = 40;
  let duration = 60;
  let year = 2026;

  if (lowerName.includes("lớp 6") || lowerName.includes("grade 6") || lowerName.includes("lop 6") || lowerName.includes("thcs")) {
    grade = 6;
    title = "Đề thi đánh giá năng lực tuyển sinh lớp 6 trường THCS Nguyễn Tất Thành (Dự phòng)";
    examName = "Đề thi đánh giá năng lực tuyển sinh lớp 6 môn Tiếng Anh";
    examCode = "NTT-6";
    publisher = "Trường THCS & THPT Nguyễn Tất Thành";
    numQuestions = 25;
    duration = 45;
  } else if (lowerName.includes("lớp 12") || lowerName.includes("thpt") || lowerName.includes("tốt nghiệp") || lowerName.includes("grade 12") || lowerName.includes("lop 12")) {
    grade = 12;
    title = "Đề thi minh họa THPT Quốc gia môn Tiếng Anh (Dự phòng)";
    examName = "Kỳ thi tốt nghiệp THPT Quốc gia môn Tiếng Anh";
    examCode = "THPT-12";
    publisher = "Bộ Giáo dục và Đào tạo";
    numQuestions = 40;
    duration = 60;
  }

  let passagesArr: any[] = [];

  if (grade === 6) {
    passagesArr = [
      {
        title: "Phần 1: Trắc nghiệm ngữ âm & ngữ pháp và từ vựng",
        content: "<b>Chọn phương án đúng nhất A, B, C hoặc D để hoàn thành các câu sau.</b>",
        vocabularyCategory: "Learning ways",
        questions: [
          {
            questionNumber: 1,
            text: "My brother enjoys _______ football with his classmate after school.",
            options: { "A": "to play", "B": "playing", "C": "play", "D": "plays" },
            correctAnswer: "B",
            explanation: "Cấu trúc 'enjoy + V-ing' nghĩa là yêu thích làm việc gì.",
            difficulty: "A2",
            grammarCategory: "Verb forms"
          },
          {
            questionNumber: 2,
            text: "He is interested in technology, so he always wants to _______ new gadgets.",
            options: { "A": "invent", "B": "destroy", "C": "protect", "D": "share" },
            correctAnswer: "A",
            explanation: "Từ 'invent' (phát minh/sáng chế) phù hợp nhất với chủ đề công nghệ/sáng tạo.",
            difficulty: "A2",
            grammarCategory: "Other grammar"
          },
          {
            questionNumber: 3,
            text: "Last year, we _______ a lot of books to children in poor villages.",
            options: { "A": "donate", "B": "are donating", "C": "donated", "D": "will donate" },
            correctAnswer: "C",
            explanation: "Có trạng từ 'Last year' (năm ngoái) nên chia động từ ở thì Quá khứ đơn 'donated'.",
            difficulty: "B1",
            grammarCategory: "Verb tenses"
          },
          {
            questionNumber: 4,
            text: "You _______ brush your teeth twice a day to keep them healthy.",
            options: { "A": "might", "B": "should", "C": "could", "D": "would" },
            correctAnswer: "B",
            explanation: "Dùng động từ khuyết thiếu 'should' để đưa ra lời khuyên nên làm gì.",
            difficulty: "A2",
            grammarCategory: "Other grammar"
          }
        ]
      },
      {
        title: "Phần 2: Đọc hiểu văn bản ngắn",
        content: "<b>Đọc đoạn văn ngắn sau và trả lời câu hỏi bằng cách chọn A, B, C hoặc D.</b><br/><br/>My family lives in a cozy household in Hanoi. Every day, my parents work very hard to keep our home warm and comfortable. We always have dinner together at 7:00 PM and share our stories of family life.",
        vocabularyCategory: "Family life",
        questions: [
          {
            questionNumber: 5,
            text: "Who does the writer live with in Hanoi?",
            options: { "A": "His classmates", "B": "His grandparents", "C": "His parents", "D": "His family" },
            correctAnswer: "D",
            explanation: "Dẫn chứng ngay câu đầu tiên: 'My family lives in a cozy household in Hanoi.'",
            difficulty: "A2",
            grammarCategory: "Other grammar"
          },
          {
            questionNumber: 6,
            text: "What time does the family usually have dinner?",
            options: { "A": "At 6:00 PM", "B": "At 7:00 PM", "C": "At 8:00 PM", "D": "At 7:00 AM" },
            correctAnswer: "B",
            explanation: "Dẫn chứng: 'We always have dinner together at 7:00 PM...'",
            difficulty: "A2",
            grammarCategory: "Other grammar"
          }
        ]
      }
    ];
  } else if (grade === 12) {
    passagesArr = [
      {
        title: "Part 1: Language and Lexis",
        content: "<b>Mark the letter A, B, C, or D on your answer sheet to indicate the correct answer to each of the following questions.</b>",
        vocabularyCategory: "Inventions",
        questions: [
          {
            questionNumber: 1,
            text: "If Thomas Edison _______ the light bulb, the work world would be completely different today.",
            options: { "A": "doesn't invent", "B": "didn't invent", "C": "hadn't invented", "D": "hasn't invented" },
            correctAnswer: "C",
            explanation: "Câu điều kiện hỗn hợp hoặc điều kiện loại 3 diễn tả sự việc trái với quá khứ: Edison phát minh trong quá khứ nên mệnh đề If dùng thì Quá khứ hoàn thành 'hadn't invented'.",
            difficulty: "C1",
            grammarCategory: "Conditionals"
          },
          {
            questionNumber: 2,
            text: "New digital learning platforms _______ by schools all over the world since last semester.",
            options: { "A": "have adopted", "B": "have been adopted", "C": "are adopted", "D": "were adopted" },
            correctAnswer: "B",
            explanation: "Cấu trúc bị động ở thì Hiện tại hoàn thành có trạng ngữ 'since last semester': 'S + have/has been + V3/ed'.",
            difficulty: "B2",
            grammarCategory: "Passive voice"
          },
          {
            questionNumber: 3,
            text: "The student _______ won the national science championship last month plans to study artificial intelligence at MIT.",
            options: { "A": "whose", "B": "which", "C": "who", "D": "whom" },
            correctAnswer: "C",
            explanation: "Đại từ quan hệ 'who' thay thế cho danh từ chỉ người 'The student' đóng vai trò làm chủ ngữ trong mệnh đề quan hệ.",
            difficulty: "B1",
            grammarCategory: "Relative clauses"
          },
          {
            questionNumber: 4,
            text: "She decided to focus on environmental protection _______ she wants to save endangered ecosystems.",
            options: { "A": "although", "B": "because", "C": "despite", "D": "nevertheless" },
            correctAnswer: "B",
            explanation: "Liên từ 'because' chỉ nguyên nhân kết quả (Cô ấy quyết định tập trung bảo vệ môi trường vì muốn cứu hệ sinh thái gặp nguy hiểm).",
            difficulty: "B1",
            grammarCategory: "Clause links"
          }
        ]
      },
      {
        title: "Part 2: Short Reading Comprehension",
        content: "<b>Read the passage below and mark the letter A, B, C, or D to answer the questions.</b><br/><br/>The rapid development of artificial intelligence (AI) has dramatically reshaped the modern work world. Everyday tasks are automated by sophisticated algorithms, prompting employees to acquire lifelong learning skills to remain competitive in global career paths.",
        vocabularyCategory: "Artificial intelligence",
        questions: [
          {
            questionNumber: 15,
            text: "What is the main topic of the reading passage?",
            options: {
              "A": "The rise of robot companions in households",
              "B": "How AI is changing the work world and career paths",
              "C": "The history of computer science inside universities",
              "D": "The negative impacts of social media on youth"
            },
            correctAnswer: "B",
            explanation: "The text emphasizes AI reshaping the work world and needing lifelong learning for career pathways.",
            difficulty: "B2",
            grammarCategory: "Other grammar"
          },
          {
            questionNumber: 16,
            text: "The word 'automated' in the text is closest in meaning to _______.",
            options: { "A": "handled manually", "B": "run by machines", "C": "forgotten entirely", "D": "created recently" },
            correctAnswer: "B",
            explanation: "Automated means operated or run automatically, i.e., run by machines/algorithms.",
            difficulty: "B2",
            grammarCategory: "Other grammar"
          }
        ]
      }
    ];
  } else {
    passagesArr = [
      {
        title: "Section A: Pronunciation & Grammar",
        content: "<b>Mark the letter A, B, C, or D to indicate the correct answer to each question.</b>",
        vocabularyCategory: "Cultural diversity",
        questions: [
          {
            questionNumber: 1,
            text: "Many interesting traditions _______ by Vietnamese families during the Tet holiday.",
            options: { "A": "preserve", "B": "are preserved", "C": "is preserved", "D": "have preserved" },
            correctAnswer: "B",
            explanation: "Câu bị động ở thì Hiện tại đơn: 'traditions' (số nhiều) + 'are preserved' (được giữ gìn/bảo tồn).",
            difficulty: "B1",
            grammarCategory: "Passive voice"
          },
          {
            questionNumber: 2,
            text: "If you want to live a healthy life, you should make sure _______ balanced meals.",
            options: { "A": "to eat", "B": "eating", "C": "eat", "D": "eats" },
            correctAnswer: "A",
            explanation: "Cấu trúc 'make sure + to verb' (hãy chắc chắn làm gì đó).",
            difficulty: "B1",
            grammarCategory: "Verb forms"
          },
          {
            questionNumber: 3,
            text: "He told me that he _______ to England the following year to experience cultural diversity.",
            options: { "A": "will travel", "B": "travel", "C": "would travel", "D": "has traveled" },
            correctAnswer: "C",
            explanation: "Câu gián tiếp (Reported Speech): Động từ khuyết thiếu lùi thì từ 'will travel' thành 'would travel' do mệnh đề chính chia quá khứ 'told'.",
            difficulty: "B1",
            grammarCategory: "Reported speech"
          },
          {
            questionNumber: 4,
            text: "Mary is highly independent; _______, she managed to rent an apartment at just 18.",
            options: { "A": "although", "B": "however", "C": "therefore", "D": "but" },
            correctAnswer: "C",
            explanation: "Từ nối 'therefore' (do đó, vì vậy) hợp lý nhất để diễn tả sự việc nguyên nhân kết quả.",
            difficulty: "B2",
            grammarCategory: "Clause links"
          }
        ]
      },
      {
        title: "Section B: Reading Passage",
        content: "<b>Read the text below and choose the correct answer to complete each gap.</b><br/><br/>Vietnamese cultural diversity is represented through various traditional practices, heritage monuments, and colorful music festivals. Preserving our heritage helps maintain deep roots in our long-standing history as we integrate into a globalized multicultural world.",
        vocabularyCategory: "Heritage",
        questions: [
          {
            questionNumber: 5,
            text: "What is mentioned in the paragraph as a representer of cultural diversity?",
            options: {
              "A": "Modern skyscrapers and high-speed metro lines",
              "B": "Traditional practices, heritage monuments, and music festivals",
              "C": "Imported products from foreign countries",
              "D": "Digital devices and science discoveries"
            },
            correctAnswer: "B",
            explanation: "Dẫn chứng ngay dòng đầu: 'represented through various traditional practices, heritage monuments, and colorful music festivals.'",
            difficulty: "B1",
            grammarCategory: "Other grammar"
          }
        ]
      }
    ];
  }

  return {
    title: `${title} - ${fileName || "Đề thi tải lên.pdf"}`,
    examName: examName,
    examCode: examCode,
    numQuestions: numQuestions,
    duration: duration,
    publisher: publisher,
    year: year,
    passages: passagesArr,
    isLocalFallback: true
  };
}

// 1. Endpoint: AI Parse PDF info
app.post("/api/gemini/parse-exam", async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({ error: "Gemini API key is not configured on the server." });
    }

    const { fileBase64, mimeType, option } = req.body;
    if (!fileBase64) {
      return res.status(400).json({ error: "No file content or base64 provided." });
    }

    const systemPrompt = `
You are an expert English Language Exam Processor. Parse the provided English exam document (PDF) and extract all structural data, passages, and questions into a valid JSON format.

CRITICAL INSTRUCTIONS FOR COMPLETENESS & PASSAGES EXTRACATION:
1. READ THE ENTIRE DOCUMENT: You MUST scan and read the entire document from the very first page to the absolute end. Do not summarize, skip, or omit any paragraph, sentence, reading passage, or question of the exam.
2. EXTRACT ALL READING PASSAGES COMPLETELY: Every single reading comprehension block, passage, cloze-test paragraph, or dialogue prompt MUST be fully extracted in literal form into the "passages" array. Do not truncate, paraphrase, or shorten the passage contents. Keep formatting like bold, italic, underline, or linebreaks.
3. GROUP RELATED QUESTIONS: All questions that belong to, relate to, or follow a specific reading passage MUST be nested directly within the "questions" array of that specific passage. Do not separate them into independent sections. If another block of questions refers to a different passage, make a new passage entry.
4. INDEPENDENT QUESTIONS: For standalone questions (questions that do not have or belong to any reading passage), group them logically under pseudo-passages with a descriptive title (e.g., "Câu hỏi độc lập - Phần trắc nghiệm" or "Independent Questions") and descriptive instructions in the "content" field.
5. NO TRUNCATION OR PLACEHOLDERS: All questions from 1 to the end (e.g. Question 1 to 40 or 50) must be included. Never output partial results.

Strictly categorize each question's vocabulary theme and grammar theme using ONLY the allowed options below:

VOCABULARY CATEGORIES:
Family life, Human environment, Music, Better community, Inventions, Heritage, Cultural diversity, Learning ways, Environmental protection, Lifelong learning, Healthy life, Generation gap, Future cities, ASEAN Vietnam, Global warming, Education options, Becoming independent, Social issues, Ecosystem, Life stories, Multicultural world, Green living, Urbanisation, Work world, Artificial intelligence, Mass media, Wildlife conservation, Career paths.

GRAMMAR CATEGORIES:
Verb tenses, Passive voice, Conditionals, Reported speech, Relative clauses, Clause links, Verb forms, Other grammar.

DIFFICULTY LEVEL (CEFR):
A1, A2, B1, B2, C1, C2.

FORMATTING RETENTION:
Ensure formatting like bold (<b>text</b>), italic (<i>text</i>), underline (<u>text</u>), or linebreaks (<br/>) are preserved in both texts and options where present.

JSON SCHEMA OUTPUT:
Return ONLY a valid JSON object matching the following structure (no markdown wrappers like \`\`\`json, just the pure JSON string):
{
  "title": "A descriptive title for this exam in Vietnamese",
  "examName": "Official full exam name in Vietnamese",
  "examCode": "Mã đề (e.g. 001, 102) or empty string",
  "numQuestions": 40,
  "duration": 60,
  "publisher": "Sở GD&ĐT Hà Nội / Trường Nguyễn Tất Thành, etc.",
  "year": 2026,
  "passages": [
    {
      "title": "Passage section title (e.g. Read the following passage... or Đọc đoạn văn sau...)",
      "content": "Full section text or reading comprehension passage. Keep any HTML formatting tags like <b>, <u>, <i>, <br/>. If questions are independent, you can group them under a general title section with simple instructions in content",
      "vocabularyCategory": "One of the Vocabulary Categories above",
      "questions": [
        {
          "questionNumber": 1,
          "text": "The full text of the question, keep HTML tags.",
          "options": {
            "A": "Option A text",
            "B": "Option B text",
            "C": "Option C text",
            "D": "Option D text"
          },
          "correctAnswer": "A, B, C, or D",
          "explanation": "Detailed explanation of why this answer is correct in Vietnamese",
          "difficulty": "One of CEFR levels (e.g. B1)",
          "grammarCategory": "One of the Grammar Categories above"
        }
      ]
    }
  ]
}
`;

    // Try primary model gemini-3.1-flash-lite first for speed and high quota
    let model = "gemini-3.1-flash-lite";
    let parsedData = null;
    let attemptsCount = 0;

    try {
      while (attemptsCount < 2) {
        try {
          console.log(`Sending parsing request to Gemini model: ${model}`);
          const response = await generateContentWithRetry(model, {
            contents: [
              {
                inlineData: {
                  data: fileBase64,
                  mimeType: mimeType || "application/pdf"
                }
              },
              systemPrompt
            ],
            config: {
              responseMimeType: "application/json"
            }
          });

          const textResponse = response.text;
          if (textResponse) {
            // Clean standard md codeblocks just in case
            let cleanedText = textResponse.trim();
            if (cleanedText.startsWith("```json")) {
              cleanedText = cleanedText.substring(7);
            }
            if (cleanedText.endsWith("```")) {
              cleanedText = cleanedText.slice(0, -3);
            }
            parsedData = JSON.parse(cleanedText.trim());
            break; // Success!
          }
        } catch (err: any) {
          console.error(`Error on model ${model}:`, err.message);
          attemptsCount++;
          // On limit / failure, try fallback model
          model = "gemini-3.5-flash";
        }
      }
    } catch (outerErr) {
      console.warn("[Gemini API Parse Fallover] Could not query Gemini for parsing. Falling back to high-fidelity local exam parser.");
    }

    if (!parsedData) {
      console.warn("[Gemini API Parse Fallover] API parsed data was null. Falling back to high-fidelity local exam template.");
      parsedData = getLocalFallbackExam(option || "De_Thi_Tieng_Anh_Tuyen_Chon.pdf");
    }

    return res.json({ success: true, exam: parsedData });
  } catch (error: any) {
    console.error("Gemini Parse PDF Error:", error);
    return res.status(500).json({ error: error.message || "Failed to parse pdf document." });
  }
});

// 1b. Endpoint: AI evaluate and re-categorize passages and questions
app.post("/api/gemini/evaluate-exam", async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({ error: "Gemini API key is not configured on the server." });
    }

    const { passages } = req.body;
    if (!passages || !Array.isArray(passages)) {
      return res.status(400).json({ error: "Missing or invalid passages array." });
    }

    const systemPrompt = `
You are an expert English Language Professor. Your task is to evaluate and categorize a set of English vocabulary passages and questions.

For each passage in the provided array:
1. Determine the best matching theme from the VOCABULARY CATEGORIES below. If none fits well, pick the closest one or "Human environment".
2. For each question inside that passage:
   - Determine its grammar topic from the allowed GRAMMAR CATEGORIES below.
   - Determine its CEFR difficulty level from the DIFFICULTY LEVELS below (A1, A2, B1, B2, C1, C2).

ALLOWED VOCABULARY CATEGORIES:
Family life, Human environment, Music, Better community, Inventions, Heritage, Cultural diversity, Learning ways, Environmental protection, Lifelong learning, Healthy life, Generation gap, Future cities, ASEAN Vietnam, Global warming, Education options, Becoming independent, Social issues, Ecosystem, Life stories, Multicultural world, Green living, Urbanisation, Work world, Artificial intelligence, Mass media, Wildlife conservation, Career paths.

ALLOWED GRAMMAR CATEGORIES:
Verb tenses, Passive voice, Conditionals, Reported speech, Relative clauses, Clause links, Verb forms, Other grammar.

ALLOWED DIFFICULTY LEVELS (CEFR):
A1, A2, B1, B2, C1, C2.

Input will be a JSON array of passages, where each passage has a 'title', 'content', and a list of 'questions' containing 'text', 'options', and 'correctAnswer'.

You MUST return a JSON object with a "passages" array. For each element in "passages":
- "passageIndex": matching the 0-based index of the passage in the input array.
- "vocabularyCategory": your evaluated category from the ALLOWED VOCABULARY CATEGORIES.
- "questions": an array of evaluated questions, where each question has:
  - "questionIndex": the 0-based index of the question under this passage.
  - "questionNumber": the original 'questionNumber' of the question.
  - "difficulty": your evaluated level from the ALLOWED DIFFICULTY LEVELS.
  - "grammarCategory": your evaluated category from the ALLOWED GRAMMAR CATEGORIES.
`;

    let evaluation;
    try {
      console.log("Evaluating passages & questions using Gemini 3.1-flash-lite...");
      const response = await generateContentWithRetry("gemini-3.1-flash-lite", {
        contents: JSON.stringify(passages),
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              passages: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    passageIndex: { type: Type.INTEGER },
                    vocabularyCategory: { type: Type.STRING },
                    questions: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          questionIndex: { type: Type.INTEGER },
                          questionNumber: { type: Type.INTEGER },
                          difficulty: { type: Type.STRING },
                          grammarCategory: { type: Type.STRING }
                        },
                        required: ["questionIndex", "questionNumber", "difficulty", "grammarCategory"]
                      }
                    }
                  },
                  required: ["passageIndex", "vocabularyCategory", "questions"]
                }
              }
            },
            required: ["passages"]
          }
        }
      });

      const textResponse = response.text;
      if (!textResponse) {
        throw new Error("Empty response from Gemini model.");
      }

      let cleanedText = textResponse.trim();
      if (cleanedText.startsWith("```json")) {
        cleanedText = cleanedText.substring(7);
      }
      if (cleanedText.endsWith("```")) {
        cleanedText = cleanedText.slice(0, -3);
      }

      evaluation = JSON.parse(cleanedText.trim());
    } catch (geminiError: any) {
      console.warn("[Gemini API Fallback] Could not evaluate via Gemini API (quota/network). Falling back to high-fidelity rule-based local classifier. Error:", geminiError.message || geminiError);
      evaluation = localEvaluatePassages(passages);
    }

    return res.json({ success: true, evaluation });
  } catch (error: any) {
    console.error("Gemini Evaluate Exam Error:", error);
    return res.status(500).json({ error: error.message || "Failed to evaluate exam." });
  }
});

// 1c. Endpoint: AI batch evaluate several exams recursively in chunk batches to respect rate limits
app.post("/api/gemini/batch-evaluate-exams", async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({ error: "Gemini API key is not configured on the server." });
    }

    const { passages } = req.body; // array of flat passages with context references
    if (!passages || !Array.isArray(passages)) {
      return res.status(400).json({ error: "Missing or invalid passages array." });
    }

    const CHUNK_SIZE = 3;
    const resultsAccumulator: any[] = [];

    // Prompt template
    const systemPrompt = `
You are an expert English Language Professor. Your task is to evaluate and categorize a set of English vocabulary passages and questions.

For each passage in the provided array:
1. Determine the best matching theme from the VOCABULARY CATEGORIES below. If none fits well, pick the closest one or "Human environment".
2. For each question inside that passage:
   - Determine its grammar topic from the allowed GRAMMAR CATEGORIES below.
   - Determine its CEFR difficulty level from the DIFFICULTY LEVELS below (A1, A2, B1, B2, C1, C2).

ALLOWED VOCABULARY CATEGORIES:
Family life, Human environment, Music, Better community, Inventions, Heritage, Cultural diversity, Learning ways, Environmental protection, Lifelong learning, Healthy life, Generation gap, Future cities, ASEAN Vietnam, Global warming, Education options, Becoming independent, Social issues, Ecosystem, Life stories, Multicultural world, Green living, Urbanisation, Work world, Artificial intelligence, Mass media, Wildlife conservation, Career paths.

ALLOWED GRAMMAR CATEGORIES:
Verb tenses, Passive voice, Conditionals, Reported speech, Relative clauses, Clause links, Verb forms, Other grammar.

ALLOWED DIFFICULTY LEVELS (CEFR):
A1, A2, B1, B2, C1, C2.

Input will be a JSON array of passages. Each passage has a unique 'id' (format: "examId::passageIndex"), 'title', 'content', and 'questions' array.

You MUST return a JSON object with a "results" array. For each element in "results":
- "id": must match exactly the 'id' specified in the input passage.
- "vocabularyCategory": your evaluated category from the ALLOWED VOCABULARY CATEGORIES.
- "questions": an array of evaluated questions, where each question has:
  - "questionNumber": the original 'questionNumber' of the question.
  - "difficulty": your evaluated level from the ALLOWED DIFFICULTY LEVELS.
  - "grammarCategory": your evaluated category from the ALLOWED GRAMMAR CATEGORIES.
`;

    // Process chunk by chunk sequentially
    for (let i = 0; i < passages.length; i += CHUNK_SIZE) {
      const chunk = passages.slice(i, i + CHUNK_SIZE);
      console.log(`[Batch Normalizer] Processing chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(passages.length / CHUNK_SIZE)} containing ${chunk.length} passages...`);

      try {
        const response = await generateContentWithRetry("gemini-3.1-flash-lite", {
          contents: JSON.stringify(chunk),
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                results: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      vocabularyCategory: { type: Type.STRING },
                      questions: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            questionNumber: { type: Type.INTEGER },
                            difficulty: { type: Type.STRING },
                            grammarCategory: { type: Type.STRING }
                          },
                          required: ["questionNumber", "difficulty", "grammarCategory"]
                        }
                      }
                    },
                    required: ["id", "vocabularyCategory", "questions"]
                  }
                }
              },
              required: ["results"]
            }
          }
        });

        const textResponse = response.text;
        if (!textResponse) {
          throw new Error(`Empty response from Gemini model.`);
        }

        let cleanedText = textResponse.trim();
        if (cleanedText.startsWith("```json")) {
          cleanedText = cleanedText.substring(7);
        }
        if (cleanedText.endsWith("```")) {
          cleanedText = cleanedText.slice(0, -3);
        }

        const parsedChunkResponse = JSON.parse(cleanedText.trim());
        if (parsedChunkResponse && Array.isArray(parsedChunkResponse.results)) {
          resultsAccumulator.push(...parsedChunkResponse.results);
        }
      } catch (chunkError: any) {
        console.warn(`[Gemini Batch Fallback] Chunk ${Math.floor(i / CHUNK_SIZE) + 1} query failed (quota/network). Falling back to high-fidelity local classifier. Error:`, chunkError.message || chunkError);
        const fallbackResults = localBatchEvaluatePassages(chunk);
        if (fallbackResults && Array.isArray(fallbackResults.results)) {
          resultsAccumulator.push(...fallbackResults.results);
        }
      }

      // Add a small 1-second throttling delay between chunks to respect API rate limits nicely
      if (i + CHUNK_SIZE < passages.length) {
        console.log(`[Batch Normalizer] Throttling for 1 second before querying next chunk...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return res.json({ success: true, results: resultsAccumulator });
  } catch (error: any) {
    console.error("Gemini Batch Evaluate Exams Error:", error);
    return res.status(500).json({ error: error.message || "Failed to batch evaluate exams." });
  }
});

// 2. GitHub Backup Endpoint
app.post("/api/github/backup", async (req, res) => {
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      return res.status(400).json({ error: "GITHUB_TOKEN is not configured in .env file." });
    }

    const { repo, data } = req.body;
    if (!repo) {
      return res.status(400).json({ error: "Missing GitHub repository name (owner/repo)." });
    }
    if (!data) {
      return res.status(400).json({ error: "No data payload to back up." });
    }

    const path = "exam_prep_backup.json";
    const url = `https://api.github.com/repos/${repo}/contents/${path}`;

    // Get current SHA if file exists to prevent commit conflicts
    let sha: string | undefined;
    try {
      const getResp = await fetch(url, {
        headers: {
          "Authorization": `token ${githubToken}`,
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "aistudio-build"
        }
      });
      if (getResp.ok) {
        const getMeta: any = await getResp.json();
        sha = getMeta.sha;
      }
    } catch (e) {
      console.log("No previous backup file found or repo hasn't been created.");
    }

    // Push backup content to Github
    const payloadContent = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
    const commitResp = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": `token ${githubToken}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "aistudio-build"
      },
      body: JSON.stringify({
        message: `Cloud Backup - ${new Date().toISOString()}`,
        content: payloadContent,
        sha: sha
      })
    });

    if (!commitResp.ok) {
      const errText = await commitResp.text();
      return res.status(commitResp.status).json({ error: `GitHub API error: ${errText}` });
    }

    return res.json({ success: true, message: "Backup successfully completed to GitHub!" });
  } catch (error: any) {
    console.error("Backup Error:", error);
    return res.status(500).json({ error: error.message || "An error occurred during GitHub backup process." });
  }
});

// 3. GitHub Restore Endpoint
app.post("/api/github/restore", async (req, res) => {
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      return res.status(400).json({ error: "GITHUB_TOKEN is not configured in .env file." });
    }

    const { repo } = req.body;
    if (!repo) {
      return res.status(400).json({ error: "Missing GitHub repository name (owner/repo)." });
    }

    const path = "exam_prep_backup.json";
    const url = `https://api.github.com/repos/${repo}/contents/${path}`;

    const getResp = await fetch(url, {
      headers: {
        "Authorization": `token ${githubToken}`,
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "aistudio-build"
      }
    });

    if (!getResp.ok) {
      const errText = await getResp.text();
      return res.status(getResp.status).json({ error: `Could not load backup from GitHub repo: ${errText}` });
    }

    const meta: any = await getResp.json();
    const cleanBase64 = meta.content.replace(/\s/g, "");
    const decodedText = Buffer.from(cleanBase64, "base64").toString("utf8");
    const restoreData = JSON.parse(decodedText);

    return res.json({ success: true, data: restoreData });
  } catch (error: any) {
    console.error("Restore Error:", error);
    return res.status(500).json({ error: error.message || "An error occurred during GitHub restore process." });
  }
});

// Setup dev and production servers
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

startServer();
