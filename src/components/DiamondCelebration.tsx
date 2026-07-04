import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface DiamondCelebrationProps {
  amount: number;
  reasons: string[];
  onDismiss: () => void;
}

// Small confetti-style burst of diamond emojis at random positions/delays —
// purely decorative, unmounts itself once the parent removes this component.
function DiamondBurst() {
  const pieces = React.useMemo(
    () => Array.from({ length: 18 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.5,
      duration: 1.4 + Math.random() * 0.8,
      size: 14 + Math.random() * 14,
    })),
    []
  );

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {pieces.map(p => (
        <motion.span
          key={p.id}
          initial={{ y: -20, x: `${p.left}%`, opacity: 0, rotate: 0 }}
          animate={{ y: '110%', opacity: [0, 1, 1, 0], rotate: 360 }}
          transition={{ duration: p.duration, delay: p.delay, ease: 'easeIn' }}
          className="absolute top-0"
          style={{ fontSize: p.size }}
        >
          💎
        </motion.span>
      ))}
    </div>
  );
}

// Celebration overlay shown whenever a completed exam/SRS session earns
// diamonds — layered above ExamRunner's score-summary modal. Auto-fades after
// a few seconds but can also be dismissed early.
export default function DiamondCelebration({ amount, reasons, onDismiss }: DiamondCelebrationProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 4200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence onExitComplete={onDismiss}>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-60 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setVisible(false)}
        >
          <DiamondBurst />

          <motion.div
            initial={{ scale: 0.6, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="relative bg-gradient-to-br from-cyan-500 to-indigo-600 rounded-3xl shadow-2xl p-8 text-center text-white max-w-sm w-full"
            onClick={e => e.stopPropagation()}
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.3, 1] }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="text-6xl mb-2"
            >
              💎
            </motion.div>
            <h3 className="text-2xl font-extrabold font-display tracking-tight">+{amount} Kim cương!</h3>
            <p className="text-cyan-100 text-xs mt-1 font-semibold">Chúc mừng bạn đã kiếm được phần thưởng 🎉</p>

            <div className="mt-4 space-y-1.5 text-left">
              {reasons.map((r, i) => (
                <motion.p
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.12 }}
                  className="bg-white/15 rounded-xl px-3 py-2 text-xs font-bold"
                >
                  {r}
                </motion.p>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setVisible(false)}
              className="mt-5 text-cyan-100 hover:text-white text-xs font-bold underline underline-offset-2 cursor-pointer"
            >
              Đóng
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
