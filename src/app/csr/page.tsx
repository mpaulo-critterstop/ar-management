'use client';
import { PageHeader as CCPageHeader } from '@/components/cc/Layout';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { canAccessModule } from '@/lib/access';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function CsrPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  const [csrStats, setCsrStats] = useState<any[]>([]);
  const [csrKpis, setCsrKpis] = useState<any>(null);
  const [csrLoading, setCsrLoading] = useState(false);
  const [csrSelectedYear, setCsrSelectedYear] = useState(currentYear);
  const [csrSelectedMonth, setCsrSelectedMonth] = useState(currentMonth);
  const [csrFrom, setCsrFrom] = useState(() => new Date(currentYear, currentMonth, 1).toISOString().split('T')[0]);
  const [csrTo, setCsrTo] = useState(() => new Date(currentYear, currentMonth + 1, 0).toISOString().split('T')[0]);
  const [showManageCSR, setShowManageCSR] = useState(false);
  const [csrEmployees, setCsrEmployees] = useState<any[]>([]);
  const [newCSRName, setNewCSRName] = useState('');
  const [showAddCSR, setShowAddCSR] = useState(false);
  const [drawerCSR, setDrawerCSR] = useState<any>(null);
  const [drawerData, setDrawerData] = useState<any>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const sUser = session?.user as any;
  const canCsr = canAccessModule(sUser, 'csr');
  // Managing the CSR employee list is an admin/leads-level action, not for csr-only users.
  const canManage = canAccessModule(sUser, 'leads');

  // Auth + module guard
  useEffect(() => {
    if (status === 'unauthenticated') { router.push('/login'); return; }
    if (status === 'authenticated') {
      if (sUser?.mustChangePassword) { router.replace('/change-password'); return; }
      if (!canCsr) { router.replace('/'); return; }
    }
  }, [status, router, sUser, canCsr]);

  const fetchCSR = useCallback(async () => {
    setCsrLoading(true);
    const params = new URLSearchParams();
    if (csrFrom) params.set('from', csrFrom);
    if (csrTo) params.set('to', csrTo);
    const res = await fetch('/api/leads/csr?' + params.toString());
    const data = await res.json();
    setCsrStats(data.csrStats || []);
    setCsrKpis(data.kpis || null);
    setCsrLoading(false);
  }, [csrFrom, csrTo]);

  useEffect(() => { if (status === 'authenticated' && canCsr) fetchCSR(); }, [status, canCsr, fetchCSR]);

  const fetchCSREmployees = useCallback(async () => {
    const res = await fetch('/api/leads/csr-employees');
    const data = await res.json();
    setCsrEmployees(data.employees || []);
  }, []);
  useEffect(() => { if (showManageCSR) fetchCSREmployees(); }, [showManageCSR, fetchCSREmployees]);

  if (status === 'loading' || !canCsr) {
    return <div style={{ padding: 40, color: '#908E85' }}>Loading...</div>;
  }

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '30px 34px 70px' }}>
      <CCPageHeader icon="📇" title="CSR Leads Tracker" subtitle="Customer service rep lead handling; refreshes when the Leads Tracker syncs" />

      {/* Year + Month selector */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {[currentYear - 1, currentYear].filter(y => y >= 2026).concat(currentYear < new Date().getFullYear() ? [currentYear + 1] : []).map(y => (
              <button key={y} onClick={() => {
                setCsrSelectedYear(y);
                const m = csrSelectedMonth;
                setCsrFrom(new Date(y, m, 1).toISOString().split('T')[0]);
                setCsrTo(new Date(y, m + 1, 0).toISOString().split('T')[0]);
              }} style={{ padding: '5px 16px', fontSize: 13, borderRadius: 8, border: '0.5px solid #2A2A30', cursor: 'pointer', fontWeight: 500, background: csrSelectedYear === y ? '#5B9BE0' : '#1C1C21', color: csrSelectedYear === y ? '#1C1C21' : '#C9C7BF' }}>
                {y}
              </button>
            ))}
          </div>
          {canManage && (
            <button onClick={() => setShowManageCSR(true)} style={{ padding: '7px 14px', fontSize: 13, borderRadius: 8, border: '0.5px solid #2A2A30', background: '#1C1C21', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#C9C7BF' }}>
              👥 Manage CSRs
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {MONTHS.map((month, idx) => {
            const isSelected = csrSelectedMonth === idx;
            const isFuture = csrSelectedYear === currentYear && idx > currentMonth;
            return (
              <button key={month} disabled={isFuture} onClick={() => {
                setCsrSelectedMonth(idx);
                setCsrFrom(new Date(csrSelectedYear, idx, 1).toISOString().split('T')[0]);
                setCsrTo(new Date(csrSelectedYear, idx + 1, 0).toISOString().split('T')[0]);
              }} style={{ padding: '5px 12px', fontSize: 12, borderRadius: 8, border: '0.5px solid #2A2A30', cursor: isFuture ? 'not-allowed' : 'pointer', fontWeight: isSelected ? 500 : 400, background: isSelected ? '#5B9BE0' : isFuture ? '#232329' : '#1C1C21', color: isSelected ? '#1C1C21' : isFuture ? '#C4C2B8' : '#C9C7BF' }}>
                {month}
              </button>
            );
          })}
        </div>
      </div>

      {csrKpis && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
          {[{ label: 'Completed leads', value: csrKpis.completedLeads }].map(({ label, value }) => (
            <div key={label} style={{ background: '#232329', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ fontSize: 12, color: '#908E85', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 500, color: '#F0EEE8' }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {csrLoading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#908E85' }}>Loading...</div>
      ) : (
        <div style={{ background: '#1C1C21', border: '0.5px solid #2A2A30', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid #2A2A30', background: '#F9F8F5' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 500, color: '#908E85', width: 40 }}>#</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 500, color: '#908E85' }}>CSR name</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, color: '#908E85', width: 100 }}>Completed</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, color: '#908E85', width: 140 }}>Rescheduled by others</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, color: '#908E85', width: 150 }}>Rescheduled from others</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, color: '#908E85', width: 90 }}>Total leads</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, color: '#908E85', width: 80 }}>Points</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 500, color: '#908E85', width: 80 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {csrStats.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#908E85' }}>No CSR data yet — run the backfill first.</td></tr>
              ) : csrStats.map((csr, i) => (
                <tr key={csr.name} onClick={async () => {
                  setDrawerCSR(csr);
                  setDrawerData(null);
                  setDrawerLoading(true);
                  const params = new URLSearchParams({ csrName: csr.name });
                  if (csrFrom) params.set('from', csrFrom);
                  if (csrTo) params.set('to', csrTo);
                  const res = await fetch('/api/leads/csr-detail?' + params.toString());
                  setDrawerData(await res.json());
                  setDrawerLoading(false);
                }} style={{ borderBottom: '0.5px solid #2A2A30', background: i % 2 === 0 ? '#1C1C21' : '#FAFAF8', cursor: 'pointer' }}>
                  <td style={{ padding: '10px 14px', color: '#908E85', fontSize: 12 }}>{i + 1}</td>
                  <td style={{ padding: '10px 14px', fontWeight: 500, color: '#F0EEE8' }}>{csr.name}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#C9C7BF' }}>{csr.completed}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#C9C7BF' }}>{csr.rescheduledByOthers}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#C9C7BF' }}>{csr.rescheduledFromOthers}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#C9C7BF' }}>{csr.totalLeads}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, color: '#5B9BE0' }}>{csr.totalPoints.toFixed(1)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                    <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: csr.active ? '#EAF3DE' : '#FCEBEB', color: csr.active ? '#3B6D11' : '#E57C7C' }}>
                      {csr.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Manage CSRs Modal */}
      {showManageCSR && canManage && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1C1C21', borderRadius: 16, padding: 24, width: 460, maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>CSR employees</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowAddCSR(true)} style={{ padding: '6px 12px', fontSize: 12, borderRadius: 8, border: '0.5px solid #2A2A30', background: '#1C1C21', cursor: 'pointer' }}>+ Add CSR</button>
                <button onClick={() => { setShowManageCSR(false); setShowAddCSR(false); }} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #2A2A30', background: '#1C1C21', cursor: 'pointer' }}>✕</button>
              </div>
            </div>
            {showAddCSR && (
              <div style={{ background: '#232329', borderRadius: 10, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8, color: '#C9C7BF' }}>Add a CSR</div>
                <div style={{ fontSize: 11, color: '#908E85', marginBottom: 8 }}>Enter the CSR's full name exactly as it appears in FieldRoutes. All of their FR IDs are matched automatically — no need to enter IDs.</div>
                <input placeholder="Full name (e.g. Luis Cajas)" value={newCSRName} onChange={e => setNewCSRName(e.target.value)} style={{ width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 8, border: '0.5px solid #2A2A30', marginBottom: 8, boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={async () => {
                    if (!newCSRName.trim()) return;
                    await fetch('/api/leads/csr-employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newCSRName.trim() }) });
                    setNewCSRName(''); setShowAddCSR(false); fetchCSREmployees();
                  }} style={{ padding: '6px 14px', fontSize: 12, borderRadius: 8, border: 'none', background: '#5B9BE0', color: '#1C1C21', cursor: 'pointer' }}>Save</button>
                  <button onClick={() => { setShowAddCSR(false); setNewCSRName(''); }} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #2A2A30', background: '#1C1C21', cursor: 'pointer', color: '#908E85' }}>Cancel</button>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {csrEmployees.map(emp => (
                <div key={emp.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', border: '0.5px solid #2A2A30', borderRadius: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: emp.active ? '#F0EEE8' : '#908E85' }}>{emp.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button onClick={async () => {
                      await fetch('/api/leads/csr-employees', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: emp.name, active: !emp.active }) });
                      fetchCSREmployees();
                    }} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: 'none', background: emp.active ? '#EAF3DE' : '#FCEBEB', color: emp.active ? '#3B6D11' : '#E57C7C', cursor: 'pointer' }}>
                      {emp.active ? 'Active' : 'Inactive'}
                    </button>
                    <button onClick={async () => {
                      if (!confirm(`Remove ${emp.name} from the CSR list? Their appointments still count in totals, but they won't show as a CSR row.`)) return;
                      await fetch('/api/leads/csr-employees', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: emp.name, isCsr: false }) });
                      fetchCSREmployees();
                    }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E57C7C', fontSize: 13, padding: 2 }} title="Remove from CSR list">🗑</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* CSR Detail Drawer */}
      {drawerCSR && (
        <>
          <div onClick={() => { setDrawerCSR(null); setDrawerData(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }} />
          <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 680, maxWidth: '95vw', background: '#1C1C21', zIndex: 1001, boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', borderBottom: '0.5px solid #2A2A30', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 500, color: '#F0EEE8' }}>{drawerCSR.name}</div>
                <div style={{ fontSize: 12, color: '#908E85', marginTop: 2 }}>{drawerCSR.totalPoints.toFixed(1)} points · {drawerCSR.totalLeads} total leads</div>
              </div>
              <button onClick={() => { setDrawerCSR(null); setDrawerData(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#908E85', padding: 4 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
              {drawerLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#908E85' }}>Loading...</div>
              ) : drawerData && (
                <>
                  {[
                    { key: 'completed', label: 'Completed', bg: '#EAF3DE', color: '#3B6D11', extraCol: null },
                    { key: 'rescheduledByOthers', label: 'Rescheduled by others', bg: '#FEF3E2', color: '#854F0B', extraCol: { header: 'Rescheduled by', field: 'rescheduledBy' } },
                    { key: 'rescheduledFromOthers', label: 'Rescheduled from others', bg: '#E6F1FB', color: '#185FA5', extraCol: { header: 'Originally booked by', field: 'originallyBookedBy' } },
                  ].map(section => {
                    const rows = drawerData[section.key] || [];
                    return (
                      <div key={section.key} style={{ marginBottom: 28 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#F0EEE8', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ background: section.bg, color: section.color, padding: '2px 8px', borderRadius: 6, fontSize: 12 }}>{section.label}</span>
                          <span style={{ color: '#908E85', fontSize: 12 }}>{rows.length} leads</span>
                        </div>
                        {rows.length === 0 ? (
                          <div style={{ fontSize: 12, color: '#908E85' }}>None</div>
                        ) : (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                              <tr style={{ background: '#232329' }}>
                                {['Date', 'Customer', 'Office', 'Service type'].concat(section.extraCol ? [section.extraCol.header] : []).map(h => (
                                  <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#908E85', borderBottom: '0.5px solid #2A2A30' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r: any, i: number) => (
                                <tr key={i} style={{ borderBottom: '0.5px solid #232329' }}>
                                  <td style={{ padding: '7px 10px', color: '#C9C7BF' }}>{r.date}</td>
                                  <td style={{ padding: '7px 10px', color: '#C9C7BF' }}>{r.customer}</td>
                                  <td style={{ padding: '7px 10px', color: '#C9C7BF' }}>{r.office}</td>
                                  <td style={{ padding: '7px 10px', color: '#C9C7BF' }}>{r.serviceType}</td>
                                  {section.extraCol && <td style={{ padding: '7px 10px', color: '#C9C7BF' }}>{r[section.extraCol.field]}</td>}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
