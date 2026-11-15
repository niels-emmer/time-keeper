import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from '../Settings';

const { authState } = vi.hoisted(() => ({
  authState: { role: null as 'user' | 'admin' | null },
}));

vi.mock('@/lib/authContext', () => ({
  useAuthContext: () => ({ role: authState.role }),
}));

// The rest of Settings is irrelevant here; stubbing keeps this test to the one
// rule that matters: the admin entry point exists only for an admin.
vi.mock('@/components/CategoryManager', () => ({ CategoryManager: () => <div>categories</div> }));
vi.mock('@/components/WeeklyGoalSetting', () => ({ WeeklyGoalSetting: () => <div>weekly goal</div> }));
vi.mock('@/components/ThemeSetting', () => ({ ThemeSetting: () => <div>theme</div> }));
vi.mock('@/components/ApiTokenManager', () => ({ ApiTokenManager: () => <div>tokens</div> }));
vi.mock('@/components/AccountSetting', () => ({ AccountSetting: () => <div>account</div> }));
vi.mock('@/components/AboutSection', () => ({ AboutSection: () => <div>about</div> }));
vi.mock('@/pages/admin/Users', () => ({ AdminUsers: () => <div>admin users surface</div> }));
vi.mock('@/pages/admin/AuditLog', () => ({ AdminAuditLog: () => <div>audit log surface</div> }));

describe('Settings admin entry point', () => {
  beforeEach(() => {
    authState.role = null;
  });

  it('never renders the admin surfaces for a non-admin', () => {
    authState.role = 'user';
    render(<Settings />);

    expect(screen.queryByText('admin users surface')).toBeNull();
    expect(screen.queryByText('audit log surface')).toBeNull();
  });

  it('mounts the user table and audit viewer for an administrator', () => {
    authState.role = 'admin';
    render(<Settings />);

    expect(screen.getByText('admin users surface')).not.toBeNull();
    expect(screen.getByText('audit log surface')).not.toBeNull();
  });
});
