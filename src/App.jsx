import { Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing.jsx'
import AccountSetup from './pages/AccountSetup.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/setup" element={<AccountSetup />} />
    </Routes>
  )
}
