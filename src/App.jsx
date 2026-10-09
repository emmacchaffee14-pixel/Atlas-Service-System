import { Navigate, Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing.jsx'
import AccountSetup from './pages/AccountSetup.jsx'
import AdminLayout from './components/AdminLayout.jsx'
import Dashboard from './pages/admin/Dashboard.jsx'
import Members from './pages/admin/Members.jsx'
import Groups from './pages/admin/Groups.jsx'
import Events from './pages/admin/Events.jsx'
import ServiceLogs from './pages/admin/ServiceLogs.jsx'
import Contacts from './pages/admin/Contacts.jsx'
import Nominations from './pages/admin/Nominations.jsx'
import Files from './pages/admin/Files.jsx'
import AdminMessages from './pages/admin/Messages.jsx'
import Settings from './pages/admin/Settings.jsx'
import MemberLayout from './components/MemberLayout.jsx'
import Opportunities from './pages/member/Opportunities.jsx'
import Signup from './pages/member/Signup.jsx'
import LogService from './pages/member/LogService.jsx'
import Nominate from './pages/member/Nominate.jsx'
import MemberMessages from './pages/member/Messages.jsx'
import Standing from './pages/member/Standing.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/setup" element={<AccountSetup />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="members" element={<Members />} />
        <Route path="groups" element={<Groups />} />
        <Route path="events" element={<Events />} />
        <Route path="logs" element={<ServiceLogs />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="nominations" element={<Nominations />} />
        <Route path="messages" element={<AdminMessages />} />
        <Route path="files" element={<Files />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="/member" element={<MemberLayout />}>
        <Route index element={<Navigate to="opportunities" replace />} />
        <Route path="opportunities" element={<Opportunities />} />
        <Route path="signup/:eventId" element={<Signup />} />
        <Route path="log" element={<LogService />} />
        <Route path="messages" element={<MemberMessages />} />
        <Route path="nominate" element={<Nominate />} />
        <Route path="standing" element={<Standing />} />
      </Route>
    </Routes>
  )
}
