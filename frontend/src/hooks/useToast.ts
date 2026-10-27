import { useCallback, useEffect, useRef, useState } from 'react'

// As in the prototype: a new message replaces the current one and each
// message dismisses itself after 3.8 seconds.
const TOAST_DURATION_MS = 3800

function useToast() {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current)
    setMessage(null)
  }, [])

  const show = useCallback((text: string) => {
    window.clearTimeout(timer.current)
    setMessage(text)
    timer.current = window.setTimeout(() => setMessage(null), TOAST_DURATION_MS)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return { message, show, dismiss }
}

export default useToast
