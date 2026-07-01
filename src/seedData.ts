import { User, Exam } from './types';

export const SEED_USERS: User[] = [
  {
    id: "binhlc",
    username: "binhlc",
    name: "Lê Công Bình",
    password: "070781",
    email: "binhlc@gmail.com",
    phone: "0917306820",
    grade: "admin",
    role: "admin",
    expiresAt: "2026-12-31T23:59:59Z",
    createdAt: new Date().toISOString()
  },
  {
    id: "leanhthu2014",
    username: "leanhthu2014",
    name: "Lê Anh Thư",
    password: "031214",
    email: "leanhthu2014@outlook.com",
    phone: "0846031214",
    grade: "10",
    role: "student",
    expiresAt: "2026-12-31T23:59:59Z",
    createdAt: new Date().toISOString()
  },
  {
    id: "phuclch",
    username: "phuclch",
    name: "Lê Công Hoàng Phúc",
    password: "071216",
    email: "phuclch@outlook.com",
    phone: "0843071216",
    grade: "6",
    role: "student",
    expiresAt: "2026-12-31T23:59:59Z",
    createdAt: new Date().toISOString()
  },
  {
    id: "quynhanhle2602",
    username: "quynhanhle2602",
    name: "Lê Quỳnh Anh",
    password: "260210",
    email: "quynhanhle2602@gmail.com",
    phone: "0855260210",
    grade: "12",
    role: "student",
    expiresAt: "2026-12-31T23:59:59Z",
    createdAt: new Date().toISOString()
  }
];

export const SEED_EXAMS: Exam[] = [
  {
    id: "exam_l6_ntt_2025",
    title: "Đề thi tham khảo đánh giá năng lực tuyển sinh lớp 6 trường THCS & THPT Nguyễn Tất Thành năm học 2025 - 2026 - Môn: Tiếng Anh",
    examName: "Đề thi tham khảo đánh giá năng lực tuyển sinh lớp 6 trường THCS & THPT Nguyễn Tất Thành năm học 2025 - 2026 - Môn: Tiếng Anh",
    examCode: "NTT-2025-2026",
    grade: 6,
    numQuestions: 26,
    duration: 30,
    publisher: "Trường THCS & THPT Nguyễn Tất Thành",
    year: 2025,
    createdAt: "2026-05-31T06:02:15.797Z",
    passages: [
      {
        title: "Part 1: Multiple Choice Questions",
        content: "<b>Circle the letter A, B, C, or D to best complete the following sentences.</b>",
        vocabularyCategory: "Learning ways",
        questions: [
          {
            questionNumber: 1,
            text: "I bought two pairs of socks yesterday, and now I can’t find _____.",
            options: { "A": "they", "B": "their", "C": "theirs", "D": "them" },
            correctAnswer: "D",
            explanation: "Ta dùng đại từ nhân xưng làm tân ngữ 'them' để thay thế cho danh từ số nhiều đã đề cập trước đó là 'two pairs of socks'.",
            difficulty: "A2",
            grammarCategory: "Other grammar"
          },
          {
            questionNumber: 2,
            text: "Fish have _____ to help them breathe underwater.",
            options: { "A": "gills", "B": "tails", "C": "beaks", "D": "wings" },
            correctAnswer: "A",
            explanation: "'gills' nghĩa là mang cá, cơ quan giúp cá hô hấp dưới nước.",
            difficulty: "A2",
            grammarCategory: "Other grammar"
          },
          {
            questionNumber: 3,
            text: "I usually play chess after school, but today, I _____ my grandmother.",
            options: { "A": "visit", "B": "am visiting", "C": "visited", "D": "will visit" },
            correctAnswer: "B",
            explanation: "Sử dụng thì Hiện tại tiếp diễn 'am visiting' để diễn tả một hành động tạm thời xảy ra khác với thói quen hằng ngày.",
            difficulty: "B1",
            grammarCategory: "Verb tenses"
          },
          {
            questionNumber: 4,
            text: "Let me _____ if you need any help with your project.",
            options: { "A": "to know", "B": "known", "C": "knowing", "D": "know" },
            correctAnswer: "D",
            explanation: "Cấu trúc 'Let + O + V (bare-infinitive)' (Để ai đó làm gì).",
            difficulty: "A2",
            grammarCategory: "Verb forms"
          },
          {
            questionNumber: 5,
            text: "My parents are always _____ when I get good results in English tests.",
            options: { "C": "bored", "B": "excited", "A": "angry", "D": "grateful" },
            correctAnswer: "B",
            explanation: "Tính từ 'excited' (hào hứng, phấn khởi) phù hợp nhất với ngữ cảnh khi con cái đạt điểm cao.",
            difficulty: "A2",
            grammarCategory: "Other grammar"
          }
        ]
      },
      {
        title: "Part 2: Everyday Conversations",
        content: "<b>Circle the correct letter A, B, C, or D to complete the following conversations between two students.</b>",
        vocabularyCategory: "Learning ways",
        questions: [
          {
            questionNumber: 12,
            text: "Ann and Tom are talking about a new friend, Lily.<br/><b>Ann:</b> There’s a new pupil in our class. Her name’s Lily.<br/><b>Tom:</b> What’s she like?",
            options: { "A": "She loves flowers.", "B": "She’s friendly.", "C": "She’s tall.", "D": "She likes playing basketball." },
            correctAnswer: "B",
            explanation: "Câu hỏi 'What is she like?' dùng để hỏi về tính cách, tính chất của một người.",
            difficulty: "A2",
            grammarCategory: "Other grammar"
          }
        ]
      },
      {
        title: "Part 4: Reading Comprehension",
        content: "<b>Read the text below and circle the letter A, B, C, or D to indicate the correct answer to each question.</b><br/><br/>There are many ways we can help protect the environment. First, we should try to recycle things. This means using old materials to make something new...",
        vocabularyCategory: "Environmental protection",
        questions: [
          {
            questionNumber: 16,
            text: "What is the main idea of the passage?",
            options: {
              "A": "We can help to protect the environment in many ways.",
              "B": "Recycling is a way to protect the planet.",
              "C": "Saving energy is the most important action.",
              "D": "Planting trees makes a big difference to our planet."
            },
            correctAnswer: "A",
            explanation: "Đoạn văn liệt kê nhiều giải pháp khác nhau để bảo vệ môi trường.",
            difficulty: "B1",
            grammarCategory: "Other grammar"
          }
        ]
      }
    ]
  },
  {
    id: "exam_l10_hanoi_2025",
    title: "Kỳ thi tuyển sinh vào lớp 10 THPT năm học 2025-2026 - Môn thi: Tiếng Anh",
    examName: "Kỳ thi tuyển sinh vào lớp 10 THPT năm học 2025-2026 - Môn thi: Tiếng Anh",
    examCode: "011",
    grade: 10,
    numQuestions: 40,
    duration: 60,
    publisher: "Sở Giáo dục và Đào tạo Hà Nội",
    year: 2025,
    createdAt: "2026-05-31T05:10:27.392Z",
    passages: [
      {
        title: "Phonetics, Vocabulary and Grammar",
        content: "<b>Mark the letter A, B, C, or D on your answer sheet to indicate the correct answer.</b>",
        vocabularyCategory: "Cultural diversity",
        questions: [
          {
            questionNumber: 1,
            text: "Which word has the underlined part pronounced differently from the others?<br/><b>A.</b> belov<u>ed</u> <b>B.</b> develop<u>ed</u> <b>C.</b> touch<u>ed</u> <b>D.</b> focus<u>ed</u>",
            options: { "A": "beloved", "B": "developed", "C": "touched", "D": "focused" },
            correctAnswer: "A",
            explanation: "Từ 'beloved' được phát âm đuôi '-ed' là /ɪd/, trong khi các từ còn lại được phát âm là /t/.",
            difficulty: "B1",
            grammarCategory: "Other grammar"
          },
          {
            questionNumber: 3,
            text: "Two of _______ festivals in Viet Nam are the Ban Flower Festival and the Spring Festival.",
            options: { "A": "as famous as", "B": "the most famous", "C": "much famous", "D": "more famous" },
            correctAnswer: "B",
            explanation: "Cấu trúc 'one of / two of + the most + tính từ dài + danh từ số nhiều' chỉ hai trong số những lễ hội nổi tiếng nhất.",
            difficulty: "A2",
            grammarCategory: "Other grammar"
          },
          {
            questionNumber: 10,
            text: "If the cost of public transportation _______, more people _______ it regularly.",
            options: { "A": "will decrease - uses", "B": "decrease - can’t use", "C": "may decrease - won’t use", "D": "decreases - will use" },
            correctAnswer: "D",
            explanation: "Câu điều kiện loại 1: 'If + S + V(s/es), S + will + V-inf'.",
            difficulty: "B1",
            grammarCategory: "Conditionals"
          }
        ]
      }
    ]
  },
  {
    id: "exam_l12_thpt_2025",
    title: "Đề thi thử tốt nghiệp THPT môn Tiếng Anh Sở Hà Nội 2026 - HN-2026-01",
    examName: "Đề thi thử tốt nghiệp THPT môn Tiếng Anh Sở Hà Nội 2026",
    examCode: "HN-2026-01",
    grade: 12,
    numQuestions: 40,
    duration: 60,
    publisher: "Sở GD&ĐT Hà Nội",
    year: 2026,
    createdAt: "2025-05-31T00:00:00.000Z",
    passages: [
      {
        title: "Sentence Arrangement (1-5)",
        content: "<b>Sắp xếp các câu để tạo thành đoạn văn hoặc đoạn hội thoại hoàn chỉnh.</b>",
        vocabularyCategory: "Writing",
        questions: [
          {
            questionNumber: 1,
            text: "Dear Customer Service Team, a. After bringing it home and installing it correctly, I found that it did not work properly. b. Please advise me on how to return the faulty item. I look forward to your prompt response. c. Whenever the power is on, the drum does not spin, and the machine makes a strange noise. d. I am writing to complain about a washing machine I purchased from your store on 22 February 2026. e. As this is a brand-new product and still under warranty, I would like to request a replacement or a full refund. Yours faithfully, Laura Brown",
            options: { "A": "c – a – d – b – e", "B": "d – a – c – e – b", "C": "a – e – d – c – b", "D": "e – d – b – c – a" },
            correctAnswer: "B",
            explanation: "Thứ tự hợp lý: d (giới thiệu lý do viết thư) → a (sau khi mua và cài đặt) → c (mô tả vấn đề) → e (yêu cầu thay thế/hoàn tiền) → b (đề nghị hướng dẫn trả hàng).",
            difficulty: "B1",
            grammarCategory: "Other grammar"
          }
        ]
      },
      {
        title: "Grammar and Vocabulary",
        content: "<b>Chọn đáp án đúng để hoàn thành câu hoặc đoạn văn.</b>",
        vocabularyCategory: "Grammar",
        questions: [
          {
            questionNumber: 26,
            text: "When you see that something isn’t right, you should consider ___ immediate action to correct it.",
            options: { "A": "Making", "B": "Taking", "C": "Doing", "D": "Getting" },
            correctAnswer: "B",
            explanation: "Cụm từ cố định: 'take action' (hành động).",
            difficulty: "B1",
            grammarCategory: "Other grammar"
          },
          {
            questionNumber: 27,
            text: "With ___ time and effort, you can master any skill.",
            options: { "A": "a little", "B": "few", "C": "a few", "D": "little" },
            correctAnswer: "A",
            explanation: "'Time' là danh từ không đếm được, 'a little' mang nghĩa tích cực 'một ít'.",
            difficulty: "B1",
            grammarCategory: "Other grammar"
          }
        ]
      }
    ]
  }
];
