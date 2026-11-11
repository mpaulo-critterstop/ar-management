'use client';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import CommandShell from '@/components/CommandShell';

// Global wrapper (Path B): gives every module the unified Command Center sidebar without editing each page.
// Routes NOT wrapped: login, change-password (auth pages), and /overview (which already renders its own shell).
// The content area is kept light so existing (not-yet-restyled) module content stays readable; we restyle
// module interiors to dark one at a time later.

const NO_SHELL = ['/login', '/change-password'];
const SELF_SHELL = ['/overview']; // pages that render CommandShell themselves

export default function ShellWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const { data: session, status } = useSession();

  const noShell = NO_SHELL.some(r => pathname === r || pathname.startsWith(r + '/'));
  const selfShell = SELF_SHELL.some(r => pathname === r || pathname.startsWith(r + '/'));

  // Not logged in, on an auth page, still loading, or a page that shells itself → render as-is.
  if (noShell || selfShell || status !== 'authenticated' || !session) return <>{children}</>;

  // Technicians use the old minimal view (no shell) — keep their existing experience.
  if ((session.user as any)?.role === 'Technician') return <>{children}</>;

  // Wrap the module in the shell, but give the content a light surface so current content stays readable.
  return (
    <CommandShell>
      <div style={{ background: '#F4F2EC', color: '#2C2C2A', borderRadius: 14, minHeight: 'calc(100vh - 48px)', margin: '-24px -32px -60px', padding: '8px 0' }}>
        {children}
      </div>
    </CommandShell>
  );
}
