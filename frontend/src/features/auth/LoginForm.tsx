import { useState, type FormEvent } from 'react'
import { PasswordField } from './PasswordField'
import { validateLoginForm, type LoginFormErrors, type LoginFormValues } from './validation'

const EMPTY_VALUES: LoginFormValues = { email: '', password: '' }

export function LoginForm() {
  const [values, setValues] = useState<LoginFormValues>(EMPTY_VALUES)
  const [errors, setErrors] = useState<LoginFormErrors>({})
  const [touched, setTouched] = useState<{ email: boolean; password: boolean }>({
    email: false,
    password: false,
  })
  const [showNotice, setShowNotice] = useState(false)

  function runValidation(nextValues: LoginFormValues) {
    const nextErrors = validateLoginForm(nextValues)
    setErrors(nextErrors)
    return nextErrors
  }

  function handleBlur(field: keyof LoginFormValues) {
    setTouched((current) => ({ ...current, [field]: true }))
    runValidation(values)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTouched({ email: true, password: true })
    setShowNotice(false)

    const nextErrors = runValidation(values)
    const hasErrors = Object.keys(nextErrors).length > 0
    if (hasErrors) return

    // Sign-in is intentionally not wired to Supabase yet. Validation is real;
    // authentication is not. Do not simulate success, a loading state, or a redirect here.
    setShowNotice(true)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="motion-safe:animate-fade-in-up space-y-5">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-900">
          University Email
        </label>
        <div className="relative mt-1.5">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
              <rect
                x="2.5"
                y="4.5"
                width="15"
                height="11"
                rx="1.5"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="m3.5 5.5 6.5 5 6.5-5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={values.email}
            onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))}
            onBlur={() => handleBlur('email')}
            aria-invalid={Boolean(touched.email && errors.email)}
            aria-describedby={touched.email && errors.email ? 'email-error' : undefined}
            placeholder="e.g. U20201234@sharjah.ac.ae"
            className={`w-full rounded-lg border bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 ease-out-strong placeholder:text-slate-400 focus:border-uos-green focus:ring-2 focus:ring-uos-green/20 ${
              touched.email && errors.email ? 'border-red-400' : 'border-slate-300'
            }`}
          />
        </div>
        {touched.email && errors.email ? (
          <p
            id="email-error"
            role="alert"
            className="mt-1.5 motion-safe:animate-fade-in-up-fast text-sm text-red-600"
          >
            {errors.email}
          </p>
        ) : (
          <p className="mt-1.5 text-sm text-slate-500">Use your University of Sharjah email address</p>
        )}
      </div>

      <PasswordField
        label="Password"
        value={values.password}
        onChange={(next) => setValues((current) => ({ ...current, password: next }))}
        onBlur={() => handleBlur('password')}
        autoComplete="current-password"
        error={touched.password && errors.password ? errors.password : undefined}
      />

      <button
        type="submit"
        className="ease-out-strong w-full rounded-lg bg-uos-green py-3 text-sm font-semibold text-white shadow-sm transition-[transform,background-color] duration-150 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-uos-green-dark active:scale-[0.98]"
      >
        Sign In
      </button>

      {showNotice ? (
        <p
          role="status"
          className="motion-safe:animate-fade-in-up-fast rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"
        >
          Sign-in isn&apos;t connected yet. Authentication will be enabled once this form is wired up to Supabase.
        </p>
      ) : null}
    </form>
  )
}
