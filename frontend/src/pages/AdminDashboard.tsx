import { useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'

function AdminDashboard() {
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <main>
      <h1>Admin Dashboard</h1>

      <button onClick={handleSignOut}>
        Sign Out
      </button>
    </main>
  )
}

export default AdminDashboard