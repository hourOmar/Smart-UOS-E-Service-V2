import { BrowserRouter, Route, Routes } from 'react-router-dom'

import ProtectedRoute from './components/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import StudentDashboard from './pages/StudentDashboard'
import StudentServiceDetails from './pages/StudentServiceDetails'
import RaiseCapacityForm from './pages/RaiseCapacityForm'
import MyRequests from './pages/MyRequests'
import MyProfile from './pages/MyProfile'
import StudentRequestDetails from './pages/StudentRequestDetails'
import AdminDashboard from './pages/AdminDashboard'
import AdminTypeRequests from './pages/AdminTypeRequests'
import AdminRaiseCapacityReview from './pages/AdminRaiseCapacityReview'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />

        <Route
          path="/student"
          element={
            <ProtectedRoute requiredRole="student">
              <StudentDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/student/services/raise-capacity/new"
          element={
            <ProtectedRoute requiredRole="student">
              <RaiseCapacityForm />
            </ProtectedRoute>
          }
        />

        <Route
          path="/student/profile"
          element={
            <ProtectedRoute requiredRole="student">
              <MyProfile />
            </ProtectedRoute>
          }
        />

        <Route
          path="/student/requests"
          element={
            <ProtectedRoute requiredRole="student">
              <MyRequests />
            </ProtectedRoute>
          }
        />

        <Route
          path="/student/requests/:requestId"
          element={
            <ProtectedRoute requiredRole="student">
              <StudentRequestDetails />
            </ProtectedRoute>
          }
        />

        <Route
          path="/student/services/:serviceId"
          element={
            <ProtectedRoute requiredRole="student">
              <StudentServiceDetails />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin"
          element={
            <ProtectedRoute requiredRole="admin">
              <AdminDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/requests/raise-capacity/:requestId"
          element={
            <ProtectedRoute requiredRole="admin">
              <AdminRaiseCapacityReview />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/requests/:typeId"
          element={
            <ProtectedRoute requiredRole="admin">
              <AdminTypeRequests />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App