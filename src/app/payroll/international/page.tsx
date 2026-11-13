'use client';
export const dynamic = 'force-dynamic';
import Link from 'next/link';

const SECTIONS = [
  { title: 'Employee and Raise Tracker', desc: 'International employee pay, positions, and raise history.', href: '/payroll/international/raises', status: 'available' as const },
  { title: 'PTO Tracker', desc: 'PTO and holiday allotments, used, and remaining.', href: '/payroll/international/pto', status: 'available' as const },
];

export default function InternationalPayrollPage() {
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '30px 34px 70px' }}>
      <Link href="/payroll" style={{ fontSize: 13, color: '#908E85', textDecoration: 'none' }}>↩ Payroll</Link>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#F0EEE8', margin: '8px 0 4px' }}>🌎 International Payroll</h1>
      <p style={{ fontSize: 14, color: '#908E85', margin: '0 0 24px' }}>International team payroll and PTO.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        {SECTIONS.map(s => (
          <Link key={s.title} href={s.href} style={{ textDecoration: 'none' }}>
            <div style={{ border: '0.5px solid #2A2A30', borderRadius: 12, padding: 18, background: '#1C1C21', height: '100%' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#F0EEE8' }}>{s.title}</div>
              <div style={{ fontSize: 13, color: '#908E85', marginTop: 6, lineHeight: 1.5 }}>{s.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
