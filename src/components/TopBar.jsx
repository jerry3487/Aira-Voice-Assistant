import { UserButton, useUser } from '@clerk/react';
import { Moon, Sun } from 'lucide-react';

const NAV_ITEMS = [
  { id: 'voice', label: 'Voice' },
  { id: 'models', label: 'Models' },
  { id: 'memory', label: 'Memory & Notes' },
];

export default function TopBar({
  activeTab,
  onTabChange,
  onNewChat,
  theme,
  onToggleTheme,
}) {
  const { user } = useUser();
  const displayName =
    user?.fullName ||
    user?.firstName ||
    user?.primaryEmailAddress?.emailAddress ||
    '';

  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur-sm dark:border-white/8 dark:bg-[#0A0D12]/90">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2.5 px-4 py-3 md:flex-nowrap md:gap-8 md:px-6 md:py-3.5">
        <a
          href="#voice"
          onClick={(e) => {
            e.preventDefault();
            onTabChange('voice');
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
        >
          Aira
        </a>

        <nav
          aria-label="Primary navigation"
          className="order-3 flex w-full items-center justify-between gap-3 overflow-x-auto border-t border-slate-100 pt-2 md:order-none md:w-auto md:justify-center md:gap-6 md:border-t-0 md:pt-0 dark:border-white/6"
        >
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => onTabChange(item.id)}
                className={`whitespace-nowrap shrink-0 border-b-2 py-1 text-xs font-medium sm:text-sm focus-visible:outline-2 focus-visible:outline-sky-500 ${
                  active
                    ? 'border-sky-600 text-slate-900 dark:border-sky-400 dark:text-slate-100'
                    : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          {displayName && (
            <span
              data-testid="signed-in-user"
              className="hidden max-w-36 truncate text-xs font-medium text-slate-600 lg:inline dark:text-slate-300"
            >
              {displayName}
            </span>
          )}

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
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

          <button
            type="button"
            onClick={onNewChat}
            className="whitespace-nowrap shrink-0 rounded-lg border border-slate-200 bg-slate-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 dark:border-white/12 dark:bg-[#111620] dark:text-slate-100 dark:hover:border-sky-400/50 dark:hover:bg-[#171E2C] focus-visible:outline-2 focus-visible:outline-sky-500"
          >
            New Session
          </button>

          <div className="flex items-center pl-0.5" data-testid="clerk-user-button">
            <UserButton />
          </div>
        </div>
      </div>
    </header>
  );
}
