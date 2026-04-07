import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Copy, Check, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';

type TokenRow = { id: number; label: string; createdAt: string; lastUsedAt: string | null };

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function ApiTokenManager() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeId, setRevokeId] = useState<number | null>(null);

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ['tokens'],
    queryFn: () => api.tokens.list(),
  });

  const createMutation = useMutation({
    mutationFn: (lbl: string) => api.tokens.create(lbl),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['tokens'] });
      setNewToken(data.token);
      setLabel('');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) => api.tokens.revoke(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tokens'] });
      setRevokeId(null);
    },
  });

  function handleCreate() {
    if (label.trim()) createMutation.mutate(label.trim());
  }

  function handleCopy() {
    if (!newToken) return;
    navigator.clipboard.writeText(newToken).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleCloseCreate() {
    setCreateOpen(false);
    setNewToken(null);
    setLabel('');
    setCopied(false);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            Personal Access Tokens
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" />
            New token
          </Button>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Tokens allow the macOS app to access the API without going through the browser login
            flow. Each token is shown only once — copy it immediately after creation.
          </p>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tokens yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Label</th>
                  <th className="pb-2 font-medium">Created</th>
                  <th className="pb-2 font-medium">Last used</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {tokens.map((t: TokenRow) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{t.label}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{formatDate(t.createdAt)}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{formatDate(t.lastUsedAt)}</td>
                    <td className="py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        onClick={() => setRevokeId(t.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Create token dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) handleCloseCreate(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New personal access token</DialogTitle>
          </DialogHeader>

          {!newToken ? (
            <>
              <div className="space-y-2 py-2">
                <label className="text-sm font-medium">Label</label>
                <Input
                  placeholder="e.g. macOS app"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  maxLength={64}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Give the token a name so you can identify it later.
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleCloseCreate}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!label.trim() || createMutation.isPending}
                >
                  Generate token
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="space-y-3 py-2">
                <p className="text-sm text-muted-foreground">
                  Copy your token now — it will not be shown again.
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={newToken}
                    className="font-mono text-xs"
                    onFocus={(e) => e.target.select()}
                  />
                  <Button size="sm" variant="outline" className="shrink-0" onClick={handleCopy}>
                    {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleCloseCreate}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation dialog */}
      <Dialog open={revokeId !== null} onOpenChange={(o) => { if (!o) setRevokeId(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke token?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Any app using this token will immediately lose access. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => revokeId !== null && revokeMutation.mutate(revokeId)}
              disabled={revokeMutation.isPending}
            >
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
