import { useId, useState } from 'react'

interface PasswordFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  error?: string
  autoComplete?: string
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
      <path
        d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
      <path
        d="M2.5 2.5l15 15M8.36 8.45a2.25 2.25 0 0 0 3.19 3.19M6.02 6.14C3.6 7.42 1.5 10 1.5 10s3 6 8.5 6c1.6 0 2.96-.5 4.08-1.16M9.5 4.04A9.6 9.6 0 0 1 10 4c5.5 0 8.5 6 8.5 6-.34.68-1.05 1.83-2.13 2.93"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function PasswordField({
  label,
  value,
  onChange,
  onBlur,
  error,
  autoComplete,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)
  const inputId = useId()
  const errorId = useId()

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-900">
        {label}
      </label>
      <div className="relative mt-1.5">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
            <rect
              x="4.5"
              y="9"
              width="11"
              height="7.5"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M6.75 9V6.75a3.25 3.25 0 0 1 6.5 0V9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className={`w-full rounded-lg border bg-white py-2.5 pl-10 pr-11 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 ease-out-strong placeholder:text-slate-400 focus:border-uos-green focus:ring-2 focus:ring-uos-green/20 ${
            error ? 'border-red-400' : 'border-slate-300'
          }`}
          placeholder="Enter your password"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute inset-y-0 right-2.5 flex items-center text-slate-400 transition-colors duration-150 ease-out-strong hover:text-slate-600"
        >
          <span className="grid [&>*]:col-start-1 [&>*]:row-start-1">
            <span
              className={`transition-opacity duration-[120ms] ease-out-strong ${visible ? 'opacity-0' : 'opacity-100'}`}
            >
              <EyeIcon />
            </span>
            <span
              className={`transition-opacity duration-[120ms] ease-out-strong ${visible ? 'opacity-100' : 'opacity-0'}`}
            >
              <EyeOffIcon />
            </span>
          </span>
        </button>
      </div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="mt-1.5 motion-safe:animate-fade-in-up-fast text-sm text-red-600"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
