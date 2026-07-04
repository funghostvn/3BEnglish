import React, { useState } from 'react';
import { collection, addDoc, increment } from 'firebase/firestore';
import { db } from '../firebase';
import { updateDocById } from '../services/firestore';
import { User, ExtensionLog } from '../types';
import { DIAMOND_VND_RATE, DIAMOND_EXTENSION_DAY_RATE } from '../constants';
import { X, Clock, Banknote, Gem } from 'lucide-react';

interface DiamondRedeemModalProps {
  currentUser: User;
  onClose: () => void;
  onUserUpdate: (patch: Partial<User>) => void;
  onShowModal: (config: { type: 'success' | 'warning' | 'danger' | 'info'; title: string; message: string }) => void;
}

function formatVnd(n: number): string {
  return n.toLocaleString('vi-VN') + 'đ';
}

export default function DiamondRedeemModal({ currentUser, onClose, onUserUpdate, onShowModal }: DiamondRedeemModalProps) {
  const [tab, setTab] = useState<'extension' | 'cashout'>('extension');
  const [days, setDays] = useState(1);
  const [cashoutDiamonds, setCashoutDiamonds] = useState(10);
  const [submitting, setSubmitting] = useState(false);

  const balance = currentUser.diamonds || 0;
  const extensionCost = days * DIAMOND_EXTENSION_DAY_RATE;
  const cashoutAmount = cashoutDiamonds * DIAMOND_VND_RATE;

  const handleExtensionSubmit = async () => {
    if (days <= 0 || extensionCost > balance) return;
    setSubmitting(true);
    try {
      const base = new Date(currentUser.expiresAt);
      const now = new Date();
      const startFrom = base.getTime() > now.getTime() ? base : now;
      const newExpiresAt = new Date(startFrom.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

      await updateDocById('users', currentUser.id, {
        diamonds: increment(-extensionCost),
        expiresAt: newExpiresAt,
      });

      const logPayload: Partial<ExtensionLog> = {
        userId: currentUser.id,
        username: currentUser.name,
        grade: currentUser.grade,
        extendedAt: now.toISOString(),
        extendedTo: newExpiresAt,
        note: `Học viên tự đổi ${extensionCost} kim cương lấy ${days} ngày gia hạn`,
        source: 'diamond_extension',
        diamondsSpent: extensionCost,
      };
      await addDoc(collection(db, 'extensions'), logPayload);

      onUserUpdate({ diamonds: balance - extensionCost, expiresAt: newExpiresAt });
      onShowModal({
        type: 'success',
        title: 'Gia hạn thành công 🎉',
        message: `Đã dùng ${extensionCost} 💎 để gia hạn tài khoản thêm ${days} ngày. Hạn dùng mới: ${new Date(newExpiresAt).toLocaleDateString()}.`,
      });
      onClose();
    } catch (err) {
      console.error(err);
      onShowModal({ type: 'danger', title: 'Gia hạn thất bại', message: 'Không thể xử lý yêu cầu. Vui lòng thử lại.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCashoutSubmit = async () => {
    if (cashoutDiamonds <= 0 || cashoutDiamonds > balance) return;
    setSubmitting(true);
    try {
      const logPayload: Partial<ExtensionLog> = {
        userId: currentUser.id,
        username: currentUser.name,
        grade: currentUser.grade,
        extendedAt: new Date().toISOString(),
        extendedTo: currentUser.expiresAt,
        note: `Yêu cầu đổi ${cashoutDiamonds} kim cương lấy ${formatVnd(cashoutAmount)} — chờ admin duyệt`,
        source: 'diamond_cashout',
        diamondsSpent: cashoutDiamonds,
        cashAmount: cashoutAmount,
        status: 'pending',
      };
      await addDoc(collection(db, 'extensions'), logPayload);

      onShowModal({
        type: 'success',
        title: 'Đã gửi yêu cầu 📨',
        message: `Yêu cầu đổi ${cashoutDiamonds} 💎 lấy ${formatVnd(cashoutAmount)} đang chờ admin duyệt. Kim cương sẽ được trừ sau khi yêu cầu được duyệt.`,
      });
      onClose();
    } catch (err) {
      console.error(err);
      onShowModal({ type: 'danger', title: 'Gửi yêu cầu thất bại', message: 'Không thể gửi yêu cầu. Vui lòng thử lại.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="bg-gradient-to-br from-cyan-600 to-indigo-700 p-6 text-white relative">
          <button onClick={onClose} className="absolute top-4 right-4 text-cyan-100 hover:text-white cursor-pointer">
            <X className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Gem className="h-6 w-6" />
            <h3 className="text-lg font-extrabold font-display tracking-tight">Đổi thưởng Kim cương</h3>
          </div>
          <p className="text-cyan-100 text-xs mt-1 font-semibold">Số dư hiện tại: {balance} 💎</p>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setTab('extension')}
              className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${tab === 'extension' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500'}`}
            >
              <Clock className="h-3.5 w-3.5" /> Gia hạn tài khoản
            </button>
            <button
              type="button"
              onClick={() => setTab('cashout')}
              className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${tab === 'cashout' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500'}`}
            >
              <Banknote className="h-3.5 w-3.5" /> Đổi tiền mặt
            </button>
          </div>

          {tab === 'extension' ? (
            <div className="space-y-3">
              <p className="text-slate-500 text-xs font-medium leading-relaxed">
                {DIAMOND_EXTENSION_DAY_RATE} 💎 = 1 ngày gia hạn. Áp dụng ngay, không cần chờ duyệt.
              </p>
              <div>
                <label className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">Số ngày muốn gia hạn</label>
                <input
                  type="number"
                  min={1}
                  value={days}
                  onChange={e => setDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex items-center justify-between text-xs font-bold bg-indigo-50 text-indigo-700 rounded-xl px-3.5 py-2.5">
                <span>Chi phí:</span>
                <span>{extensionCost} 💎 {extensionCost > balance && <span className="text-rose-600">(không đủ)</span>}</span>
              </div>
              <button
                type="button"
                disabled={submitting || extensionCost > balance || days <= 0}
                onClick={handleExtensionSubmit}
                className="w-full py-3 rounded-xl font-bold text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-all cursor-pointer active:scale-[0.98]"
              >
                {submitting ? 'Đang xử lý...' : 'Xác nhận đổi'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-slate-500 text-xs font-medium leading-relaxed">
                1 💎 = {formatVnd(DIAMOND_VND_RATE)}. Yêu cầu cần admin duyệt trước khi kim cương bị trừ và tiền được thanh toán.
              </p>
              <div>
                <label className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">Số kim cương muốn đổi</label>
                <input
                  type="number"
                  min={1}
                  max={balance}
                  value={cashoutDiamonds}
                  onChange={e => setCashoutDiamonds(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex items-center justify-between text-xs font-bold bg-emerald-50 text-emerald-700 rounded-xl px-3.5 py-2.5">
                <span>Số tiền quy đổi:</span>
                <span>{formatVnd(cashoutAmount)} {cashoutDiamonds > balance && <span className="text-rose-600">(không đủ)</span>}</span>
              </div>
              <button
                type="button"
                disabled={submitting || cashoutDiamonds > balance || cashoutDiamonds <= 0}
                onClick={handleCashoutSubmit}
                className="w-full py-3 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-all cursor-pointer active:scale-[0.98]"
              >
                {submitting ? 'Đang gửi...' : 'Gửi yêu cầu đổi tiền'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
