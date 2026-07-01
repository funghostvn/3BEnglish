import React, { useEffect, useState } from 'react';
import { User, ExtensionLog } from '../types';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { fetchCollection, updateDocById } from '../services/firestore';
import { Users, Phone, Mail, Calendar, Key, UserCheck, ShieldAlert, History, Edit, CalendarMinus } from 'lucide-react';

interface UserAdminViewProps {
  onShowModal: (config: { type: 'success' | 'warning' | 'danger' | 'info' | 'confirm'; title: string; message: string; onConfirm?: () => void; onCancel?: () => void; }) => void;
}

export default function UserAdminView({ onShowModal }: UserAdminViewProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [extensionHistory, setExtensionHistory] = useState<ExtensionLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit / Extend states
  const [activeUserToEdit, setActiveUserToEdit] = useState<User | null>(null);
  const [activeUserToExtend, setActiveUserToExtend] = useState<User | null>(null);

  // Forms
  const [editForm, setEditForm] = useState<Partial<User>>({});
  const [extendForm, setExtendForm] = useState({
    expiryDate: '2026-12-31',
    note: 'Không có ghi chú đặc biệt'
  });

  useEffect(() => {
    fetchUsersAndHistory();
  }, []);

  const fetchUsersAndHistory = async () => {
    setLoading(true);
    try {
      const userList = await fetchCollection<User>('users');
      setUsers(userList);

      const extList = await fetchCollection<ExtensionLog>('extensions');
      // Sort newest extensions logs
      extList.sort((a, b) => new Date(b.extendedAt).getTime() - new Date(a.extendedAt).getTime());
      setExtensionHistory(extList);
    } catch (err) {
      console.error(err);
      onShowModal({ type: 'danger', title: 'Lỗi tải dữ liệu', message: 'Không thể tải danh sách học sinh/lịch sử gia hạn. Vui lòng kiểm tra kết nối mạng và tải lại trang.' });
    } finally {
      setLoading(false);
    }
  };

  const handleEditInit = (u: User) => {
    setActiveUserToEdit(u);
    setEditForm({ ...u });
  };

  const handleSaveUserEdit = async () => {
    if (!activeUserToEdit) return;

    try {
      await updateDocById('users', activeUserToEdit.id, {
        name: editForm.name,
        email: editForm.email,
        phone: editForm.phone,
        grade: editForm.grade
      });

      onShowModal({
        type: 'success',
        title: 'Cập nhật thành công',
        message: `Thông tin tài diện của '${editForm.name}' đã được đồng bộ hóa thành công!`
      });

      setActiveUserToEdit(null);
      fetchUsersAndHistory();
    } catch (err) {
      console.error(err);
      onShowModal({ type: 'danger', title: 'Cập nhật thất bại', message: 'Không thể lưu thông tin học sinh. Vui lòng thử lại.' });
    }
  };

  const handlePasswordReset = async (u: User) => {
    const generatedPass = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits random password

    const triggerReset = async () => {
      try {
        await updateDocById('users', u.id, { password: generatedPass });

        onShowModal({
          type: 'success',
          title: 'Khôi phục mật khẩu',
          message: `Mật khẩu mới của học sinh '${u.name}' là: ${generatedPass}. Vui lòng ghi lại cấu hình này để chuyển cho học sinh!`
        });
        fetchUsersAndHistory();
      } catch (err) {
        console.error(err);
        onShowModal({ type: 'danger', title: 'Đặt lại mật khẩu thất bại', message: 'Không thể đặt lại mật khẩu. Vui lòng thử lại.' });
      }
    };

    onShowModal({
      type: 'confirm',
      title: 'Khôi phục mật khẩu',
      message: `Bạn có chắc muốn đặt lại mật khẩu ngẫu nhiên cho học sinh '${u.name}' không?`,
      onConfirm: triggerReset
    });
  };

  const handleExtensionInit = (u: User) => {
    setActiveUserToExtend(u);
    setExtendForm({
      expiryDate: u.expiresAt ? u.expiresAt.split('T')[0] : '2026-12-31',
      note: 'Gia hạn gói luyện đề thường niên'
    });
  };

  const handleSaveExtension = async () => {
    if (!activeUserToExtend) return;

    try {
      const extendedToIso = new Date(`${extendForm.expiryDate}T23:59:59Z`).toISOString();

      // 1. Update user expiresAt parameter
      await updateDocById('users', activeUserToExtend.id, { expiresAt: extendedToIso });

      // 2. Commit log audit trail inside /extensions on Firestore
      const logPayload: Partial<ExtensionLog> = {
        id: `ext_${Date.now()}`,
        userId: activeUserToExtend.id,
        username: activeUserToExtend.name,
        grade: activeUserToExtend.grade,
        extendedAt: new Date().toISOString(),
        extendedTo: extendedToIso,
        note: extendForm.note
      };

      await addDoc(collection(db, 'extensions'), logPayload);

      onShowModal({
        type: 'success',
        title: 'Gia hạn gói thành công ⏱️',
        message: `Thời lượng luyện tập của '${activeUserToExtend.name}' đã được kéo dài đến ngày ${extendForm.expiryDate}.`
      });

      setActiveUserToExtend(null);
      fetchUsersAndHistory();
    } catch (err) {
      console.error(err);
      onShowModal({ type: 'danger', title: 'Gia hạn thất bại', message: 'Không thể gia hạn tài khoản học sinh. Vui lòng thử lại.' });
    }
  };

  if (loading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-10 pb-12 animate-in fade-in duration-200">
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Users list View */}
        <div className="lg:col-span-2 bg-white p-6 rounded-3xl border border-slate-100 shadow-xs">
          <div className="flex items-center gap-2 mb-6">
            <Users className="h-5 w-5 text-indigo-600" />
            <h3 className="font-extrabold text-slate-800 text-lg">Danh sách học sinh & Người dùng hệ thống</h3>
          </div>

          <div className="space-y-4">
            {users.map(u => (
              <div key={u.id} className="p-5 border border-slate-150 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:shadow-2xs transition-shadow">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold text-slate-900 text-sm">{u.name}</span>
                    <span className="bg-indigo-50 text-indigo-700 text-[10px] font-bold px-2 rounded uppercase font-mono">
                      Khóa: {u.grade === 'admin' ? 'Bảo trị viên' : `Lớp ${u.grade}`}
                    </span>
                    <span className="bg-slate-100 text-slate-600 text-[10px] px-2 rounded">
                      User: {u.username}
                    </span>
                    <span className="bg-slate-100 text-slate-600 text-[10px] px-2 rounded">
                      Expired: {new Date(u.expiresAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-4 text-xs text-slate-400 font-medium">
                    <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5 text-slate-300" /> {u.email}</span>
                    <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5 text-slate-300" /> {u.phone}</span>
                  </div>
                </div>

                <div className="flex gap-2 self-start shrink-0">
                  <button
                    onClick={() => handleEditInit(u)}
                    className="p-1 px-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold border border-slate-200 hover:border-slate-300 rounded-lg text-xs flex items-center gap-1 cursor-pointer"
                  >
                    Sửa
                  </button>
                  <button
                    onClick={() => handleExtensionInit(u)}
                    className="p-1 px-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold border border-indigo-200 hover:border-indigo-300 rounded-lg text-xs flex items-center gap-1 cursor-pointer"
                  >
                    Gia hạn tủ ⏱️
                  </button>
                  <button
                    onClick={() => handlePasswordReset(u)}
                    className="p-1 px-2 text-slate-500 hover:text-slate-800 rounded-lg shrink-0 cursor-pointer"
                    title="Đặt lại mật khẩu"
                  >
                    <Key className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

        </div>

        {/* Audit trail histories of renewals */}
        <div className="lg:col-span-1 bg-white p-6 rounded-3xl border border-slate-100 shadow-xs space-y-6">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-indigo-600" />
            <h4 className="font-extrabold text-slate-800 text-base">Nhật ký lịch sử gia hạn học viên</h4>
          </div>

          {extensionHistory.length === 0 ? (
            <div className="text-slate-400 text-xs py-8 text-center border border-dashed rounded-xl">Chưa phát sinh lượt gia hạn nào.</div>
          ) : (
            <div className="space-y-3 max-h-[360px] overflow-y-auto">
              {extensionHistory.map(log => (
                <div key={log.id} className="p-4 border bg-indigo-50/15 border-indigo-100/50 rounded-2xl space-y-1.5 text-xs text-slate-700">
                  <div className="flex justify-between font-bold">
                    <span className="text-slate-900">{log.username}</span>
                    <span className="text-indigo-600">Gói Lớp {log.grade}</span>
                  </div>
                  <p className="text-slate-500 font-semibold font-mono text-[10px]">
                    Hạn mới: {new Date(log.extendedTo).toLocaleDateString()}
                  </p>
                  <p className="border-t border-slate-200/50 pt-1 text-slate-600 italic">" {log.note} "</p>
                  <p className="text-[10px] text-slate-400 text-right font-medium">Lúc: {new Date(log.extendedAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Profile Editor Dialog */}
      {activeUserToEdit && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden border border-slate-200">
            <div className="px-5 py-4 bg-indigo-50 border-b flex justify-between items-center">
              <h4 className="font-bold text-slate-800 text-sm">Chỉnh sửa thông tin thành viên</h4>
              <button onClick={() => setActiveUserToEdit(null)} className="text-slate-400 hover:text-slate-600 font-bold">×</button>
            </div>
            
            <div className="p-6 space-y-4 text-xs">
              <div>
                <label className="font-bold text-slate-500 block mb-1">Họ tên đầy đủ:</label>
                <input
                  type="text"
                  value={editForm.name || ''}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full border p-2 rounded-lg"
                />
              </div>

              <div>
                <label className="font-bold text-slate-500 block mb-1">Email:</label>
                <input
                  type="email"
                  value={editForm.email || ''}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className="w-full border p-2 rounded-lg"
                />
              </div>

              <div>
                <label className="font-bold text-slate-500 block mb-1">Số điện thoại:</label>
                <input
                  type="text"
                  value={editForm.phone || ''}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  className="w-full border p-2 rounded-lg"
                />
              </div>

              <div>
                <label className="font-bold text-slate-500 block mb-1">Khóa (Grade):</label>
                <select
                  value={editForm.grade || '6'}
                  onChange={(e) => setEditForm({ ...editForm, grade: e.target.value })}
                  className="w-full border p-2 rounded-lg"
                >
                  <option value="6">Lớp 6 chất lượng cao</option>
                  <option value="10">Lớp 10 THPT</option>
                  <option value="12">Lớp 12 THPT</option>
                  <option value="admin">Admin quản trị viên</option>
                </select>
              </div>
            </div>

            <div className="px-5 py-4 bg-slate-50 border-t flex justify-end gap-3">
              <button onClick={() => setActiveUserToEdit(null)} className="border px-4 py-2 rounded-lg">Hủy</button>
              <button onClick={handleSaveUserEdit} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-lg">Lưu cập nhật</button>
            </div>
          </div>
        </div>
      )}

      {/* Subscription renewal Calendar Dialog */}
      {activeUserToExtend && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden border border-slate-200">
            <div className="px-5 py-4 bg-indigo-50 border-b flex justify-between items-center">
              <h4 className="font-bold text-slate-800 text-sm">Gia hạn khóa học đề luyện tập</h4>
              <button onClick={() => setActiveUserToExtend(null)} className="text-slate-400 hover:text-slate-600 font-bold">×</button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="bg-indigo-50 p-3 rounded-lg text-[11px] text-slate-600">
                Gia hạn tài khoản cho: <b>{activeUserToExtend.name}</b> (Gói học khối: {activeUserToExtend.grade})
              </div>

              <div>
                <label className="font-bold text-slate-500 block mb-1">Hạn mức thời gian mới:</label>
                <input
                  type="date"
                  value={extendForm.expiryDate}
                  onChange={(e) => setExtendForm({ ...extendForm, expiryDate: e.target.value })}
                  className="w-full border p-2 rounded-lg font-bold font-mono"
                />
              </div>

              <div>
                <label className="font-bold text-slate-500 block mb-1">Ghi chú gia hạn:</label>
                <input
                  type="text"
                  value={extendForm.note}
                  onChange={(e) => setExtendForm({ ...extendForm, note: e.target.value })}
                  className="w-full border p-2 rounded-lg"
                  placeholder="Gói gia hạn thường niên..."
                />
              </div>
            </div>

            <div className="px-5 py-4 bg-slate-50 border-t flex justify-end gap-3">
              <button onClick={() => setActiveUserToExtend(null)} className="border px-4 py-2 rounded-lg">Hủy</button>
              <button onClick={handleSaveExtension} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-lg">Gia hạn ngay ⏱️</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
