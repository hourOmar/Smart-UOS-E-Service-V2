import { useEffect, useState, type ReactNode } from 'react'

// Small pieces of the student request details page: outline icons in the
// page's stroke style, and the copy-to-clipboard button for the request ID.

type IconName = 'file' | 'calendar' | 'details' | 'progress' | 'copy' | 'check' | 'cross'

const ICONS: Record<IconName, ReactNode> = {
  file: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M9 8.5h6M9 12h6M9 15.5h3.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01" />
    </>
  ),
  details: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ),
  progress: (
    <>
      <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" />
      <path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h8" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  cross: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
}

export function DetailIcon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {ICONS[name]}
    </svg>
  )
}

// Copies the request ID. The result is announced; where the browser offers no
// clipboard (e.g. an insecure context) it says so instead of failing silently.
export function CopyRequestId({ requestId }: { requestId: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => setState('idle'), 2000)
    return () => window.clearTimeout(timer)
  }, [state])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(requestId)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <>
      <button
        type="button"
        className="req-copy"
        onClick={() => void copy()}
        aria-label={`Copy request ID ${requestId}`}
        title="Copy request ID"
      >
        <DetailIcon name={state === 'copied' ? 'check' : 'copy'} />
      </button>
      <span className="req-copy__status" role="status" aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy unavailable' : ''}
      </span>
    </>
  )
}
