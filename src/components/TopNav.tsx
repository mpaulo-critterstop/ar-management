'use client';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

const baseTabs = [
  { label: 'Home', href: '/' },
  { label: 'Leads Tracker', href: '/leads' },
  { label: 'Dispatcher', href: '/dispatch' },
  { label: 'AR', href: '/accounts-receivable' },
];

const FP_ROLES = ['ADMIN', 'MANAGER', 'LEADERSHIP'];
const TECH_ROLES = ['TECHNICIAN'];

export function TopNav() {
  const { data: session } = useSession();
  const pathname = usePathname();
  if (!session || pathname === '/login') return null;

  const role = (session.user as any)?.role;
  if (role === 'TECHNICIAN') return null;
  const tabs = TECH_ROLES.includes(role)
    ? [{ label: 'My Performance', href: '/my-performance' }]
    : FP_ROLES.includes(role)
    ? [...baseTabs, { label: 'Field Professional Effort Meter', href: '/field-performance' }]
    : baseTabs;

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <div style={{ background: '#fff', borderBottom: '0.5px solid #E8E7E3', position: 'sticky', top: 0, zIndex: 50 }}>
      <div style={{ padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo.png" alt="Critter Stop" style={{ height: 32, width: 'auto' }} />
          <span style={{ fontWeight: 600, fontSize: 16, color: '#2C2C2A', letterSpacing: '-0.01em' }}>Critter Stop</span>
        </div>

        {/* Nav tabs */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 12, background: '#F1EFE8', border: '0.5px solid #E8E7E3' }}>
          {tabs.map(tab => (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                padding: '7px 14px',
                borderRadius: 9,
                fontSize: 13,
                fontWeight: 500,
                color: isActive(tab.href) ? '#2C2C2A' : '#888780',
                background: isActive(tab.href) ? '#ffffff' : 'transparent',
                border: isActive(tab.href) ? '0.5px solid #D3D1C7' : '0.5px solid transparent',
                boxShadow: isActive(tab.href) ? '0 1px 3px rgba(44,44,42,0.08)' : 'none',
                textDecoration: 'none',
                display: 'inline-block',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        {/* User */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#888780' }}>
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
