import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// Last-resort guard so a render crash shows a friendly recovery screen
// instead of a silent blank page (class component: React error boundaries
// have no hook equivalent).
export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // This repo has no @types/react, so `React.Component` types as `any` and TS
  // can't see inherited members — declare the ones we use explicitly.
  declare readonly props: ErrorBoundaryProps;
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans antialiased">
          <div className="bg-white border border-slate-200 rounded-3xl shadow-xl max-w-md w-full p-8 text-center space-y-4">
            <div className="text-4xl">😵</div>
            <h1 className="text-slate-900 font-extrabold text-lg">Rất tiếc, đã xảy ra lỗi hiển thị</h1>
            <p className="text-slate-500 text-xs leading-relaxed">
              Ứng dụng gặp sự cố ngoài ý muốn. Bạn hãy tải lại trang để tiếp tục — dữ liệu bài làm gần nhất
              (nếu đang làm dở) đã được lưu tự động và có thể khôi phục.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl text-sm transition-all active:scale-98 cursor-pointer"
            >
              Tải lại trang
            </button>
            <p className="text-[10px] text-slate-400 font-mono break-all">{this.state.error.message}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
