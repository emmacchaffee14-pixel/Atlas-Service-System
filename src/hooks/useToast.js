import { useCallback, useRef, useState } from 'react'

export function useToast() {
  const [message, setMessage] = useState(null)
  const timer = useRef(null)

  const toast = useCallback((m) => {
    setMessage(m)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(null), 3800)
  }, [])

  return [message, toast]
}
