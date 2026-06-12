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
  if (role === 'TECHNICIAN') return null;

  const role = (session.user as any)?.role;
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
    <div style={{ background: '#fff', borderBottom: '0.5px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 50 }}>
      <div style={{ padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo.png" alt="Critter Stop" style={{ height: 32, width: 'auto' }} />
          <span style={{ fontWeight: 500, fontSize: 18, color: '#0f172a' }}>Critter Stop</span>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: 6, borderRadius: 14, background: '#f8fafc', border: '1px solid #e2e8f0', boxShadow: '0 2px 10px rgba(15,23,42,0.06)' }}>
          {tabs.map(tab => (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 500,
                color: isActive(tab.href) ? '#0f172a' : '#475569',
                background: isActive(tab.href) ? '#ffffff' : 'transparent',
                border: isActive(tab.href) ? '1px solid #dbe3ee' : '1px solid transparent',
                boxShadow: isActive(tab.href) ? '0 1px 3px rgba(15,23,42,0.08)' : 'none',
                textDecoration: 'none',
                display: 'inline-block',
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
            </Link>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: '#475569' }}>
          <span>{(session.user as any)?.email}</span>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', color: '#475569' }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
