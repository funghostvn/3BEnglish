import React, { useState } from 'react';
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { Database, KeyRound, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { FirebaseRuntimeConfig, saveUserProvidedConfig } from '../services/runtimeFirebaseConfig';

const EMPTY_FORM: FirebaseRuntimeConfig = {
  projectId: '',
  appId: '',
  apiKey: '',
  authDomain: '',
  firestoreDatabaseId: '(default)',
  storageBucket: '',
  messagingSenderId: '',
};

const REQUIRED_FIELDS: (keyof FirebaseRuntimeConfig)[] = ['projectId', 'apiKey', 'appId', 'authDomain'];

type FormField = Exclude<keyof FirebaseRuntimeConfig, 'measurementId'>;

const FIELD_LABELS: Record<FormField, { label: string; placeholder: string; required: boolean }> = {
  projectId: { label: 'Project ID', placeholder: 'vd: my-firebase-project', required: true },
  apiKey: { label: 'API Key', placeholder: 'vd: AIzaSy...', required: true },
  appId: { label: 'App ID', placeholder: 'vd: 1:1234567890:web:abcdef', required: true },
  authDomain: { label: 'Auth Domain', placeholder: 'vd: my-project.firebaseapp.com', required: true },
  storageBucket: { label: 'Storage Bucket', placeholder: 'vd: my-project.firebasestorage.app', required: false },
  messagingSenderId: { label: 'Messaging Sender ID', placeholder: 'vd: 1234567890', required: false },
  firestoreDatabaseId: { label: 'Firestore Database ID', placeholder: '(default)', required: false },
};

// Try connecting with the given config on a throwaway, uniquely-named app
// instance so we never collide with (or interfere with) the real app — mirrors
// the connectivity check in firebase.ts's testConnection(). A Firestore
// "document not found" still resolves normally; only network/auth failures throw.
async function testFirebaseConnection(cfg: FirebaseRuntimeConfig): Promise<void> {
  const probeApp = initializeApp(cfg, `setup-check-${Date.now()}`);
  try {
    const db = getFirestore(probeApp, cfg.firestoreDatabaseId || '(default)');
    await getDocFromServer(doc(db, 'test', 'connection'));
  } finally {
    await deleteApp(probeApp);
  }
}

export default function DatabaseSetupView() {
  const [form, setForm] = useState<FirebaseRuntimeConfig>(EMPTY_FORM);
  const [status, setStatus] = useState<'idle' | 'checking' | 'error' | 'success'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleChange = (key: keyof FirebaseRuntimeConfig, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const missingRequired = REQUIRED_FIELDS.filter(k => !form[k]?.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (missingRequired.length > 0) {
      setStatus('error');
      setErrorMsg('Vui lòng điền đủ các trường bắt buộc.');
      return;
    }

    setStatus('checking');
    setErrorMsg('');
    try {
      const cfg: FirebaseRuntimeConfig = {
        ...form,
        firestoreDatabaseId: form.firestoreDatabaseId?.trim() || '(default)',
      };
      await testFirebaseConnection(cfg);
      saveUserProvidedConfig(cfg);
      setStatus('success');
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      console.error('Firebase connection test failed:', err);
      setStatus('error');
      setErrorMsg('Không thể kết nối tới Firebase với thông tin đã nhập. Vui lòng kiểm tra lại Project ID, API Key và các trường khác.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-950 flex items-center justify-center p-4 antialiased font-sans">
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden">
        <div className="bg-slate-900 p-7 text-white">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center mb-4">
            <Database className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-extrabold font-display tracking-tight">Thiết lập kết nối Cơ sở dữ liệu</h1>
          <p className="text-slate-400 text-xs mt-1.5 leading-relaxed">
            Ứng dụng chưa tìm thấy cấu hình Firebase (không có biến môi trường hoặc tệp cấu hình cục bộ). Nhập thông tin dự án Firebase của bạn bên dưới để kết nối — thông tin này chỉ được lưu trên trình duyệt của bạn, không gửi lên máy chủ nào khác.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-7 space-y-3.5">
          {(Object.keys(FIELD_LABELS) as FormField[]).map(key => (
            <div key={key}>
              <label className="block text-slate-500 text-[11px] font-bold uppercase tracking-wider mb-1">
                {FIELD_LABELS[key].label} {FIELD_LABELS[key].required && <span className="text-rose-500">*</span>}
              </label>
              <input
                type="text"
                value={form[key] || ''}
                onChange={e => handleChange(key, e.target.value)}
                placeholder={FIELD_LABELS[key].placeholder}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          ))}

          {status === 'error' && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold px-3.5 py-2.5 rounded-xl">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {errorMsg}
            </div>
          )}
          {status === 'success' && (
            <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold px-3.5 py-2.5 rounded-xl">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              Kết nối thành công! Đang tải lại ứng dụng...
            </div>
          )}

          <button
            type="submit"
            disabled={status === 'checking' || status === 'success'}
            className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:opacity-60 text-white font-bold py-3 rounded-xl text-xs flex items-center justify-center gap-2 active:scale-[0.98] transition-all cursor-pointer shadow-lg shadow-indigo-500/25"
          >
            {status === 'checking' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Đang kiểm tra kết nối...
              </>
            ) : (
              <>
                <KeyRound className="h-4 w-4" /> Kiểm tra kết nối &amp; Lưu
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
