import { createContext, useCallback, useContext, useRef, useState } from 'react'
import Toast from '../components/Toast.jsx'

const ToastContext = createContext(null)

// Lives above <Routes>, not inside any one page — a page that calls
// toast() and immediately navigates (claim, file a log, submit a
// nomination) must not lose the message when it unmounts.
export function ToastProvider({ children }) {
  const [message, setMessage] = useState(null)
  const timer = useRef(null)

  const toast = useCallback((m) => {
    setMessage(m)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(null), 3800)
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <Toast message={message} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const toast = useContext(ToastContext)
  if (!toast) throw new Error('useToast must be used within ToastProvider')
  return toast
}
