import { AccountSetting } from '@/components/AccountSetting';
import { CategoryManager } from '@/components/CategoryManager';
import { WeeklyGoalSetting } from '@/components/WeeklyGoalSetting';
import { ThemeSetting } from '@/components/ThemeSetting';
import { ApiTokenManager } from '@/components/ApiTokenManager';
import { AboutSection } from '@/components/AboutSection';
import { AdminAuditLog } from '@/pages/admin/AuditLog';
import { AdminUsers } from '@/pages/admin/Users';
import { useAuthContext } from '@/lib/authContext';

export function Settings() {
  const { role } = useAuthContext();

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <CategoryManager />
      <WeeklyGoalSetting />
      <ThemeSetting />
      <ApiTokenManager />
      <AccountSetting />
      {/*
        Phase E: the admin surface is mounted only for an administrator. A
        non-admin never sees the entry point at all — not a disabled control and
        not an empty card.
      */}
      {role === 'admin' && (
        <>
          <AdminUsers />
          <AdminAuditLog />
        </>
      )}
      <AboutSection />
    </div>
  );
}
