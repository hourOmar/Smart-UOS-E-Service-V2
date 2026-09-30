import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'

function LoginPage() {
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    setError('')
    setLoading(true)

    const { data, error: loginError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      })

    if (loginError || !data.user) {
      setError('Invalid email or password.')
      setLoading(false)
      return
    }

    const { data: staff } = await supabase
      .from('Authorized_Staff')
      .select('Staff_ID')
      .eq('Auth_User_ID', data.user.id)
      .maybeSingle()

    if (staff) {
      setLoading(false)
      navigate('/admin')
      return
    }

    const { data: student } = await supabase
      .from('Student')
      .select('Student_ID')
      .eq('Student_Email', data.user.email)
      .maybeSingle()

    if (student) {
      setLoading(false)
      navigate('/student')
      return
    }

    await supabase.auth.signOut()
    setError('This account is not registered as a student or authorized staff member.')
    setLoading(false)
  }

  return (
    <main>
      <h1>Smart UoS E-Service</h1>

      <form onSubmit={handleLogin}>
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        <button type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>

        {error && <p>{error}</p>}
      </form>
    </main>
  )
}

export default LoginPage