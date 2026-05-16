import { NavLink, Outlet } from 'react-router-dom';
import { Timer, BarChart2, Calendar, RefreshCw, Settings, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWeeklySummary } from '@/hooks/useSummary';
import { useTimer } from '@/hooks/useTimer';
import { useAppStatus } from '@/lib/appStatusContext';

const navItems = [
  { to: '/', icon: Timer, label: 'Track' },
  { to: '/weekly', icon: BarChart2, label: 'Weekly' },
  { to: '/monthly', icon: Calendar, label: 'Monthly' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

function TimekeeperLogo({ className }: { className?: string }) {
  return (
    <img
      src="/icons/timekeeper.svg"
      alt="Time Keeper"
      className={className}
      aria-hidden="true"
    />
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
  const isActive = timerData?.active;

  if (!summary) return null;

  const timeStr = formatHHMM(totalMinutes);
  const [hours, minutes] = timeStr.split(':');

  return (
    <span className={cn("font-mono text-sm tabular-nums", isActive && "font-bold text-foreground")}>
      {hours}
      <span className={isActive ? "animate-blink" : "text-muted-foreground"}>{':'}</span>
      {minutes}
      <span className="text-muted-foreground/50"> / {goalHours}</span>
    </span>
  );
}

export function Layout() {
  const { isOnline, recentlyReconnected, updateAvailable, applyingUpdate, applyUpdate, dismissUpdate } = useAppStatus();

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

      {(!isOnline || recentlyReconnected || updateAvailable) && (
        <div className="space-y-2 border-b bg-card px-4 py-3">
          {!isOnline && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-400/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-100">
              <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">You are offline.</p>
                <p className="text-xs opacity-80">The timer and summaries need connectivity for fresh data. Reconnect to resume syncing.</p>
              </div>
            </div>
          )}

          {isOnline && recentlyReconnected && (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-400/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-700/40 dark:bg-emerald-950/30 dark:text-emerald-100">
              <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Back online.</p>
                <p className="text-xs opacity-80">Refreshing timer, weekly, monthly, and entry data now.</p>
              </div>
            </div>
          )}

          {updateAvailable && (
            <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">New version available.</p>
                <p className="text-xs text-muted-foreground">Reload when ready to switch to the latest cached app shell.</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                  onClick={dismissUpdate}
                  disabled={applyingUpdate}
                >
                  Later
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  onClick={applyUpdate}
                  disabled={applyingUpdate}
                >
                  {applyingUpdate ? 'Reloading…' : 'Reload now'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

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
