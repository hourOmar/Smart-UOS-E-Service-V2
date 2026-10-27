interface ToastProps {
  message: string | null
  onDismiss: () => void
}

// Bottom-centre notice (prototype), e.g. for a service that is not offered
// yet. The live region stays mounted so every new message is announced.
function Toast({ message, onDismiss }: ToastProps) {
  return (
    <div className="student-toast-region" role="status" aria-live="polite">
      {message && (
        <div className="student-toast">
          <span>{message}</span>
          <button
            type="button"
            className="student-toast__close"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

export default Toast
