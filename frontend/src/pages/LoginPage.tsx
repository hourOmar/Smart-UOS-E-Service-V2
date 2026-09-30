import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import loginBackground from '../assets/login-background.jpg'
import logo from '../assets/logo.png'
import './LoginPage.css'

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
    <div className="login">
      <div className="login__photo">
        <img
          src={loginBackground}
          alt="The Main Building of the University of Sharjah"
          fetchPriority="high"
          decoding="async"
        />
      </div>

      <main className="login__slab">
        <div className="login__cornice" aria-hidden="true" />

        <div className="login__inner">
          <header className="login__brand">
            <img
              className="login__logo"
              src={logo}
              alt="University of Sharjah"
              width={187}
              height={134}
            />
            <span className="login__brand-rule" aria-hidden="true" />
            <p className="login__product">Smart UoS E-Service</p>
          </header>

          <section className="login__main" aria-labelledby="login-title">
            <h1 id="login-title" className="login__title">
              Welcome back
            </h1>
            <p className="login__lede">Sign in to continue</p>

            <form
              className="login__form"
              onSubmit={handleLogin}
              aria-busy={loading}
            >
              <div className="login__field">
                <label htmlFor="email">University Email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  spellCheck={false}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-describedby={error ? 'login-error' : undefined}
                  required
                />
              </div>

              <div className="login__field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-describedby={error ? 'login-error' : undefined}
                  required
                />
              </div>

              {error && (
                <p id="login-error" className="login__error" role="alert">
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M10 5.75v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <circle cx="10" cy="13.75" r="1" fill="currentColor" />
                  </svg>
                  <span>{error}</span>
                </p>
              )}

              <button className="login__submit" type="submit" disabled={loading}>
                {loading && (
                  <svg className="login__spinner" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
                    <path d="M17.5 10A7.5 7.5 0 0 0 10 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>
          </section>
        </div>
      </main>
    </div>
  )
}

export default LoginPage