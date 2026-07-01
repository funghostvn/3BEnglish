import React from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  type?: 'info' | 'success' | 'warning' | 'danger' | 'confirm';
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  onClose: () => void;
}

export default function Modal({
  isOpen,
  type = 'info',
  title,
  message,
  confirmText = 'Đồng ý',
  cancelText = 'Hủy',
  onConfirm,
  onCancel,
  onClose,
}: ModalProps) {
  if (!isOpen) return null;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle className="h-6 w-6 text-green-500" />;
      case 'warning':
      case 'confirm':
        return <AlertCircle className="h-6 w-6 text-amber-500" />;
      case 'danger':
        return <AlertCircle className="h-6 w-6 text-red-500" />;
      default:
        return <Info className="h-6 w-6 text-blue-500" />;
    }
  };

  const getHeaderColor = () => {
    switch (type) {
      case 'success':
        return 'bg-green-50 border-green-200';
      case 'warning':
      case 'confirm':
        return 'bg-amber-50 border-amber-200';
      case 'danger':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-blue-50 border-blue-200';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden border border-slate-200/60 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${getHeaderColor()}`}>
          <div className="flex items-center gap-3">
            {getIcon()}
            <h3 className="font-bold font-display text-slate-900 text-base tracking-tight">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 rounded-lg p-1.5 hover:bg-slate-100/55 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6">
          <p className="text-slate-600 text-xs font-medium leading-relaxed whitespace-pre-line">{message}</p>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          {type === 'confirm' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  if (onCancel) onCancel();
                  onClose();
                }}
                className="px-4 py-2 border border-slate-200 text-slate-600 bg-white rounded-xl hover:bg-slate-50 text-xs font-bold transition-all cursor-pointer shadow-2xs"
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onConfirm) onConfirm();
                  onClose();
                }}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 text-xs font-bold shadow-sm cursor-pointer transition-all active:scale-95"
              >
                {confirmText}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer transition-all active:scale-95"
            >
              Đóng
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
