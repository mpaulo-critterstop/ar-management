'use client';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

const ACCENT = '#92c1e9';

const tabs = [
  { label: 'Home', href: '/' },
  { label: 'Leads tracker', href: '/leads' },
  { label: 'Dispatcher', href: '/dispatch' },
  { label: 'AR', href: '/accounts-receivable' },
];

export function TopNav() {
  const { data: session } = useSession();
  const pathname = usePathname();

  if (!session || pathname === '/login') return null;

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <div style={{ background: '#fff', borderBottom: '0.5px solid #E8E7E3', position: 'sticky', top: 0, zIndex: 50 }}>
      <div style={{ padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52 }}>
        <div style={{ fontWeight: 500, fontSize: 15, color: '#2C2C2A' }}>
          🦝 Critter Stop — Wildlife Operations
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {tabs.map(tab => (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                padding: '14px 16px',
                fontSize: 13,
                fontWeight: isActive(tab.href) ? 500 : 400,
                color: isActive(tab.href) ? ACCENT : '#888780',
                borderBottom: isActive(tab.href) ? `2px solid ${ACCENT}` : '2px solid transparent',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'color 0.15s',
              }}
            >
              {tab.label}
            </Link>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: '#888780' }}>
          <span>{(session.user as any)?.email}</span>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '0.5px solid #D3D1C7', background: 'transparent', cursor: 'pointer', color: '#888780' }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
