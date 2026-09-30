import { useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'

function StudentDashboard() {
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <main>
      <h1>Student Dashboard</h1>

      <button onClick={handleSignOut}>
        Sign Out
      </button>
    </main>
  )
}

export default StudentDashboard