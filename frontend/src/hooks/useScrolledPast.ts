import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

// True once the given scroll container has scrolled more than `threshold`
// pixels. The student page scrolls inside its own container, not the window.
function useScrolledPast(
  containerRef: RefObject<HTMLElement | null>,
  threshold: number,
) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const update = () => setScrolled(container.scrollTop > threshold)

    update()
    container.addEventListener('scroll', update, { passive: true })

    return () => container.removeEventListener('scroll', update)
  }, [containerRef, threshold])

  return scrolled
}

export default useScrolledPast
