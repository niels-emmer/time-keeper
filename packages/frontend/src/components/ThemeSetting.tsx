import { Moon, Monitor, Sun } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

const OPTIONS: { value: Theme; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

export function ThemeSetting() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Appearance</h2>

      <div className="rounded-lg border bg-card px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="font-medium">Theme</span>
            <p className="text-muted-foreground text-xs mt-0.5">
              Choose a colour scheme or follow your system setting
            </p>
          </div>

          <div
            className="flex rounded-md border overflow-hidden shrink-0"
            role="group"
            aria-label="Theme"
          >
            {OPTIONS.map(({ value, label, Icon }, i) => (
              <button
                key={value}
                type="button"
                aria-pressed={theme === value}
                onClick={() => setTheme(value)}
                className={[
                  'flex items-center gap-1.5 px-3 py-1 text-sm font-medium transition-colors',
                  theme === value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted',
                  i < OPTIONS.length - 1 ? 'border-r' : '',
                ].join(' ')}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
