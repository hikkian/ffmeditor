import { AnimatePresence, motion } from 'framer-motion';
import useStore from '../store';

export default function ErrorToast() {
  const error = useStore((s) => s.error);
  const clearError = useStore((s) => s.clearError);

  return (
    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.95 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-md"
        >
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-[var(--color-error-muted)] border border-[var(--color-error)]/30 backdrop-blur-lg shadow-2xl shadow-[var(--color-error)]/10">
            <svg className="w-5 h-5 text-[var(--color-error)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <span className="text-sm text-[var(--color-error)] font-medium">{error}</span>
            <button
              onClick={clearError}
              className="ml-2 text-[var(--color-error)]/60 hover:text-[var(--color-error)] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
