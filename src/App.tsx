import React, { useEffect, useState } from 'react';
import { collection, getDocs, doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { db, auth } from './firebase';
import { User, Exam, Attempt } from './types';
import { SEED_USERS, SEED_EXAMS } from './seedData';

// Subviews
import DashboardView from './components/DashboardView';
import PracticeView from './components/PracticeView';
import CustomTrainingView from './components/CustomTrainingView';
import ExamManagerView from './components/ExamManagerView';
import CategoryManagerView from './components/CategoryManagerView';
import UserAdminView from './components/UserAdminView';
import ImportExamView from './components/ImportExamView';
import VocabularyNormalizerView from './components/VocabularyNormalizerView';
import VocabularyView from './components/VocabularyView';
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
  Library
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
  const [githubRepoInput, setGithubRepoInput] = useState('funghostvn/app');
  const [backupSyncing, setBackupSyncing] = useState(false);

  useEffect(() => {
    bootstrapAndCheckSession();
  }, []);

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
      // Check registered grade restriction for student role
      const examDocSnap = await getDocs(collection(db, 'exams'));
      const foundExam = examDocSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as Exam))
        .find(e => e.id === examId);

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

      // 1. Fetch attempts computed today
      const attemptCol = collection(db, 'attempts');
      const snap = await getDocs(attemptCol);
      const list = snap.docs.map(d => d.data() as Attempt);

      const startOfToday = new Date();
      startOfToday.setHours(0,0,0,0);

      const todayAttempts = list.filter(att => {
        const attDate = new Date(att.createdAt);
        return att.userId === currentUser.id && attDate.getTime() >= startOfToday.getTime();
      });

      // Guest Limits: max 1 per day
      if (currentUser.role === 'guest') {
        if (todayAttempts.length >= 1) {
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
        if (todayAttempts.length >= 3) {
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
      // Pull all Firestore documents
      const usersSnap = await getDocs(collection(db, 'users'));
      const examsSnap = await getDocs(collection(db, 'exams'));
      const attemptsSnap = await getDocs(collection(db, 'attempts'));
      const extensionsSnap = await getDocs(collection(db, 'extensions'));
      const feedbacksSnap = await getDocs(collection(db, 'feedbacks'));

      const payload = {
        timestamp: new Date().toISOString(),
        users: usersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        exams: examsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        attempts: attemptsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        extensions: extensionsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        feedbacks: feedbacksSnap.docs.map(d => ({ id: d.id, ...d.data() })),
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

      showCustomModal({
        type: 'success',
        title: 'Sao lưu GitHub hoàn tất 🎉',
        message: `Toàn bộ kho dữ liệu đã được nén và đẩy lên file 'exam_prep_backup.json' trong repo '${githubRepoInput.trim()}' thành công.`
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

        showCustomModal({
          type: 'success',
          title: 'Khôi phục hoàn tất ✨',
          message: 'Bản nén đã được đọc và đồng bộ hóa thành công trên Firestore Cloud của bạn.'
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
          />
        );
    }
  };

  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 antialiased font-sans">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent mx-auto" />
          <p className="text-slate-500 text-sm font-semibold">Khởi tạo hệ thống luyện đề 3 cấp độ...</p>
        </div>
      </div>
    );
  }

  // Not Logged-In Portal
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 antialiased font-sans">
        <div className="bg-white rounded-3xl shadow-xl border border-slate-200/60 max-w-lg w-full overflow-hidden flex flex-col md:flex-row h-auto md:h-[540px]">
          
          {/* Left design section */}
          <div className="md:w-5/12 bg-slate-900 text-white p-8 flex flex-col justify-between">
            <div>
              <div className="h-10 w-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white mb-6">
                <BookOpen className="h-5 w-5" />
              </div>
              <h2 className="text-2xl font-bold font-sans tracking-tight leading-snug">Luyện đề thi English 📘</h2>
              <p className="text-slate-400 text-xs mt-2 leading-relaxed">
                Kho dữ liệu đề thi tuyển sinh lớp 6 Cầu Giấy/Nguyễn Tất Thành, đề thi khảo sát lớp 10, tốt nghiệp THPT Quốc Gia.
              </p>
            </div>
            
            <div className="text-[11px] text-slate-500 pt-6">
              © {new Date().getFullYear()} Luyện thi 3 Cấp độ.
            </div>
          </div>

          {/* Right form input section */}
          <div className="flex-1 p-8 overflow-y-auto flex flex-col justify-between">
            {googleUserToRegister ? (
              /* GOOGLE ADDITIONAL INFORMATION FORM */
              <div className="space-y-4 my-auto">
                <div>
                  <h3 className="text-slate-800 font-extrabold text-lg">
                    Cài đặt Khối lớp học
                  </h3>
                  <p className="text-slate-500 text-xs leading-relaxed mt-1">
                    Chào mừng <span className="font-semibold text-indigo-600">{googleUserToRegister.name}</span>! Hãy chọn Khối lớp bạn đăng ký học dưới đây để hoàn tất tạo tài khoản:
                  </p>
                </div>

                <div className="space-y-3 pt-2">
                  <div>
                    <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Email truy cập:</label>
                    <input
                      type="text"
                      disabled
                      value={googleUserToRegister.email}
                      className="w-full text-xs p-2.5 bg-slate-100 border border-slate-200 rounded-lg text-slate-500 focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Cấp độ / Lớp học:</label>
                    <select
                      value={googleGradeSelection}
                      onChange={(e) => setGoogleGradeSelection(e.target.value)}
                      className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="6">Lớp 6 (vào Chuyên)</option>
                      <option value="10">Lớp 10</option>
                      <option value="12">Lớp 12</option>
                    </select>
                  </div>

                  <button
                    onClick={handleRegisterGoogleUser}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 rounded-lg text-xs mt-4 flex items-center justify-center gap-1.5 active:scale-98 transition-all cursor-pointer"
                  >
                    Xác nhận & Vào học ngay <ArrowRight className="h-4 w-4 text-indigo-400" />
                  </button>

                  <button
                    onClick={() => setGoogleUserToRegister(null)}
                    className="w-full text-slate-500 hover:text-slate-800 text-xs font-semibold pt-1 text-center block cursor-pointer transition-colors"
                  >
                    Quay lại màn hình đăng nhập
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-slate-800 font-extrabold text-lg">
                      {isRegistering ? 'Đăng ký học sinh mới' : 'Đăng nhập hệ thống'}
                    </h3>
                    <button
                      onClick={() => setIsRegistering(!isRegistering)}
                      className="text-indigo-600 hover:text-indigo-800 text-xs font-semibold"
                    >
                      {isRegistering ? 'Đã có tài khoản?' : 'Tạo học sinh mới'}
                    </button>
                  </div>

                  {isRegistering ? (
                    /* REGISTRY FORM */
                    <form onSubmit={handleRegister} className="space-y-3">
                      <div>
                        <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Tên đăng nhập:</label>
                        <input
                          type="text"
                          required
                          value={usernameInput}
                          onChange={(e) => setUsernameInput(e.target.value)}
                          placeholder="E.g. phuclch"
                          className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden"
                        />
                      </div>
                      <div>
                        <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Họ tên đầy đủ:</label>
                        <input
                          type="text"
                          required
                          value={fullnameInput}
                          onChange={(e) => setFullnameInput(e.target.value)}
                          placeholder="E.g. Lê Công Hoàng Phúc"
                          className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Email:</label>
                          <input
                            type="email"
                            required
                            value={emailInput}
                            onChange={(e) => setEmailInput(e.target.value)}
                            placeholder="phuclch@outlook.com"
                            className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden"
                          />
                        </div>
                        <div>
                          <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Điện thoại:</label>
                          <input
                            type="text"
                            value={phoneInput}
                            onChange={(e) => setPhoneInput(e.target.value)}
                            placeholder="0843071216"
                            className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Khối lựa chọn:</label>
                          <select
                            value={gradeInput}
                            onChange={(e) => setGradeInput(e.target.value)}
                            className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden"
                          >
                            <option value="6">Lớp 6</option>
                            <option value="10">Lớp 10</option>
                            <option value="12">Lớp 12</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Mật khẩu:</label>
                          <input
                            type="password"
                            required
                            value={passwordInput}
                            onChange={(e) => setPasswordInput(e.target.value)}
                            placeholder="Mật khẩu truy cập"
                            className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded-lg text-xs mt-3 flex items-center justify-center gap-1.5 active:scale-98 transition-all cursor-pointer"
                      >
                        <UserPlus className="h-4 w-4" /> Hoàn thành Đăng ký
                      </button>
                    </form>
                  ) : (
                    /* LOGIN FORM */
                    <form onSubmit={handleLogin} className="space-y-4">
                      <div>
                        <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Tên đăng nhập:</label>
                        <input
                          type="text"
                          required
                          value={usernameInput}
                          onChange={(e) => setUsernameInput(e.target.value)}
                          placeholder="Ví dụ: phuclch, leanhthu2014, binhlc"
                          className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block mb-1">Mật khẩu:</label>
                        <input
                          type="password"
                          required
                          value={passwordInput}
                          onChange={(e) => setPasswordInput(e.target.value)}
                          placeholder="Mật khẩu truy cập"
                          className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 rounded-lg text-xs mt-2 flex items-center justify-center gap-1.5 active:scale-98 transition-all cursor-pointer"
                      >
                        Đăng nhập hệ thống <ArrowRight className="h-4 w-4 text-indigo-400" />
                      </button>
                    </form>
                  )}

                  <div className="relative py-1">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-slate-200/80"></div>
                    </div>
                    <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-wider">
                      <span className="bg-white px-2 text-slate-400">Hoặc tiếp tục với</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    className="w-full py-2.5 px-4 border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold rounded-lg text-xs flex items-center justify-center gap-2.5 transition-all active:scale-98 cursor-pointer shadow-3xs"
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

                <div className="border-t pt-4 mt-6">
                  <button
                    onClick={enterAsGuest}
                    className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl text-xs active:scale-98 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
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

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans antialiased text-slate-850">
      
      {/* Top horizontal Navigation header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 transition-all">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="text-slate-500 hover:text-slate-800 p-1 hover:bg-slate-100 rounded-lg shrink-0 cursor-pointer"
            >
              <Menu className="h-6 w-6" />
            </button>
            <button
              onClick={() => setActiveTab('dashboard')}
              className="font-extrabold font-display text-indigo-950 text-base md:text-lg tracking-tight flex items-center gap-2 hover:opacity-85 active:scale-98 transition-all cursor-pointer text-left"
            >
              <span className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold shadow-sm">E</span>
              <span>
                EnglishPro <span className="text-xs text-slate-400 font-sans font-medium hidden sm:inline">| Luyện thi 3 Cấp độ</span>
              </span>
            </button>
          </div>

          {/* Top selection for classroom filtering & Luyện đề ngay */}
          <div className="hidden md:flex items-center gap-4">
            <div className="flex bg-slate-100 p-1 rounded-full border border-slate-200/40 shadow-2xs">
              {[
                { id: 'all', label: 'Tất cả' },
                { id: '6', label: 'Lớp 6 (vào Chuyên)' },
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
                  onClick={() => {
                    setCurrentGrade(tab.id);
                  }}
                  className={`px-5 py-1.5 rounded-full text-xs font-semibold tracking-tight transition-all cursor-pointer ${
                    currentGrade === tab.id
                      ? 'bg-white text-indigo-600 shadow-xs border border-slate-200/20'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setActiveTab('practice')}
              className={`px-5 py-1.5 rounded-full text-xs font-bold tracking-tight transition-all cursor-pointer flex items-center gap-1.5 shadow-xs active:scale-95 ${
                activeTab === 'practice'
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-50'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              Luyện đề ngay ⚡
            </button>
          </div>

          {/* Active user indicators */}
          <div className="flex items-center gap-4 text-xs font-semibold">
            <div className="text-right hidden sm:block">
              <p className="text-slate-800 font-bold leading-none">{currentUser.name}</p>
              <p className="text-slate-400 text-[10px] mt-0.5 font-medium">Role: {currentUser.role.toUpperCase()}</p>
            </div>
            
            <button
              onClick={handleLogout}
              className="p-2 cursor-pointer bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-800 rounded-lg transition-colors border border-red-100"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Expiry warnings */}
      {isExpired && !isAdminUser && (
        <div className="bg-red-50 border-y border-red-200 text-red-800 text-xs px-6 py-2 flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
          Gói học tập của bạn đã quá hạn sử dụng (31/12/2026). Hoạt động làm đề thi bị tự động hạn chế về tối đa 3 đề / ngày! Hãy liên hệ ban giám hiệu để gia hạn.
        </div>
      )}

      {/* Main viewport workspace */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto relative min-h-0">
        
        {/* Slider Auto-hide sidebar */}
        {menuOpen && (
          <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs flex animate-in fade-in duration-200">
            <aside className="w-80 bg-white p-6 flex flex-col justify-between animate-in slide-in-from-left duration-200 h-full border-r border-slate-200 shadow-2xl">
              <div className="space-y-8">
                <div className="flex justify-between items-center">
                  <h4 className="text-slate-400 font-bold uppercase text-[10px] tracking-widest flex items-center gap-1.5">
                    Chức năng hệ thống
                  </h4>
                  <button onClick={() => setMenuOpen(false)} className="text-slate-400 hover:text-slate-900 p-1 hover:bg-slate-100 rounded-lg cursor-pointer">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <nav className="space-y-1.5 text-sm font-semibold">
                  <button
                    onClick={() => { setActiveTab('dashboard'); setMenuOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer ${
                      activeTab === 'dashboard'
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <LayoutDashboard className="h-4 w-4" /> Bảng thông tin chung
                  </button>

                  <button
                    onClick={() => { setActiveTab('practice'); setMenuOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer ${
                      activeTab === 'practice'
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <BookOpen className="h-4 w-4" /> Luyện đề thi
                  </button>

                  <button
                    onClick={() => { setActiveTab('custom_training'); setMenuOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer ${
                      activeTab === 'custom_training'
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <RefreshCw className="h-4 w-4" /> Ôn luyện chuyên sâu
                  </button>

                  <button
                    onClick={() => { setActiveTab('vocabulary'); setMenuOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer ${
                      activeTab === 'vocabulary'
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <Library className="h-4 w-4" /> Thư viện & Từ vựng 📖
                  </button>

                  {/* ADMIN ONLY FEATURES */}
                  {isAdminUser && (
                    <div className="pt-6 space-y-1.5 border-t border-slate-100">
                      <p className="text-[10px] text-slate-400 uppercase tracking-widest font-extrabold block px-4 mb-2">
                        Giáo viên & Admin
                      </p>

                      <button
                        onClick={() => { setActiveTab('exam_manager'); setMenuOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer ${
                          activeTab === 'exam_manager'
                            ? 'bg-indigo-50 text-indigo-700 border border-indigo-100/50'
                            : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        <ShieldCheck className="h-4 w-4" /> Quản lý đề thi
                      </button>

                      <button
                        onClick={() => { setActiveTab('import_manager'); setMenuOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer ${
                          activeTab === 'import_manager'
                            ? 'bg-indigo-50 text-indigo-700 border border-indigo-100/50'
                            : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        <FolderSync className="h-4 w-4 text-indigo-505" /> Import đề thi 📥
                      </button>

                      <button
                        onClick={() => { setActiveTab('category_manager'); setMenuOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer ${
                          activeTab === 'category_manager'
                            ? 'bg-indigo-50 text-indigo-700 border border-indigo-100/50'
                            : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        <Settings className="h-4 w-4" /> Quản lý phân loại
                      </button>

                      <button
                        onClick={() => { setActiveTab('vocabulary_normalizer'); setMenuOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer ${
                          activeTab === 'vocabulary_normalizer'
                            ? 'bg-indigo-50 text-indigo-700 border border-indigo-100/50'
                            : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        <Compass className="h-4 w-4" /> Chuẩn hóa từ vựng 🧭
                      </button>

                      <button
                        onClick={() => { setActiveTab('user_admin'); setMenuOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer ${
                          activeTab === 'user_admin'
                            ? 'bg-indigo-50 text-indigo-700 border border-indigo-100/50'
                            : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        <Users className="h-4 w-4" /> Khóa / Gia hạn học viên
                      </button>
                    </div>
                  )}
                </nav>
              </div>

              {/* Admin Secure Github Export / Restores */}
              {isAdminUser && (
                <div className="border-t border-slate-100 pt-6 space-y-4">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <FolderSync className="h-3.5 w-3.5" /> Backup & Restore (GitHub)
                  </div>
                  <input
                    type="text"
                    value={githubRepoInput}
                    onChange={(e) => setGithubRepoInput(e.target.value)}
                    className="w-full text-xs bg-slate-50 p-2.5 border border-slate-200 rounded font-bold font-mono text-slate-700 focus:outline-[#dedfe4]"
                    placeholder="E.g. funghostvn/app"
                  />
                  
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-bold">
                    <button
                      onClick={handleGithubBackup}
                      disabled={backupSyncing}
                      className="p-2 border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-600 hover:text-slate-900 text-center cursor-pointer disabled:opacity-40 transition-colors"
                    >
                      {backupSyncing ? 'Đang tác vụ...' : 'Sao lưu GitHub'}
                    </button>
                    <button
                      onClick={handleGithubRestore}
                      disabled={backupSyncing}
                      className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-center cursor-pointer disabled:opacity-40 transition-colors"
                    >
                      Restore Repo
                    </button>
                  </div>
                </div>
              )}
            </aside>
            <div className="flex-1" onClick={() => setMenuOpen(false)} />
          </div>
        )}

        {/* Content view workspace renderer */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto">
          {renderActiveView()}
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
