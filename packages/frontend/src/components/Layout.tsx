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
      <defs>
        <linearGradient id="tk-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0F1E35" />
          <stop offset="100%" stopColor="#0A1628" />
        </linearGradient>
        <linearGradient id="tk-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#00D4FF" />
          <stop offset="100%" stopColor="#0099CC" />
        </linearGradient>
      </defs>
      {/* Rounded square background */}
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#tk-bg)" />
      {/* Subtle inner highlight */}
      <rect x="2" y="2" width="60" height="60" rx="16" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      {/* Clock ring */}
      <circle cx="32" cy="32" r="17" fill="none" stroke="url(#tk-ring)" strokeWidth="3.5" />
      {/* Hour markers */}
      <circle cx="32" cy="17" r="1.5" fill="#00D4FF" opacity="0.7" />
      <circle cx="47" cy="32" r="1.5" fill="#00D4FF" opacity="0.7" />
      <circle cx="32" cy="47" r="1.5" fill="#00D4FF" opacity="0.7" />
      <circle cx="17" cy="32" r="1.5" fill="#00D4FF" opacity="0.7" />
      {/* Minute hand — ~10 o'clock */}
      <line x1="32" y1="32" x2="22.5" y2="19.5" stroke="#E8F4FF" strokeWidth="2.5" strokeLinecap="round" />
      {/* Hour hand — ~2 o'clock */}
      <line x1="32" y1="32" x2="40" y2="25" stroke="#FFAA00" strokeWidth="3" strokeLinecap="round" />
      {/* Center pivot */}
      <circle cx="32" cy="32" r="3" fill="#FFAA00" />
      <circle cx="32" cy="32" r="1.5" fill="#FFD966" />
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
  const goalHours = summary ? summary.goalMinutes / 60 : 40;

  if (!summary) return null;

  return (
    <span className="font-mono text-sm tabular-nums text-muted-foreground">
      {formatHHMM(totalMinutes)}
      <span className="text-muted-foreground/50"> / {goalHours}</span>
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
