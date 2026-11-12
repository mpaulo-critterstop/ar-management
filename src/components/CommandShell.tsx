'use client';
import { useState, useMemo } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import { canAccessModule } from '@/lib/access';

// Shared Command Center shell: a persistent dark sidebar (nav grouped Operations/Management/Reports) + a main
// content area. Used to wrap redesigned pages so the nav is always one click away. Access-aware: only shows
// modules the user can open. This is the foundation of the Hub UI redesign (dark command-center theme).

type NavItem = { key: string; label: string; icon: string; href: string; module?: string };
type NavGroup = { title: string; icon: string; items: NavItem[] };

const NAV: NavGroup[] = [
  { title: 'Operations', icon: '🛠️', items: [
    { key: 'overview', label: 'Overview', icon: '📊', href: '/overview' },
    { key: 'dispatch', label: 'Dispatcher', icon: '🚚', href: '/dispatch', module: 'dispatch' },
    { key: 'ar', label: 'Accounts Receivable', icon: '💰', href: '/accounts-receivable', module: 'ar' },
    { key: 'dialpad', label: 'Dialpad Analytics', icon: '📞', href: '/calls', module: 'dialpad' },
    { key: 'leads', label: 'Leads Tracker', icon: '🎯', href: '/leads', module: 'leads' },
    { key: 'pest-sales', label: 'Pest Control Sales', icon: '🐀', href: '/pest-sales', module: 'pest-sales' },
    { key: 'pest-inspections', label: 'Pest Inspections', icon: '🔍', href: '/pest-inspections', module: 'pest-inspections' },
    { key: 'csr-pest-sales', label: 'CSR Pest Sales', icon: '📋', href: '/csr-pest-sales', module: 'csr-pest-sales' },
    { key: 'csr', label: 'CSR Leads Tracker', icon: '📝', href: '/csr', module: 'csr' },
    { key: 'cancellations', label: 'Pest Cancellations', icon: '🚫', href: '/cancellations', module: 'cancellations' },
    { key: 'service-pool', label: 'Job Pool', icon: '🧹', href: '/service-pool', module: 'service-pool' },
    { key: 'exclusion-scheduling', label: 'Exclusion Scheduling', icon: '🚪', href: '/exclusion-scheduling', module: 'exclusion-scheduling' },
    { key: 'lsa-leads', label: 'LSA Leads', icon: '📣', href: '/lsa-leads', module: 'lsa-leads' },
    { key: 'helcim', label: 'Stax Payments', icon: '💳', href: '/stax', module: 'helcim' },
    { key: 'field-performance', label: 'Field Effort Meter', icon: '⚡', href: '/field-performance', module: 'field-performance' },
  ]},
  { title: 'Management', icon: '💼', items: [
    { key: 'payroll', label: 'Payroll', icon: '🧾', href: '/payroll', module: 'payroll' },
  ]},
  { title: 'Reports', icon: '📈', items: [
    { key: 'reports', label: 'Reports', icon: '📈', href: '/reports', module: 'reports' },
  ]},
];

export default function CommandShell({ children, title }: { children: React.ReactNode; title?: string }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState('');
  const user = session?.user as any;
  const role = user?.role || '';
  const name = user?.name || user?.username || 'User';
  const initials = String(name).split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();

  // filter nav by access + search
  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return NAV.map(g => ({
      ...g,
      items: g.items.filter(it => {
        if (it.module && !canAccessModule(user, it.module as any)) return false;
        if (ql && !it.label.toLowerCase().includes(ql)) return false;
        return true;
      }),
    })).filter(g => g.items.length > 0);
  }, [user, q]);

  // Match exact path, or a sub-path at a boundary (so /csr doesn't light up on /csr-pest-sales).
  const isActive = (href: string) => pathname === href || (href !== '/overview' && !!pathname && (pathname.startsWith(href + '/')));

  return (
    <div style={S.app}>
      <aside style={S.sidebar}>
        <div style={S.brand}>
          <div style={S.mark}>🦝</div>
          <div><div style={S.brandT}>Critter Stop</div><div style={S.brandS}>THE HUB</div></div>
        </div>
        <div style={S.searchWrap}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search modules…" style={S.search} />
        </div>
        <nav style={S.nav}>
          {groups.map(g => (
            <div key={g.title}>
              <div style={S.grp}>{g.icon} {g.title}</div>
              {g.items.map(it => (
                <a key={it.key} onClick={() => router.push(it.href)}
                   style={{ ...S.navItem, ...(isActive(it.href) ? S.navActive : {}) }}
                   onMouseEnter={e => { if (!isActive(it.href)) (e.currentTarget as HTMLElement).style.background = '#26262C'; }}
                   onMouseLeave={e => { if (!isActive(it.href)) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                  <span style={{ width: 18, textAlign: 'center' }}>{it.icon}</span> {it.label}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div style={S.foot}>
          <div style={S.footAv}>{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={S.footName}>{name}</div>
            <div style={S.footRole}>{role}</div>
          </div>
          <button onClick={() => signOut({ callbackUrl: '/login' })} style={S.signout} title="Sign out">⎋</button>
        </div>
      </aside>
      <main style={S.main}>{children}</main>
    </div>
  );
}

const DARK = {
  bg: '#16161A', panel: '#1E1E23', panel2: '#26262C', ink: '#ECEAE3', muted: '#9A988E', faint: '#6A685F',
  line: '#2D2D33', blue: '#5B9BE0',
};
const S: Record<string, React.CSSProperties> = {
  // Fixed, full-viewport dark surface — covers the old light background/overlay completely and spans full width.
  app: { display: 'flex', minHeight: '100vh', background: DARK.bg, color: DARK.ink, fontFamily: 'inherit', position: 'fixed', inset: 0, zIndex: 20, overflow: 'hidden' },
  sidebar: { width: 236, flex: '0 0 236px', background: DARK.panel, borderRight: `1px solid ${DARK.line}`, display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0 },
  brand: { padding: '17px 18px', borderBottom: `1px solid ${DARK.line}`, display: 'flex', alignItems: 'center', gap: 10 },
  mark: { width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#5B9BE0,#3FAE8C)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 },
  brandT: { fontSize: 13, fontWeight: 700, letterSpacing: '.02em' },
  brandS: { fontSize: 10, fontWeight: 500, color: DARK.muted, letterSpacing: '.08em' },
  searchWrap: { margin: '12px 14px' },
  search: { width: '100%', background: DARK.panel2, border: `1px solid ${DARK.line}`, borderRadius: 9, padding: '8px 11px', fontSize: 13, color: DARK.ink, outline: 'none', boxSizing: 'border-box' },
  nav: { padding: '4px 10px', overflowY: 'auto', flex: 1 },
  grp: { fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: DARK.faint, padding: '12px 8px 5px' },
  navItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8, color: DARK.muted, textDecoration: 'none', fontSize: 13.5, fontWeight: 500, cursor: 'pointer' },
  navActive: { background: DARK.panel2, color: DARK.ink },
  foot: { borderTop: `1px solid ${DARK.line}`, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 9 },
  footAv: { width: 28, height: 28, borderRadius: 8, background: DARK.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: '#fff', flex: '0 0 auto' },
  footName: { fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  footRole: { fontSize: 11, color: DARK.muted },
  signout: { background: 'transparent', border: 'none', color: DARK.muted, cursor: 'pointer', fontSize: 15 },
  // Main scrolls; sidebar stays fixed. Full width (no max-width cap), centered content with generous max for readability.
  main: { flex: 1, minWidth: 0, height: '100vh', overflowY: 'scroll', scrollbarGutter: 'stable', padding: '24px 32px 60px' },
};
