import { NavLink, Outlet } from 'react-router-dom';
import { Timer, BarChart2, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWeeklySummary } from '@/hooks/useSummary';
import { useTimer } from '@/hooks/useTimer';

const navItems = [
  { to: '/', icon: Timer, label: 'Track' },
  { to: '/weekly', icon: BarChart2, label: 'Weekly' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

function TimekeeperLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={className}
    >
      <rect x="4" y="4" width="56" height="56" rx="14" fill="#0B1220" />
      <circle cx="32" cy="32" r="18" fill="none" stroke="#17D4FF" strokeWidth="6" />
      <line x1="32" y1="32" x2="32" y2="21" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" />
      <line x1="32" y1="32" x2="44" y2="32" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" />
      <circle cx="32" cy="32" r="4.5" fill="#FFFFFF" />
      <path d="M22 41 L28.5 47.5 L42 34" fill="none" stroke="#7CFF6B" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatHHMM(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function WeeklyProgress() {
  const { data: summary } = useWeeklySummary();
  const { data: timerData } = useTimer();

  // Base: completed minutes from the weekly summary (excludes the running timer)
  const completedMinutes = summary?.totalMinutes ?? 0;

  // Add live elapsed minutes from the running timer (timer polls every 5s)
  const activeElapsedMinutes =
    timerData?.active && timerData.entry?.startTime
      ? Math.floor((Date.now() - new Date(timerData.entry.startTime).getTime()) / 60000)
      : 0;

  const totalMinutes = completedMinutes + activeElapsedMinutes;

  if (!summary) return null;

  return (
    <span className="font-mono text-sm tabular-nums text-muted-foreground">
      {formatHHMM(totalMinutes)}
      <span className="text-muted-foreground/50"> / 40</span>
    </span>
  );
}

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <TimekeeperLogo className="h-7 w-7 shrink-0" />
          <h1 className="text-base font-bold tracking-tight">Time Keeper</h1>
          <div className="ml-auto">
            <WeeklyProgress />
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <Outlet />
      </main>

      {/* Bottom nav — mobile-first */}
      <nav className="sticky bottom-0 border-t bg-card">
        <div className="flex">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-1 py-3 text-xs transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
