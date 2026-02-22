import { ExternalLink } from 'lucide-react';
import { useInfo } from '@/hooks/useInfo';

export function AboutSection() {
  const { data, isLoading } = useInfo();

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">About</h2>

      <div className="rounded-lg border bg-card px-4 py-3 space-y-3 text-sm">
        {/* Logged-in user */}
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Signed in as</span>
          <span className="font-medium truncate">
            {isLoading ? '…' : (data?.user ?? '—')}
          </span>
        </div>

        {/* Version */}
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Version</span>
          <span className="font-mono font-medium">
            {isLoading ? '…' : (data?.version ?? '—')}
          </span>
        </div>

        {/* GitHub link */}
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Source</span>
          <a
            href={data?.repoUrl ?? 'https://github.com/niels-emmer/time-keeper'}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-medium text-primary hover:underline"
          >
            GitHub
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {/* Wiki link */}
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Docs</span>
          <a
            href="https://github.com/niels-emmer/time-keeper/wiki"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-medium text-primary hover:underline"
          >
            Wiki
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
