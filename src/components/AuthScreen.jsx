import { useState } from 'react';
import { ClerkFailed, ClerkLoaded, ClerkLoading, SignIn, SignUp } from '@clerk/react';
import { Moon, Sun } from 'lucide-react';

export default function AuthScreen({ theme, onToggleTheme }) {
  const [mode, setMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('mode') === 'signup') {
        return 'signup';
      }
    }
    return 'signin';
  });

  const switchMode = (nextMode) => {
    setMode(nextMode);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.hash = '';
      if (nextMode === 'signup') {
        url.searchParams.set('mode', 'signup');
      } else {
        url.searchParams.delete('mode');
      }
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const signInUrl = origin ? `${origin}/` : '/';
  const signUpUrl = origin ? `${origin}/?mode=signup` : '/?mode=signup';

  const clerkAppearance = {
    variables:
      theme === 'dark'
        ? {
            colorPrimary: '#38bdf8',
            colorPrimaryForeground: '#082f49',
            colorBackground: '#111620',
            colorForeground: '#f1f5f9',
            colorMuted: '#1a2232',
            colorMutedForeground: '#94a3b8',
            colorNeutral: '#f1f5f9',
            colorInput: '#0a0d12',
            colorInputForeground: '#f1f5f9',
            colorBorder: 'rgba(255, 255, 255, 0.14)',
            colorRing: '#38bdf8',
            borderRadius: '0.5rem',
          }
        : {
            colorPrimary: '#0284c7',
            colorPrimaryForeground: '#ffffff',
            colorBackground: '#ffffff',
            colorForeground: '#0f172a',
            colorMuted: '#f1f5f9',
            colorMutedForeground: '#475569',
            colorNeutral: '#0f172a',
            colorInput: '#f8fafc',
            colorInputForeground: '#0f172a',
            colorBorder: '#cbd5e1',
            colorRing: '#0284c7',
            borderRadius: '0.5rem',
          },
    elements: {
      rootBox: 'w-full flex justify-center',
      cardBox: 'w-full shadow-none border-0',
      card: 'w-full shadow-none border-0 p-0',
      headerTitle: 'font-display',
      formButtonPrimary: 'shadow-none font-semibold',
      socialButtonsBlockButton:
        theme === 'dark'
          ? 'border border-white/15 bg-[#0a0d12] text-slate-100 hover:bg-white/5'
          : 'border border-slate-200 bg-slate-50 text-slate-900 hover:bg-slate-100',
    },
  };

  return (
    <div className="min-h-screen bg-[#F5F4F0] text-slate-900 transition-colors dark:bg-[#0A0D12] dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur-sm dark:border-white/8 dark:bg-[#0A0D12]/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 md:px-6">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Aira
          </span>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            data-testid="theme-toggle-button"
            className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 transition-colors hover:border-sky-500/50 hover:text-slate-900 dark:border-white/12 dark:bg-[#111620] dark:text-slate-200 dark:hover:text-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="h-3.5 w-3.5 text-amber-400" />
                <span>Light</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5 text-sky-600" />
                <span>Dark</span>
              </>
            )}
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl grid-cols-1 items-stretch gap-8 px-4 py-10 md:px-6 lg:grid-cols-12 lg:py-14">
        {/* Left: Editorial Acoustic Studio Identity */}
        <section
          aria-label="About Aira"
          className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-8 dark:border-white/8 dark:bg-[#111620] lg:col-span-6"
        >
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-sky-600 dark:text-sky-400">
              Voice Intelligence Studio
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-slate-100">
              Meet Aira, your private voice assistant.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Speak naturally in English, Tamil, Hindi, Telugu, Malayalam, Kannada, Spanish, or French. Sign in with Clerk to unlock real-time voice conversations, memories, notes, and tasks.
            </p>
          </div>

          <div className="my-8 flex items-center justify-center">
            <svg
              viewBox="0 0 220 220"
              className="h-44 w-44 text-sky-600 dark:text-sky-400"
              aria-hidden="true"
            >
              <circle cx="110" cy="110" r="98" fill="none" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1" />
              <circle cx="110" cy="110" r="76" fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.25" strokeDasharray="4 6" />
              <circle cx="110" cy="110" r="54" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" />
              <circle cx="110" cy="110" r="28" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="110" cy="110" r="4" fill="currentColor" />
            </svg>
          </div>

          <dl className="grid grid-cols-3 gap-4 border-t border-slate-200 pt-5 text-xs dark:border-white/8">
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Languages</dt>
              <dd className="mt-1 font-mono font-semibold text-slate-900 dark:text-slate-100">
                8 Supported
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Voice</dt>
              <dd className="mt-1 font-mono font-semibold text-slate-900 dark:text-slate-100">
                Full-Duplex
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Auth</dt>
              <dd className="mt-1 font-mono font-semibold text-slate-900 dark:text-slate-100">
                Clerk Secured
              </dd>
            </div>
          </dl>
        </section>

        {/* Right: Clerk Sign In / Sign Up Card */}
        <section
          aria-label="Clerk Authentication"
          className="flex flex-col justify-center rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-white/8 dark:bg-[#111620] lg:col-span-6"
        >
          <div className="mb-6 flex border-b border-slate-200 dark:border-white/8">
            <button
              type="button"
              onClick={() => switchMode('signin')}
              data-testid="tab-signin"
              className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-sky-500 ${
                mode === 'signin'
                  ? 'border-sky-600 text-slate-900 dark:border-sky-400 dark:text-slate-100'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => switchMode('signup')}
              data-testid="tab-signup"
              className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-sky-500 ${
                mode === 'signup'
                  ? 'border-sky-600 text-slate-900 dark:border-sky-400 dark:text-slate-100'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Sign Up
            </button>
          </div>

          <ClerkLoading>
            <div className="flex min-h-[320px] items-center justify-center text-xs font-mono text-slate-500 dark:text-slate-400">
              Loading Clerk authentication...
            </div>
          </ClerkLoading>

          <ClerkFailed>
            <div
              role="alert"
              className="rounded-lg border border-red-500/35 bg-red-500/10 p-4 text-xs text-red-700 dark:text-red-200"
            >
              Could not load Clerk authentication. Check your network connection or Clerk publishable key.
            </div>
          </ClerkFailed>

          <ClerkLoaded>
            <div className="flex justify-center" data-testid="clerk-auth-widget">
              {mode === 'signup' ? (
                <SignUp
                  key="clerk-signup"
                  routing="hash"
                  signInUrl={signInUrl}
                  fallbackRedirectUrl="/"
                  appearance={clerkAppearance}
                />
              ) : (
                <SignIn
                  key="clerk-signin"
                  routing="hash"
                  signUpUrl={signUpUrl}
                  fallbackRedirectUrl="/"
                  appearance={clerkAppearance}
                />
              )}
            </div>
          </ClerkLoaded>
        </section>
      </main>
    </div>
  );
}
