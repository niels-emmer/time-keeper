import { Link } from 'react-router-dom';
import { ChevronRight, UserRound } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthContext } from '@/lib/authContext';

/**
 * Settings → Account entry point (Phase C).
 *
 * The self-service surfaces (profile, password, devices, deletion) live on their
 * own route; Settings keeps its existing sections and links there rather than
 * growing another four panels inline.
 */
export function AccountSetting() {
  const { user } = useAuthContext();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRound className="h-4 w-4" />
          Account
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Your profile, password, signed-in devices and account deletion.
        </p>

        {user && (
          <p className="mb-4 text-sm">
            <span className="font-medium">{user.username}</span>
            <span className="text-muted-foreground"> · {user.email}</span>
          </p>
        )}

        <Link
          to="/account"
          className="inline-flex h-9 items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Manage account
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}
