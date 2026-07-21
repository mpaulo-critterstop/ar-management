'use client';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

export function TopNav() {
  const { data: session } = useSession();
  const pathname = usePathname();
  if (!session || pathname === '/login') return null;

  const role = (session.user as any)?.role;
  if (role === 'Technician') return null;

  const isHome = pathname === '/';

  return (
    <div style={{ background: '#fff', borderBottom: '0.5px solid #E8E7E3', position: 'sticky', top: 0, zIndex: 50 }}>
      <div style={{ padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
        {/* Logo — always links home */}
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <img src="/logo.png" alt="Critter Stop" style={{ height: 32, width: 'auto' }} />
          <span style={{ fontWeight: 600, fontSize: 16, color: '#2C2C2A', letterSpacing: '-0.01em' }}>Critter Stop Hub</span>
        </Link>

        {/* Back to home button — show when not on homepage */}
        {!isHome && (
          <Link href="/" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 9, fontSize: 13, fontWeight: 500,
            color: '#888780', background: '#F1EFE8', border: '0.5px solid #D3D1C7',
            textDecoration: 'none', transition: 'all 0.15s',
          }}
          onMouseEnter={(e: any) => e.currentTarget.style.color = '#2C2C2A'}
          onMouseLeave={(e: any) => e.currentTarget.style.color = '#888780'}
          >
            ← Home
          </Link>
        )}

        {/* User + sign out */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#888780' }}>
          {role === 'Admin' && (
            <Link href="/admin/users" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500,
              color: pathname === '/admin/users' ? '#0052cc' : '#888780',
              background: pathname === '/admin/users' ? '#EAF1FC' : '#F8F7F4',
              border: '0.5px solid #D3D1C7', textDecoration: 'none',
            }}>
              ⚙ Users
            </Link>
          )}
          <span>{(session.user as any)?.email}</span>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#F8F7F4', cursor: 'pointer', color: '#888780' }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
