import campusPhoto from '../../assets/campus-placeholder.webp'
import uosLogo from '../../assets/uos-logo.png'
import { LoginForm } from './LoginForm'

// Placeholder brand mark — an abstract dome pictogram standing in for the
// official University of Sharjah logo, which is not part of this repository yet.
function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 44 44" aria-hidden="true" className={className}>
      <circle cx="22" cy="22" r="21" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="14" y="24" width="16" height="8" rx="1" fill="currentColor" />
      <path d="M14 24a8 8 0 0 1 16 0z" fill="currentColor" />
      <rect x="20.5" y="10" width="3" height="6" fill="currentColor" />
    </svg>
  )
}

// Subtle decorative background — an authored Islamic geometric motif (interlocking
// 8-pointed stars from two overlapping squares), faded from the bottom-right corner.
// Purely decorative: aria-hidden and pointer-events-none.
function GeometricPattern() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute inset-0 h-full w-full text-slate-300"
    >
      <defs>
        <pattern id="uos-geo-pattern" width="56" height="56" patternUnits="userSpaceOnUse">
          <rect x="12" y="12" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1" />
          <rect
            x="12"
            y="12"
            width="32"
            height="32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            transform="rotate(45 28 28)"
          />
        </pattern>
        <radialGradient id="uos-geo-fade" cx="100%" cy="100%" r="85%">
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="55%" stopColor="white" stopOpacity="1" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id="uos-geo-mask">
          <rect width="100%" height="100%" fill="url(#uos-geo-fade)" />
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill="url(#uos-geo-pattern)"
        mask="url(#uos-geo-mask)"
        opacity="0.6"
      />
    </svg>
  )
}

function BrandPanel() {
  return (
    <>
      <aside className="relative hidden w-full shrink-0 overflow-hidden bg-uos-green lg:flex lg:w-[70%] lg:flex-col lg:items-start lg:p-12">
        <img
          src={campusPhoto}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(10,43,32,0.35)_0%,rgba(10,43,32,0)_22%,rgba(10,43,32,0)_100%)]" />
        <img
          src={uosLogo}
          alt="University of Sharjah"
          className="relative h-16 w-auto"
        />
      </aside>

      <div className="flex items-center gap-3 bg-uos-green px-6 py-5 lg:hidden">
        <BrandMark className="h-9 w-9 text-white" />
        <span className="font-serif text-lg text-white">Smart UoS E-Service</span>
      </div>
    </>
  )
}

export function LoginPage() {
  return (
    <div className="flex min-h-svh flex-col lg:flex-row">
      <BrandPanel />
      <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
        <GeometricPattern />
        <div className="relative w-full max-w-md">
          <div className="motion-safe:animate-fade-in-up rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200 sm:p-10 lg:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Welcome to
            </p>
            <h1 className="mt-2 font-serif text-3xl text-slate-900 lg:text-2xl">Smart UoS E-Service</h1>
            <p className="mt-2 text-sm text-slate-500">
              Sign in to access your academic services
            </p>
            <div className="mt-8">
              <LoginForm />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
