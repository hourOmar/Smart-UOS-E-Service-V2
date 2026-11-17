import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { signInAndResolveRole, type LoginClient } from '../utils/loginFlow'
import loginBackground from '../assets/login-background.jpg'
import './LoginPage.css'

function LoginPage() {
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    setError('')
    setLoading(true)

    // Staff and students are identified by the signed-in user's Auth UID
    // (see utils/loginFlow.ts); an unlinked account is signed out again.
    // (The full Supabase client type is too deep to compare with LoginClient
    // structurally; it provides exactly the calls LoginClient lists.)
    const outcome = await signInAndResolveRole(supabase as unknown as LoginClient, email, password)

    if (outcome === 'invalid_credentials') {
      setError('Invalid email or password.')
      setLoading(false)
      return
    }

    if (outcome === 'staff') {
      setLoading(false)
      navigate('/admin')
      return
    }

    if (outcome === 'student') {
      setLoading(false)
      navigate('/student')
      return
    }

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

      <main className="login__stage">
        <div className="login__panel">
          <h1 id="login-title" className="login__product">
            Smart UoS E-Service
          </h1>

          <section aria-labelledby="login-title">
            <form
              className="login__form"
              onSubmit={handleLogin}
              aria-busy={loading}
            >
              <div className="login__field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  placeholder="Email"
                  autoComplete="username"
                  inputMode="email"
                  spellCheck={false}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-describedby={error ? 'login-error' : undefined}
                  required
                />
              </div>

              <div className="login__field login__field--password">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-describedby={error ? 'login-error' : undefined}
                  required
                />
                <button
                  type="button"
                  className="login__toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-controls="password"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
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
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </section>
        </div>
      </main>
    </div>
  )
}

export default LoginPage