import React, { Suspense, lazy, useEffect, useState } from 'react';
import { collection, getDocs, doc, setDoc, updateDoc, query, where } from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { db, auth } from './firebase';
import { User, Exam, Attempt } from './types';
import { SEED_USERS, SEED_EXAMS } from './seedData';

// Subviews are code-split so a student/guest never downloads the heavy
// admin/vocabulary bundles (ExamManager, VocabularyView + motion, etc.) unless
// they actually open those tabs.
const DashboardView = lazy(() => import('./components/DashboardView'));
const PracticeView = lazy(() => import('./components/PracticeView'));
const CustomTrainingView = lazy(() => import('./components/CustomTrainingView'));
const ExamManagerView = lazy(() => import('./components/ExamManagerView'));
const CategoryManagerView = lazy(() => import('./components/CategoryManagerView'));
const UserAdminView = lazy(() => import('./components/UserAdminView'));
const ImportExamView = lazy(() => import('./components/ImportExamView'));
const VocabularyNormalizerView = lazy(() => import('./components/VocabularyNormalizerView'));
const VocabularyView = lazy(() => import('./components/VocabularyView'));
import Modal from './components/Modal';

// Icons
import {
  BookOpen,
  LayoutDashboard,
  Users,
  Settings,
  ShieldCheck,
  LogOut,
  FolderSync,
  Menu,
  X,
  Lock,
  UserPlus,
  Github,
  Calendar,
  AlertTriangle,
  ArrowRight,
  Compass,
  RefreshCw,
  Library,
  Sun,
  Moon
} from 'lucide-react';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'practice' | 'custom_training' | 'vocabulary' | 'exam_manager' | 'category_manager' | 'user_admin' | 'import_manager' | 'vocabulary_normalizer'>('dashboard');
  const [currentGrade, setCurrentGrade] = useState<string>('all'); // 'all' | '6' | '10' | '12'
  const [menuOpen, setMenuOpen] = useState(false);
  const [initializing, setInitializing] = useState(true);

  // Authentication Fields
  const [isRegistering, setIsRegistering] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [fullnameInput, setFullnameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [gradeInput, setGradeInput] = useState('6');

  // Google ID Sign-In Fields
  const [googleUserToRegister, setGoogleUserToRegister] = useState<{
    uid: string;
    email: string;
    name: string;
  } | null>(null);
  const [googleGradeSelection, setGoogleGradeSelection] = useState<string>('6');

  // Multi-Exam Retake Shortcuts
  const [preSelectedExamId, setPreSelectedExamId] = useState<string | null>(null);
  const [preSelectedAnswers, setPreSelectedAnswers] = useState<{ [key: string]: string } | null>(null);
  const [preSelectedVocab, setPreSelectedVocab] = useState<string | null>(null);
  const [preSelectedGrammar, setPreSelectedGrammar] = useState<string | null>(null);

  // Custom alert dialog configurations
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    type: 'info' | 'success' | 'warning' | 'danger' | 'confirm';
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  }>({
    isOpen: false,
    type: 'info',
    title: '',
    message: '',
  });

  // Github configurations
  const [githubRepoInput, setGithubRepoInput] = useState('funghostvn/3BEnglish');
  const [backupSyncing, setBackupSyncing] = useState(false);

  // Theme configuration for class-based Dark Mode
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    bootstrapAndCheckSession();
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('theme', theme);
    } catch { /* ignore */ }
  }, [theme]);

  // Sync activeTab and currentGrade from URL search params on load (once initializing is done)
  useEffect(() => {
    if (initializing) return;

    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    const gradeParam = params.get('grade');

    const validTabs = ['dashboard', 'practice', 'custom_training', 'vocabulary', 'exam_manager', 'category_manager', 'user_admin', 'import_manager', 'vocabulary_normalizer'];
    if (tabParam && validTabs.includes(tabParam)) {
      setActiveTab(tabParam as any);
    }

    const validGrades = ['all', '6', '10', '12'];
    if (gradeParam && validGrades.includes(gradeParam)) {
      if (currentUser && currentUser.role === 'student') {
        if (currentUser.grade === gradeParam) {
          setCurrentGrade(gradeParam);
        }
      } else {
        setCurrentGrade(gradeParam);
      }
    }
  }, [initializing]);

  // Sync activeTab and currentGrade back to URL query parameters when they change
  useEffect(() => {
    if (initializing) return;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', activeTab);
    url.searchParams.set('grade', currentGrade);
    window.history.replaceState(null, '', url.pathname + url.search);
  }, [activeTab, currentGrade, initializing]);

  const showCustomModal = (config: {
    type: 'info' | 'success' | 'warning' | 'danger' | 'confirm';
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  }) => {
    setModalConfig({
      ...config,
      isOpen: true,
    });
  };

  const closeCustomModal = () => {
    setModalConfig(prev => ({ ...prev, isOpen: false }));
  };

  // Auto seeding if DB is blank
  const bootstrapAndCheckSession = async () => {
    setInitializing(true);
    try {
      // 1. check and seed users
      const userColRef = collection(db, 'users');
      const userSnap = await getDocs(userColRef);
      if (userSnap.empty) {
        console.log("Database user collection is empty. Seeding standard users...");
        for (const u of SEED_USERS) {
          await setDoc(doc(db, 'users', u.id), u);
        }
      }

      // 2. check and seed exams
      const examColRef = collection(db, 'exams');
      const examSnap = await getDocs(examColRef);
      if (examSnap.empty) {
        console.log("Database exam collection is empty. Seeding official Vietnamese exams...");
        for (const ex of SEED_EXAMS) {
          const seededExam = { ...ex, classification: "Đề thi thử từ các đơn vị" };
          await setDoc(doc(db, 'exams', ex.id), seededExam);
        }
      } else {
        // Migration: automatically update any existing exam that is missing a classification field to 'Đề thi thử từ các đơn vị'
        for (const docObj of examSnap.docs) {
          const examObj = docObj.data() as Exam;
          if (!examObj.classification) {
            console.log(`Migrating exam ${examObj.id} to have default classification...`);
            await updateDoc(doc(db, 'exams', docObj.id), {
              classification: "Đề thi thử từ các đơn vị"
            });
          }
        }
      }

      // Restore session if present
      const savedUser = localStorage.getItem('exam_prep_user_session');
      if (savedUser) {
        const parsed = JSON.parse(savedUser) as User;
        setCurrentUser(parsed);
        if (parsed.role === 'student' && parsed.grade) {
          setCurrentGrade(parsed.grade);
        } else {
          setCurrentGrade('all');
        }
      }
    } catch (err) {
      console.error("Initialization Failed:", err);
    } finally {
      setInitializing(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput.trim() || !passwordInput.trim()) return;

    try {
      const userCol = collection(db, 'users');
      const snap = await getDocs(userCol);
      const allUsers = snap.docs.map(doc => doc.data() as User);

      // Simple secure local credentials lookup comparison
      const found = allUsers.find(
        u => u.username.toLowerCase() === usernameInput.toLowerCase().trim() && u.password === passwordInput
      );

      if (found) {
        // Expiration logic assessment
        const isExpired = new Date().getTime() > new Date(found.expiresAt).getTime();
        
        setCurrentUser(found);
        localStorage.setItem('exam_prep_user_session', JSON.stringify(found));
        setUsernameInput('');
        setPasswordInput('');
        
        // Auto filter by grade
        if (found.role === 'student' && found.grade) {
          setCurrentGrade(found.grade);
        } else {
          setCurrentGrade('all');
        }

        showCustomModal({
          type: 'success',
          title: 'Đăng nhập thành công',
          message: `Chào mừng ${found.name} trở lại hệ thống luyện đề thi! ${
            isExpired ? '\nHết hạn sử dụng (Chuyển sang chế độ hạn chế 3 đề/ngày).' : ''
          }`
        });
      } else {
        showCustomModal({
          type: 'danger',
          title: 'Đăng nhập thất bại',
          message: 'Tài khoản truy cập hoặc mật khẩu không chính xác. Vui lòng rà soát lại!'
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput.trim() || !fullnameInput.trim() || !emailInput.trim() || !passwordInput.trim()) {
      showCustomModal({
        type: 'warning',
        title: 'Thiếu thông tin',
        message: 'Vui lòng hoàn thành tất cả các trường dữ liệu bắt buộc!'
      });
      return;
    }

    try {
      const userCol = collection(db, 'users');
      const snap = await getDocs(userCol);
      const allUsers = snap.docs.map(doc => doc.data() as User);

      const exists = allUsers.some(u => u.username.toLowerCase() === usernameInput.toLowerCase().trim());
      if (exists) {
        showCustomModal({
          type: 'danger',
          title: 'Trùng tên truy cập',
          message: 'Tên đăng nhập này đã có người sử dụng. Hãy chọn tên khác!'
        });
        return;
      }

      const generatedId = `ust_${Date.now()}`;
      // Set expiration to 31/12/2026 as default
      const defaultExpiry = "2026-12-31T23:59:59Z";

      const newUser: User = {
        id: generatedId,
        username: usernameInput.trim().toLowerCase(),
        name: fullnameInput.trim(),
        password: passwordInput,
        email: emailInput.trim(),
        phone: phoneInput.trim() || "Chưa cung cấp",
        grade: gradeInput,
        role: 'student',
        expiresAt: defaultExpiry,
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'users', generatedId), newUser);

      showCustomModal({
        type: 'success',
        title: 'Đăng ký thành công',
        message: `Tài khoản '${usernameInput}' đã được đăng ký! Bạn có thể nâng gói bằng cách liên hệ Giáo viên/Admin. Lúc này bạn đã có quyền đăng nhập.`
      });

      setIsRegistering(false);
      setUsernameInput('');
      setFullnameInput('');
      setEmailInput('');
      setPhoneInput('');
      setPasswordInput('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const { uid, email, displayName } = result.user;

      if (!email) {
        showCustomModal({
          type: 'danger',
          title: 'Đăng nhập Google thất bại',
          message: 'Tài khoản Google của bạn không cung cấp địa chỉ Email hợp lệ.'
        });
        return;
      }

      // Check if user already exists in DB
      const userColRef = collection(db, 'users');
      const snap = await getDocs(userColRef);
      const allUsers = snap.docs.map(doc => doc.data() as User);

      const found = allUsers.find(
        u => u.email && u.email.toLowerCase() === email.toLowerCase().trim()
      );

      if (found) {
        const isExpired = new Date().getTime() > new Date(found.expiresAt).getTime();
        setCurrentUser(found);
        localStorage.setItem('exam_prep_user_session', JSON.stringify(found));

        // Auto filter by grade
        if (found.role === 'student' && found.grade) {
          setCurrentGrade(found.grade);
        } else {
          setCurrentGrade('all');
        }

        showCustomModal({
          type: 'success',
          title: 'Đăng nhập Google thành công',
          message: `Chào mừng ${found.name} trở lại hệ thống! ${
            isExpired ? '\nHết hạn sử dụng (Chuyển sang chế độ hạn chế 3 đề/ngày).' : ''
          }`
        });
      } else {
        // If not found, show the screen to let them complete registration!
        setGoogleUserToRegister({
          uid,
          email,
          name: displayName || email.split('@')[0]
        });
      }
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('popup-closed-by-user')) {
        return;
      }
      showCustomModal({
        type: 'danger',
        title: 'Lỗi đăng nhập Google',
        message: err.message || 'Không thể liên kết tài khoản Google. Vui lòng kiểm tra lại kết nối mạng!'
      });
    }
  };

  const handleRegisterGoogleUser = async () => {
    if (!googleUserToRegister) return;
    try {
      const generatedId = `ust_google_${googleUserToRegister.uid}`;
      const defaultExpiry = "2026-12-31T23:59:59Z";

      const newUser: User = {
        id: generatedId,
        username: googleUserToRegister.email.split('@')[0].toLowerCase(),
        name: googleUserToRegister.name,
        email: googleUserToRegister.email,
        phone: "Chưa cung cấp",
        grade: googleGradeSelection,
        role: 'student',
        expiresAt: defaultExpiry,
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'users', generatedId), newUser);

      setCurrentUser(newUser);
      localStorage.setItem('exam_prep_user_session', JSON.stringify(newUser));
      setCurrentGrade(googleGradeSelection);
      setGoogleUserToRegister(null);

      showCustomModal({
        type: 'success',
        title: 'Đăng ký & Đăng nhập thành công',
        message: `Chào mừng ${newUser.name} gia nhập hệ thống luyện đề thi lớp ${googleGradeSelection}! Tài khoản của bạn đã được khởi tạo.`
      });
    } catch (err: any) {
      console.error(err);
      showCustomModal({
        type: 'danger',
        title: 'Không thể tạo tài khoản',
        message: err.message || 'Đã xảy ra lỗi khi tạo tài khoản của bạn trên cơ sở dữ liệu. Vui lòng quay lại sau!'
      });
    }
  };

  // Allow enter as a guest
  const enterAsGuest = () => {
    const guestUser: Partial<User> = {
      id: "guest",
      username: "guest",
      name: "Student Guest",
      role: "guest",
      grade: "all",
      expiresAt: "2026-12-31T23:59:59Z"
    };

    setCurrentUser(guestUser as User);
    setCurrentGrade('all');
    showCustomModal({
      type: 'info',
      title: 'Vào tự do (Guest)',
      message: 'Chào mừng bạn! Chế độ Guest giới hạn làm tối đa 1 đề thi / ngày. Bạn có thể đăng ký tài khoản để học tập tối ưu hơn.'
    });
  };

  // Applies a partial update (e.g. a diamond award) to the in-memory session
  // and its localStorage cache, mirroring every other setCurrentUser call in
  // this file — used by useExamSession after it writes diamonds to Firestore
  // so the header/Dashboard balance reflects it without a reload.
  const handleUserUpdate = (patch: Partial<User>) => {
    setCurrentUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...patch };
      localStorage.setItem('exam_prep_user_session', JSON.stringify(updated));
      return updated;
    });
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('exam_prep_user_session');
    setActiveTab('dashboard');
    setCurrentGrade('all');
    showCustomModal({
      type: 'success',
      title: 'Đã hoàn tất Đăng xuất',
      message: 'Hẹn gặp lại bạn trên hành trình chinh phục tiếng Anh nâng cao!'
    });
  };

  // Perform limits check before letting student practice
  const handleVerifyPracticeEntrance = async (examId: string, customAnswers?: any) => {
    if (!currentUser) {
      enterAsGuest();
      return;
    }

    try {
      // Check registered grade restriction for student role.
      // Fetch only the single exam by its id field instead of the whole
      // collection (also re-checked in useExamSession.startDirectExam).
      const examSnap = await getDocs(query(collection(db, 'exams'), where('id', '==', examId)));
      const foundExam = examSnap.docs.map(d => d.data() as Exam)[0];

      if (currentUser.role === 'student' && currentUser.grade && foundExam) {
        if (foundExam.grade !== parseInt(currentUser.grade, 10)) {
          showCustomModal({
            type: 'danger',
            title: 'Lớp học không phù hợp',
            message: `Tài khoản của bạn đăng ký học khối lớp ${currentUser.grade}. Bạn không được phép làm đề thi của khối lớp khác!`
          });
          return;
        }
      }

      // 1. Count only THIS user's attempts made today. Scoped server-side by
      // userId (single-field equality: no composite index needed — important
      // because the production Firestore is AI Studio-managed and we can't
      // declare new composite indexes on it), then date-filtered client-side.
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const mySnap = await getDocs(query(
        collection(db, 'attempts'),
        where('userId', '==', currentUser.id)
      ));
      const todayCount = mySnap.docs.filter(d => {
        const att = d.data() as Attempt;
        return new Date(att.createdAt).getTime() >= startOfToday.getTime();
      }).length;

      // Guest Limits: max 1 per day
      if (currentUser.role === 'guest') {
        if (todayCount >= 1) {
          showCustomModal({
            type: 'warning',
            title: 'Hết lượt làm đề hôm nay',
            message: 'Tài khoản Guest bị giới hạn làm tối đa 1 đề thi / ngày. Hãy đăng ký tài khoản miễn phí hoặc đăng nhập để làm không giới hạn!'
          });
          return;
        }
      }

      // Expired Student Limits: max 3 per day
      const isExpired = new Date().getTime() > new Date(currentUser.expiresAt).getTime();
      if (currentUser.role === 'student' && isExpired) {
        if (todayCount >= 3) {
          showCustomModal({
            type: 'danger',
            title: 'Tài khoản Đã hết hạn học',
            message: 'Gói học tập của bạn đã quá hạn (31/12/2026). Trực thuộc khung hết hạn, bạn chỉ xếp tối đa 3 đề thi / ngày. Hãy liên hệ Giáo viên/Admin để gia hạn thêm!'
          });
          return;
        }
      }

      // Access checks out! Trigger quiz taking mode
      setPreSelectedExamId(examId);
      if (customAnswers) {
        setPreSelectedAnswers(customAnswers);
      }
      setActiveTab('practice');
    } catch (err) {
      console.error(err);
    }
  };

  // 1-Button secure backups & restores using GITHUB_TOKEN
  const handleGithubBackup = async () => {
    if (!githubRepoInput.trim()) {
      showCustomModal({
        type: 'warning',
        title: 'Thiếu Repo GitHub',
        message: 'Vui lòng cung cấp thư mục lưu trữ rò rỉ dạng (owner/repo)!'
      });
      return;
    }

    setBackupSyncing(true);
    showCustomModal({
      type: 'info',
      title: 'Đang kết xuất sao lưu...',
      message: 'Hệ thống đang trích xuất tất cả lịch sử, đề thi và học viên từ Firestore để đồng bộ hóa...'
    });

    try {
      // Pull all Firestore documents across every collection the app uses —
      // srs_items/vocab_practice/vocabulary_library were historically missing
      // here, which meant a restore silently dropped SRS review progress and
      // normalized vocabulary data instead of actually backing up "everything".
      const usersSnap = await getDocs(collection(db, 'users'));
      const examsSnap = await getDocs(collection(db, 'exams'));
      const attemptsSnap = await getDocs(collection(db, 'attempts'));
      const extensionsSnap = await getDocs(collection(db, 'extensions'));
      const feedbacksSnap = await getDocs(collection(db, 'feedbacks'));
      const srsItemsSnap = await getDocs(collection(db, 'srs_items'));
      const vocabPracticeSnap = await getDocs(collection(db, 'vocab_practice'));
      const vocabularyLibrarySnap = await getDocs(collection(db, 'vocabulary_library'));

      const payload = {
        timestamp: new Date().toISOString(),
        users: usersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        exams: examsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        attempts: attemptsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        extensions: extensionsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        feedbacks: feedbacksSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        srs_items: srsItemsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        vocab_practice: vocabPracticeSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        vocabulary_library: vocabularyLibrarySnap.docs.map(d => ({ id: d.id, ...d.data() })),
      };

      const response = await fetch('/api/github/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: githubRepoInput.trim(),
          data: payload
        })
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || 'Thất bại khi gửi lên GitHub.');
      }

      const counts = [
        `${payload.users.length} người dùng`,
        `${payload.exams.length} đề thi`,
        `${payload.attempts.length} lượt làm bài`,
        `${payload.extensions.length} nhật ký gia hạn`,
        `${payload.feedbacks.length} phản hồi`,
        `${payload.srs_items.length} thẻ SRS`,
        `${payload.vocab_practice.length} bản luyện từ vựng`,
        `${payload.vocabulary_library.length} từ vựng chuẩn hóa`,
      ].join(', ');

      showCustomModal({
        type: 'success',
        title: 'Sao lưu GitHub hoàn tất 🎉',
        message: `Toàn bộ kho dữ liệu đã được nén và đẩy lên file 'exam_prep_backup.json' trong repo '${githubRepoInput.trim()}' thành công. Đã sao lưu: ${counts}.`
      });
    } catch (err: any) {
      console.error(err);
      showCustomModal({
        type: 'danger',
        title: 'Sao lưu thất bại',
        message: err.message || 'Lỗi xảy ra trong tiến trình gọi sao lưu bảo mật API. Hãy chắc chắn GITHUB_TOKEN khả dụng.'
      });
    } finally {
      setBackupSyncing(false);
    }
  };

  const handleGithubRestore = async () => {
    if (!githubRepoInput.trim()) return;

    onShowModalConfirmRestore();
  };

  const onShowModalConfirmRestore = () => {
    const triggerGithubRestore = async () => {
      setBackupSyncing(true);
      try {
        const response = await fetch('/api/github/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo: githubRepoInput.trim() })
        });

        const resData = await response.json();
        if (!response.ok) {
          throw new Error(resData.error || 'Failed to pull restore from GitHub.');
        }

        const data = resData.data;

        // Perform transactional write and override
        // 1. users override
        if (data.users && Array.isArray(data.users)) {
          for (const u of data.users) {
            await setDoc(doc(db, 'users', u.id), u);
          }
        }
        // 2. exams override
        if (data.exams && Array.isArray(data.exams)) {
          for (const ex of data.exams) {
            await setDoc(doc(db, 'exams', ex.id), ex);
          }
        }
        // 3. attempts override
        if (data.attempts && Array.isArray(data.attempts)) {
          for (const att of data.attempts) {
            await setDoc(doc(db, 'attempts', att.id), att);
          }
        }
        // 4. extensions override
        if (data.extensions && Array.isArray(data.extensions)) {
          for (const ext of data.extensions) {
            await setDoc(doc(db, 'extensions', ext.id), ext);
          }
        }
        // 5. feedbacks override
        if (data.feedbacks && Array.isArray(data.feedbacks)) {
          for (const fb of data.feedbacks) {
            await setDoc(doc(db, 'feedbacks', fb.id), fb);
          }
        }
        // 6. srs_items override
        if (data.srs_items && Array.isArray(data.srs_items)) {
          for (const item of data.srs_items) {
            await setDoc(doc(db, 'srs_items', item.id), item);
          }
        }
        // 7. vocab_practice override
        if (data.vocab_practice && Array.isArray(data.vocab_practice)) {
          for (const vp of data.vocab_practice) {
            await setDoc(doc(db, 'vocab_practice', vp.id), vp);
          }
        }
        // 8. vocabulary_library override
        if (data.vocabulary_library && Array.isArray(data.vocabulary_library)) {
          for (const vl of data.vocabulary_library) {
            await setDoc(doc(db, 'vocabulary_library', vl.id), vl);
          }
        }

        const restoredCounts = [
          ['users', 'người dùng'], ['exams', 'đề thi'], ['attempts', 'lượt làm bài'],
          ['extensions', 'nhật ký gia hạn'], ['feedbacks', 'phản hồi'], ['srs_items', 'thẻ SRS'],
          ['vocab_practice', 'bản luyện từ vựng'], ['vocabulary_library', 'từ vựng chuẩn hóa'],
        ].map(([key, label]) => `${Array.isArray(data[key]) ? data[key].length : 0} ${label}`).join(', ');

        showCustomModal({
          type: 'success',
          title: 'Khôi phục hoàn tất ✨',
          message: `Bản nén đã được đọc và đồng bộ hóa thành công trên Firestore Cloud của bạn. Đã khôi phục: ${restoredCounts}.`
        });
        bootstrapAndCheckSession(); // re-boot parameters
      } catch (err: any) {
        console.error(err);
        showCustomModal({
          type: 'danger',
          title: 'Khôi phục thất bại',
          message: err.message || 'Lỗi rà soát rò rỉ thông số khôi phục tệp trên GitHub.'
        });
      } finally {
        setBackupSyncing(false);
      }
    };

    showCustomModal({
      type: 'confirm',
      title: 'CẢNH BÁO khôi phục dữ liệu',
      message: 'Hành động này sẽ ghi đè và thay thế hoàn toàn dữ liệu đề thi, người dùng và lịch sử hiện có bằng bản nén trên GitHub. Bạn có chắc muốn khôi phục không?',
      onConfirm: triggerGithubRestore
    });
  };

  const renderActiveView = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <DashboardView
            currentGradeFilter={currentGrade}
            currentUser={currentUser}
            onRetakeExam={handleVerifyPracticeEntrance}
            onShowModal={showCustomModal}
            onUserUpdate={handleUserUpdate}
            onSelectWeakArea={(type, val) => {
              if (type === 'vocab') {
                setPreSelectedVocab(val);
                setPreSelectedGrammar('all');
              } else {
                setPreSelectedGrammar(val);
                setPreSelectedVocab('all');
              }
              setActiveTab('custom_training');
            }}
            onGoToSrsReview={() => setActiveTab('custom_training')}
          />
        );
      case 'practice':
        return (
          <PracticeView
            currentGradeFilter={currentGrade}
            currentUser={currentUser}
            preSelectedExamId={preSelectedExamId}
            preSelectedAnswers={preSelectedAnswers}
            onClearPreSelections={() => {
              setPreSelectedExamId(null);
              setPreSelectedAnswers(null);
            }}
            onShowModal={showCustomModal}
            onUserUpdate={handleUserUpdate}
          />
        );
      case 'custom_training':
        return (
          <CustomTrainingView
            currentGradeFilter={currentGrade}
            currentUser={currentUser}
            preSelectedVocab={preSelectedVocab}
            preSelectedGrammar={preSelectedGrammar}
            onClearPreSelections={() => {
              setPreSelectedVocab(null);
              setPreSelectedGrammar(null);
            }}
            onShowModal={showCustomModal}
            onUserUpdate={handleUserUpdate}
          />
        );
      case 'vocabulary':
        return (
          <VocabularyView
            currentUser={currentUser}
            onShowModal={showCustomModal}
          />
        );
      case 'exam_manager':
        return <ExamManagerView currentGradeFilter={currentGrade} onShowModal={showCustomModal} />;
      case 'import_manager':
        return <ImportExamView onShowModal={showCustomModal} />;
      case 'category_manager':
        return <CategoryManagerView onShowModal={showCustomModal} />;
      case 'vocabulary_normalizer':
        return <VocabularyNormalizerView onShowModal={showCustomModal} />;
      case 'user_admin':
        return <UserAdminView onShowModal={showCustomModal} />;
      default:
        return (
          <DashboardView
            currentGradeFilter={currentGrade}
            currentUser={currentUser}
            onRetakeExam={handleVerifyPracticeEntrance}
            onShowModal={showCustomModal}
            onGoToSrsReview={() => setActiveTab('custom_training')}
          />
        );
    }
  };

  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 antialiased font-sans relative overflow-hidden">
        {/* Animated background blobs */}
        <div className="absolute w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl -top-24 -left-24 anim-blob-drift" />
        <div className="absolute w-80 h-80 bg-violet-600/15 rounded-full blur-3xl bottom-0 right-0 anim-blob-drift2" />

        <div className="text-center space-y-6 relative z-10">
          {/* Logo */}
          <div className="mx-auto w-16 h-16 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-indigo-500/40 anim-scale-in">
            <BookOpen className="h-8 w-8 text-white" />
          </div>
          {/* Spinner */}
          <div className="relative mx-auto w-12 h-12">
            <div className="absolute inset-0 rounded-full border-2 border-indigo-500/20" />
            <div className="absolute inset-0 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
          </div>
          <div className="space-y-1.5">
            <p className="text-white font-bold text-sm tracking-wide">EnglishPro</p>
            <p className="text-indigo-300/70 text-xs font-medium">Khởi tạo hệ thống luyện đề 3 cấp độ...</p>
          </div>
        </div>
      </div>
    );
  }

  // Not Logged-In Portal
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-950 anim-gradient-shift flex items-center justify-center p-4 antialiased font-sans relative overflow-hidden">

        {/* Animated background blobs */}
        <div className="absolute w-[500px] h-[500px] bg-indigo-600/15 rounded-full blur-3xl -top-32 -left-32 anim-blob-drift pointer-events-none" />
        <div className="absolute w-[400px] h-[400px] bg-violet-700/12 rounded-full blur-3xl bottom-0 right-0 anim-blob-drift2 pointer-events-none" />
        <div className="absolute w-64 h-64 bg-blue-600/10 rounded-full blur-2xl top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 anim-blob-drift pointer-events-none" style={{ animationDelay: '4s' }} />

        {/* Floating decorative squares */}
        <div className="absolute top-20 left-20 w-2 h-2 bg-indigo-400/40 rounded-sm rotate-45 anim-blob-drift" style={{ animationDelay: '2s' }} />
        <div className="absolute top-40 right-32 w-1.5 h-1.5 bg-violet-400/30 rounded-sm rotate-12 anim-blob-drift2" style={{ animationDelay: '6s' }} />
        <div className="absolute bottom-32 left-40 w-2 h-2 bg-blue-400/25 rounded-sm -rotate-12 anim-blob-drift" style={{ animationDelay: '8s' }} />

        {/* Main glass card */}
        <div className="glass rounded-3xl max-w-lg w-full overflow-hidden flex flex-col md:flex-row h-auto md:h-[560px] shadow-2xl shadow-black/40 anim-scale-in border border-white/10">
          
          {/* Left design section — gradient branded panel */}
          <div className="md:w-5/12 bg-gradient-to-b from-indigo-700 via-indigo-800 to-slate-900 text-white p-8 flex flex-col justify-between relative overflow-hidden">
            {/* Subtle inner blobs */}
            <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/5 rounded-full blur-2xl" />
            <div className="absolute bottom-8 -left-4 w-24 h-24 bg-violet-400/10 rounded-full blur-2xl" />

            <div className="relative z-10">
              <div className="h-12 w-12 bg-white/15 backdrop-blur-sm border border-white/20 rounded-2xl flex items-center justify-center text-white mb-6 shadow-lg">
                <BookOpen className="h-6 w-6" />
              </div>
              <h2 className="text-2xl font-bold font-display tracking-tight leading-snug">Luyện đề thi<br /><span className="text-indigo-200">English</span> 📘</h2>
              <p className="text-indigo-200/70 text-xs mt-3 leading-relaxed">
                Kho dữ liệu đề thi tuyển sinh lớp 6 Cầu Giấy/Nguyễn Tất Thành, đề thi khảo sát lớp 10, tốt nghiệp THPT Quốc Gia.
              </p>

              {/* Feature pills */}
              <div className="mt-6 space-y-2">
                {['Đề thi chính thức các năm', 'Phân tích điểm yếu AI', 'Ôn tập SRS thông minh'].map((feat, i) => (
                  <div key={i} className={`flex items-center gap-2 text-[11px] text-indigo-100/80 font-semibold stagger-${i + 1} anim-fade-slide-in`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-300 shrink-0" />
                    {feat}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="text-[10px] text-indigo-300/50 pt-6 relative z-10 font-medium">
              © {new Date().getFullYear()} EnglishPro · Luyện thi 3 Cấp độ
            </div>
          </div>

          {/* Right form input section */}
          <div className="flex-1 p-7 overflow-y-auto flex flex-col justify-between bg-white/90 dark:bg-slate-900/90">
            {googleUserToRegister ? (
              /* GOOGLE ADDITIONAL INFORMATION FORM */
              <div className="space-y-5 my-auto anim-fade-slide-up">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-50 border border-indigo-100 rounded-full text-indigo-600 text-[10px] font-bold uppercase tracking-wider mb-3">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
                      <g transform="matrix(1, 0, 0, 1, 0, 0)">
                        <path d="M21.35,11.1H12v2.7h5.38c-0.24,1.28 -0.96,2.37 -2.04,3.1v2.57h3.3c1.93,-1.78 3.04,-4.4 3.04,-7.4C21.7,11.75 21.57,11.38 21.35,11.1z" fill="#4285F4" />
                        <path d="M12,20.6c2.43,0 4.47,-0.8 5.96,-2.2l-3.3,-2.57c-0.9,0.6 -2.07,0.97 -3.3,0.97 -2.34,0 -4.33,-1.58 -5.04,-3.7H2.9v2.66C4.4,18.87 8.0,20.6 12,20.6z" fill="#34A853" />
                        <path d="M6.96,13.1c-0.18,-0.5 -0.28,-1.1 -0.28,-1.6s0.1,-1.1 0.28,-1.6V7.24H2.9C2.3,8.44 2,9.7 2,11.5s0.3,3.06 0.9,4.26l4.06,-3.2C6.96,13.1 6.96,13.1 6.96,13.1z" fill="#FBBC05" />
                        <path d="M12,6.4c1.3,0 2.48,0.45 3.4,1.33l2.55,-2.55C16.43,3.75 14.41,3.2 12,3.2c-4.0,0 -7.6,1.73 -9.1,4.96l4.06,3.2C7.67,7.98 9.66,6.4 12,6.4z" fill="#EA4335" />
                      </g>
                    </svg>
                    Hoàn tất đăng ký Google
                  </div>
                  <h3 className="text-slate-800 font-extrabold text-xl font-display">
                    Cài đặt Khối lớp học
                  </h3>
                  <p className="text-slate-500 text-xs leading-relaxed mt-1.5">
                    Chào mừng <span className="font-semibold text-indigo-600">{googleUserToRegister.name}</span>! Hãy chọn Khối lớp bạn đăng ký học dưới đây để hoàn tất tạo tài khoản:
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1.5">Email truy cập:</label>
                    <input
                      type="text"
                      disabled
                      value={googleUserToRegister.email}
                      className="w-full text-xs p-3 bg-slate-100 border border-slate-200 rounded-xl text-slate-500"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1.5">Cấp độ / Lớp học:</label>
                    <select
                      value={googleGradeSelection}
                      onChange={(e) => setGoogleGradeSelection(e.target.value)}
                      className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl"
                    >
                      <option value="6">Lớp 6 (vào Chuyên)</option>
                      <option value="10">Lớp 10</option>
                      <option value="12">Lớp 12</option>
                    </select>
                  </div>

                  <button
                    onClick={handleRegisterGoogleUser}
                    className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold py-3 rounded-xl text-xs mt-2 flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all cursor-pointer shadow-lg shadow-indigo-500/30"
                  >
                    Xác nhận & Vào học ngay <ArrowRight className="h-4 w-4" />
                  </button>

                  <button
                    onClick={() => setGoogleUserToRegister(null)}
                    className="w-full text-slate-400 hover:text-slate-700 text-xs font-semibold pt-1 text-center block cursor-pointer transition-colors"
                  >
                    ← Quay lại màn hình đăng nhập
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-4 anim-fade-slide-up">
                  <div>
                    <h3 className="text-slate-800 font-extrabold text-xl font-display leading-tight">
                      {isRegistering ? 'Tạo tài khoản mới' : 'Đăng nhập hệ thống'}
                    </h3>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-slate-400 text-[11px] font-medium">
                        {isRegistering ? 'Điền thông tin để bắt đầu hành trình học tập.' : 'Chào mừng trở lại EnglishPro!'}
                      </p>
                      <button
                        onClick={() => setIsRegistering(!isRegistering)}
                        className="text-indigo-600 hover:text-indigo-800 text-[11px] font-bold shrink-0 ml-2 underline underline-offset-2 decoration-dotted cursor-pointer transition-colors"
                      >
                        {isRegistering ? 'Đã có tài khoản?' : 'Tạo học sinh mới'}
                      </button>
                    </div>
                  </div>

                  {isRegistering ? (
                    /* REGISTRY FORM */
                    <form onSubmit={handleRegister} className="space-y-3">
                      <div>
                        <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1.5">Tên đăng nhập:</label>
                        <input
                          type="text"
                          required
                          value={usernameInput}
                          onChange={(e) => setUsernameInput(e.target.value)}
                          placeholder="E.g. phuclch"
                          className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-300"
                        />
                      </div>
                      <div>
                        <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1.5">Họ tên đầy đủ:</label>
                        <input
                          type="text"
                          required
                          value={fullnameInput}
                          onChange={(e) => setFullnameInput(e.target.value)}
                          placeholder="E.g. Lê Công Hoàng Phúc"
                          className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-300"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1.5">Email:</label>
                          <input
                            type="email"
                            required
                            value={emailInput}
                            onChange={(e) => setEmailInput(e.target.value)}
                            placeholder="email@example.com"
                            className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-300"
                          />
                        </div>
                        <div>
                          <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1.5">Điện thoại:</label>
                          <input
                            type="text"
                            value={phoneInput}
                            onChange={(e) => setPhoneInput(e.target.value)}
                            placeholder="0843071216"
                            className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-300"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1.5">Khối lựa chọn:</label>
                          <select
                            value={gradeInput}
                            onChange={(e) => setGradeInput(e.target.value)}
                            className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-700"
                          >
                            <option value="6">Lớp 6</option>
                            <option value="10">Lớp 10</option>
                            <option value="12">Lớp 12</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1.5">Mật khẩu:</label>
                          <input
                            type="password"
                            required
                            value={passwordInput}
                            onChange={(e) => setPasswordInput(e.target.value)}
                            placeholder="Mật khẩu"
                            className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-300"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold py-3 rounded-xl text-xs mt-1 flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all cursor-pointer shadow-lg shadow-indigo-500/25"
                      >
                        <UserPlus className="h-4 w-4" /> Hoàn thành Đăng ký
                      </button>
                    </form>
                  ) : (
                    /* LOGIN FORM */
                    <form onSubmit={handleLogin} className="space-y-4">
                      <div>
                        <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1.5">Tên đăng nhập:</label>
                        <input
                          type="text"
                          required
                          value={usernameInput}
                          onChange={(e) => setUsernameInput(e.target.value)}
                          placeholder="Nhập tên đăng nhập của bạn"
                          className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-300"
                        />
                      </div>
                      <div>
                        <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1.5">Mật khẩu:</label>
                        <input
                          type="password"
                          required
                          value={passwordInput}
                          onChange={(e) => setPasswordInput(e.target.value)}
                          placeholder="Mật khẩu truy cập"
                          className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-300"
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold py-3 rounded-xl text-xs mt-1 flex items-center justify-center gap-2 active:scale-[0.98] transition-all cursor-pointer shadow-lg shadow-indigo-500/25"
                      >
                        Đăng nhập hệ thống <ArrowRight className="h-4 w-4" />
                      </button>
                    </form>
                  )}

                  <div className="relative py-1">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-slate-200/60"></div>
                    </div>
                    <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-wider">
                      <span className="bg-white/90 px-3 text-slate-400 rounded-full">Hoặc tiếp tục với</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    className="w-full py-2.5 px-4 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 font-semibold rounded-xl text-xs flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] cursor-pointer shadow-sm"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
                      <g transform="matrix(1, 0, 0, 1, 0, 0)">
                        <path d="M21.35,11.1H12v2.7h5.38c-0.24,1.28 -0.96,2.37 -2.04,3.1v2.57h3.3c1.93,-1.78 3.04,-4.4 3.04,-7.4C21.7,11.75 21.57,11.38 21.35,11.1z" fill="#4285F4" />
                        <path d="M12,20.6c2.43,0 4.47,-0.8 5.96,-2.2l-3.3,-2.57c-0.9,0.6 -2.07,0.97 -3.3,0.97 -2.34,0 -4.33,-1.58 -5.04,-3.7H2.9v2.66C4.4,18.87 8.0,20.6 12,20.6z" fill="#34A853" />
                        <path d="M6.96,13.1c-0.18,-0.5 -0.28,-1.1 -0.28,-1.6s0.1,-1.1 0.28,-1.6V7.24H2.9C2.3,8.44 2,9.7 2,11.5s0.3,3.06 0.9,4.26l4.06,-3.2C6.96,13.1 6.96,13.1 6.96,13.1z" fill="#FBBC05" />
                        <path d="M12,6.4c1.3,0 2.48,0.45 3.4,1.33l2.55,-2.55C16.43,3.75 14.41,3.2 12,3.2c-4.0,0 -7.6,1.73 -9.1,4.96l4.06,3.2C7.67,7.98 9.66,6.4 12,6.4z" fill="#EA4335" />
                      </g>
                    </svg>
                    Đăng nhập bằng Google ID
                  </button>
                </div>

                <div className="border-t border-slate-100 pt-4 mt-2">
                  <button
                    onClick={enterAsGuest}
                    className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2.5 rounded-xl text-xs active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 cursor-pointer border border-slate-200/60"
                  >
                    Vào học tự do với tư cách Khách (Guest) 🚀
                  </button>
                </div>
              </>
            )}
          </div>

        </div>

        {/* Modal alerts for login screen */}
        <Modal
          isOpen={modalConfig.isOpen}
          type={modalConfig.type}
          title={modalConfig.title}
          message={modalConfig.message}
          confirmText={modalConfig.confirmText}
          cancelText={modalConfig.cancelText}
          onConfirm={modalConfig.onConfirm}
          onCancel={modalConfig.onCancel}
          onClose={closeCustomModal}
        />
      </div>
    );
  }

  // Active student logged-in environment
  const isExpired = new Date().getTime() > new Date(currentUser.expiresAt).getTime();
  const isAdminUser = currentUser.role === 'admin';

  // User avatar initials
  const userInitials = currentUser.name
    ? currentUser.name.split(' ').map(w => w[0]).slice(-2).join('').toUpperCase()
    : 'U';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col font-sans antialiased text-slate-900 dark:text-slate-100">
      
      {/* Top horizontal Navigation header */}
      <header className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-5 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              id="sidebar-toggle"
              className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl shrink-0 cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </button>
            <button
              onClick={() => setActiveTab('dashboard')}
              className="font-extrabold font-display text-slate-900 dark:text-white text-base md:text-lg tracking-tight flex items-center gap-2.5 hover:opacity-85 active:scale-[0.98] transition-all cursor-pointer text-left"
            >
              <span className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-xl flex items-center justify-center text-white font-bold shadow-md shadow-indigo-500/30 shrink-0">E</span>
              <span className="hidden sm:block">
                <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">EnglishPro</span>
                <span className="text-xs text-slate-400 dark:text-slate-500 font-sans font-medium ml-1.5 hidden md:inline">| Luyện thi 3 Cấp độ</span>
              </span>
            </button>
          </div>

          {/* Top selection for classroom filtering & Luyện đề ngay */}
          <div className="hidden md:flex items-center gap-3 flex-1 justify-center">
            <div className="flex bg-slate-100 dark:bg-slate-800/80 p-1 rounded-full border border-slate-200/60 dark:border-slate-700/50">
              {[
                { id: 'all', label: 'Tất cả' },
                { id: '6', label: 'Lớp 6' },
                { id: '10', label: 'Lớp 10' },
                { id: '12', label: 'Lớp 12' }
              ].filter(tab => {
                if (currentUser && currentUser.role === 'student' && currentUser.grade) {
                  return tab.id === currentUser.grade;
                }
                return true;
              }).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setCurrentGrade(tab.id)}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold tracking-tight transition-all cursor-pointer ${
                    currentGrade === tab.id
                      ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm border border-slate-200/60 dark:border-slate-700'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setActiveTab('practice')}
              id="nav-practice-btn"
              className={`px-4 py-1.5 rounded-full text-xs font-bold tracking-tight transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 ${
                activeTab === 'practice'
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/30'
                  : 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900/50 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 shadow-sm'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              Luyện đề ngay ⚡
            </button>
          </div>

          {/* Active user indicators */}
          <div className="flex items-center gap-2.5">
            {currentUser.role === 'student' && (
              <span
                className="flex items-center gap-1 bg-cyan-50 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-900/40 text-cyan-700 dark:text-cyan-300 text-xs font-extrabold px-2.5 py-1 rounded-full"
                title="Kim cương tích lũy"
              >
                💎 {currentUser.diamonds || 0}
              </span>
            )}

            <div className="text-right hidden sm:block">
              <p className="text-slate-800 dark:text-slate-200 font-bold text-xs leading-none">{currentUser.name}</p>
              <p className="text-slate-400 dark:text-slate-500 text-[10px] mt-0.5 font-medium capitalize">{currentUser.role}</p>
            </div>

            {/* Avatar initials */}
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-full flex items-center justify-center text-white text-[10px] font-extrabold shadow-sm shrink-0 select-none">
              {userInitials}
            </div>
            
            <button
              onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
              id="theme-toggle"
              className="p-2 cursor-pointer rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 transition-all hover:text-slate-900 dark:hover:text-white"
              title={theme === 'light' ? 'Chuyển sang Chế độ tối' : 'Chuyển sang Chế độ sáng'}
            >
              {theme === 'light'
                ? <Moon className="h-4 w-4" />
                : <Sun className="h-4 w-4 text-amber-400" />}
            </button>

            <button
              onClick={handleLogout}
              id="logout-btn"
              className="p-2 cursor-pointer rounded-xl text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-rose-100 dark:border-rose-900/30 transition-all hover:text-rose-700 dark:hover:text-rose-300"
              title="Đăng xuất"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Expiry warnings */}
      {isExpired && !isAdminUser && (
        <div className="bg-red-50 dark:bg-red-950/20 border-y border-red-200 dark:border-red-900/30 text-red-800 dark:text-red-400 text-xs px-6 py-2 flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
          Gói học tập của bạn đã quá hạn sử dụng (31/12/2026). Hoạt động làm đề thi bị tự động hạn chế về tối đa 3 đề / ngày! Hãy liên hệ ban giám hiệu để gia hạn.
        </div>
      )}

      {/* Main viewport workspace */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto relative min-h-0">
        
        {/* Slider Auto-hide sidebar */}
        {menuOpen && (
          <div className="fixed inset-0 z-40 flex" onClick={() => setMenuOpen(false)}>
            {/* Overlay */}
            <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" style={{ animation: 'fadeSlideUp 0.2s ease' }} />

            <aside
              className="relative w-72 bg-white dark:bg-slate-900 flex flex-col justify-between h-full border-r border-slate-200 dark:border-slate-800 shadow-2xl"
              onClick={e => e.stopPropagation()}
              style={{ animation: 'fadeSlideIn 0.25s cubic-bezier(0.16,1,0.3,1)' }}
            >
              {/* Sidebar header */}
              <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-7 h-7 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center text-white text-xs font-extrabold shadow-sm">E</span>
                  <span className="font-bold font-display text-slate-900 dark:text-white text-sm">EnglishPro</span>
                </div>
                <button onClick={() => setMenuOpen(false)} className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-1">
                {/* Student nav */}
                {([
                  { id: 'dashboard',       label: 'Bảng thông tin',    icon: LayoutDashboard },
                  { id: 'practice',        label: 'Luyện đề thi',       icon: BookOpen },
                  { id: 'custom_training', label: 'Ôn luyện chuyên sâu', icon: RefreshCw },
                  { id: 'vocabulary',      label: 'Thư viện & Từ vựng 📖', icon: Library },
                ] as { id: string; label: string; icon: React.FC<any> }[]).map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => { setActiveTab(item.id as any); setMenuOpen(false); }}
                      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
                        isActive
                          ? 'bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-950/50 dark:to-violet-950/30 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/40'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/70'
                      }`}
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : ''}`} />
                      {item.label}
                      {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                    </button>
                  );
                })}

                {/* ADMIN ONLY FEATURES */}
                {isAdminUser && (
                  <div className="pt-4 mt-2 space-y-1 border-t border-slate-100 dark:border-slate-800">
                    <p className="text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-extrabold px-3.5 mb-2 flex items-center gap-1.5">
                      <ShieldCheck className="h-3 w-3" /> Giáo viên & Admin
                    </p>

                    {([
                      { id: 'exam_manager',          label: 'Quản lý đề thi',        icon: ShieldCheck },
                      { id: 'import_manager',         label: 'Import đề thi 📥',      icon: FolderSync },
                      { id: 'category_manager',       label: 'Quản lý phân loại',     icon: Settings },
                      { id: 'vocabulary_normalizer',  label: 'Chuẩn hóa từ vựng 🧭', icon: Compass },
                      { id: 'user_admin',             label: 'Gia hạn học viên',      icon: Users },
                    ] as { id: string; label: string; icon: React.FC<any> }[]).map((item) => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => { setActiveTab(item.id as any); setMenuOpen(false); }}
                          className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
                            isActive
                              ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border border-violet-100 dark:border-violet-900/30'
                              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/70'
                          }`}
                        >
                          <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-violet-600 dark:text-violet-400' : ''}`} />
                          {item.label}
                          {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-violet-500" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Admin Secure Github Export / Restores */}
              {isAdminUser && (
                <div className="border-t border-slate-100 dark:border-slate-800 p-4 space-y-3">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                    <FolderSync className="h-3 w-3" /> Backup & Restore (GitHub)
                  </div>
                  <input
                    type="text"
                    value={githubRepoInput}
                    onChange={(e) => setGithubRepoInput(e.target.value)}
                    className="w-full text-xs bg-slate-50 dark:bg-slate-800 p-2.5 border border-slate-200 dark:border-slate-700 rounded-lg font-bold font-mono text-slate-700 dark:text-slate-200"
                    placeholder="E.g. funghostvn/app"
                  />
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-bold">
                    <button
                      onClick={handleGithubBackup}
                      disabled={backupSyncing}
                      className="p-2 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-400 text-center cursor-pointer disabled:opacity-40 transition-colors"
                    >
                      {backupSyncing ? 'Đang xử lý...' : 'Sao lưu'}
                    </button>
                    <button
                      onClick={handleGithubRestore}
                      disabled={backupSyncing}
                      className="p-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:opacity-90 text-white rounded-lg text-center cursor-pointer disabled:opacity-40 transition-all"
                    >
                      Restore
                    </button>
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}

        {/* Content view workspace renderer (views are lazy-loaded chunks) */}
        <main className="flex-1 p-5 md:p-8 overflow-y-auto">
          <Suspense
            fallback={
              <div className="flex h-[400px] items-center justify-center">
                <div className="relative w-10 h-10">
                  <div className="absolute inset-0 rounded-full border-2 border-indigo-200 dark:border-indigo-900" />
                  <div className="absolute inset-0 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
                </div>
              </div>
            }
          >
            {renderActiveView()}
          </Suspense>
        </main>

      </div>

      {/* Modal Dialog Portal container */}
      <Modal
        isOpen={modalConfig.isOpen}
        type={modalConfig.type}
        title={modalConfig.title}
        message={modalConfig.message}
        confirmText={modalConfig.confirmText}
        cancelText={modalConfig.cancelText}
        onConfirm={modalConfig.onConfirm}
        onCancel={modalConfig.onCancel}
        onClose={closeCustomModal}
      />
    </div>
  );
}
