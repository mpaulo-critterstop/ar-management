'use client';
import { usePathname } from 'next/navigation';

// The app's base look is bg.jpg under an 88% white wash (for the old light pages). On the command-center
// dark routes that wash would flash through during client-side navigation (before the fixed dark shell
// repaints), showing the old white background + logo for a moment. So we hide the wash on dark routes.
const DARK_ROUTES = ['/overview', '/stax', '/calls', '/accounts-receivable', '/ar/collections', '/leads',
  '/dispatch', '/pest-sales', '/pest-inspections', '/csr-pest-sales', '/csr', '/cancellations',
  '/service-pool', '/exclusion-scheduling', '/lsa-leads', '/field-performance', '/payroll', '/reports'];

export default function LightOverlay() {
  const pathname = usePathname() || '';
  const onDark = DARK_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'));
  // On dark routes, paint a solid dark base so navigation gaps stay dark (no white/logo flash).
  if (onDark) return <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: '#121216' }} />;
  return <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: 'rgba(255,255,255,0.88)' }} />;
}
