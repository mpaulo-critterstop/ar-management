'use client';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { teamPill, card, th, td } from './helpers';

interface Props { office: string; weekEnd: Date; }

const EMPTY_FORM = {
  techId: '', weekEnd: '',
  leadershipPts: 0, leadershipNote: '',
  frPts: 0, frNote: '',
  reviewsPts: 0, reviewsNote: '',
};

export function ManualAdjTab({ office, weekEnd }: Props) {
  const [adjs, setAdjs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [techs, setTechs] = useState<any[]>([]);
  const [allWeeks, setAllWeeks] = useState(false);
  const [memberFilter, setMemberFilter] = useState('');
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;
  const canEdit = ['ADMIN', 'LEADERSHIP'].includes(role);

  const load = () => {
    setLoading(true);
    const wk = weekEnd.toLocaleDateString('en-CA');
    const params = new URLSearchParams();
    if (allWeeks) params.set('allWeeks', 'true');
    else params.set('week', wk);
    params.set('office', office);
    if (memberFilter) params.set('techId', memberFilter);
    fetch(`/api/field-performance/manual-adj?${params}`)
      .then(r => r.json())
      .then(d => { setAdjs(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [office, weekEnd, allWeeks, memberFilter]);

  useEffect(() => {
    fetch(`/api/field-performance/roster?status=ACTIVE`)
      .then(r => r.json())
      .then(d => setTechs(Array.isArray(d) ? d : []));
  }, []);

  const totalPoints = (form.leadershipPts || 0) + (form.frPts || 0) + (form.reviewsPts || 0);

  const save = async () => {
    setSaving(true);
    await fetch('/api/field-performance/manual-adj', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, weekEnd: weekEnd.toLocaleDateString('en-CA') }),
    });
    setSaving(false);
    setShowForm(false);
    setForm({ ...EMPTY_FORM });
    load();
  };

  const deleteAdj = async (id: string) => {
    if (!confirm('Remove this adjustment? This will reverse the score change.')) return;
    await fetch(`/api/field-performance/manual-adj?id=${id}`, { method: 'DELETE' });
    load();
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', fontSize: 13, padding: '7px 10px',
    border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', color: '#0f172a'
  };
  const labelStyle: React.CSSProperties = { fontSize: 11, color: '#64748b', marginBottom: 4, display: 'block' };

  // Summary
  const totalAdj = adjs.reduce((a, b) => a + (b.totalPoints || 0), 0);
  const positive = adjs.filter(a => a.totalPoints > 0).length;
  const negative = adjs.filter(a => a.totalPoints < 0).length;

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
        {[
          { label: 'Total adjustments', value: adjs.length },
          { label: 'Positive (+)', value: positive, color: '#27500A' },
          { label: 'Negative (−)', value: negative, color: '#791F1F' },
          { label: 'Net points', value: totalAdj > 0 ? `+${totalAdj}` : totalAdj, color: totalAdj > 0 ? '#27500A' : totalAdj < 0 ? '#791F1F' : '#0f172a' },
        ].map(k => (
          <div key={k.label} style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 500, color: (k as any).color || '#0f172a' }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <button
          onClick={() => setAllWeeks(v => !v)}
          style={{ padding: '6px 12px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: '0.5px solid #D3D1C7', background: allWeeks ? '#EAF1FC' : '#fff', color: allWeeks ? '#0052cc' : '#888780', cursor: 'pointer' }}
        >
          {allWeeks ? '✓ All weeks' : 'This week only'}
        </button>
        <select
          value={memberFilter}
          onChange={e => setMemberFilter(e.target.value)}
          style={{ fontSize: 12, padding: '6px 9px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: memberFilter ? '#EAF1FC' : '#fff', color: '#444441', cursor: 'pointer' }}
        >
          <option value="">All team members</option>
          {[...techs].sort((a, b) => a.name.localeCompare(b.name)).map(t => (
            <option key={t.techId} value={t.techId}>{t.name}</option>
          ))}
        </select>
        {(allWeeks || memberFilter) && (
          <span style={{ fontSize: 11, color: '#888780' }}>
            Showing {adjs.length} adjustment{adjs.length !== 1 ? 's' : ''}{allWeeks ? ' across all weeks' : ''}
          </span>
        )}
      </div>

      {/* Add button */}
      {canEdit && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button onClick={() => setShowForm(true)}
            style={{ padding: '7px 16px', fontSize: 13, fontWeight: 500, borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', color: '#0f172a' }}>
            + Add adjustment
          </button>
        </div>
      )}

      {/* Table */}
      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                {allWeeks && <th style={{ ...th, width: 80 }}>Week</th>}
                <th style={{ ...th, width: 55 }}>Tech ID</th>
                <th style={{ ...th, width: 140 }}>Name</th>
                <th style={{ ...th, width: 46 }}>Team</th>
                <th style={{ ...th, width: 55 }}>Office</th>
                <th style={{ ...th, width: 65 }}>Total pts</th>
                <th style={{ ...th, width: 65 }}>Leadership</th>
                <th style={{ ...th, width: 200 }}>Leadership note</th>
                <th style={{ ...th, width: 55 }}>FR pts</th>
                <th style={{ ...th, width: 200 }}>FR note</th>
                <th style={{ ...th, width: 55 }}>Review pts</th>
                <th style={{ ...th, width: 80 }}>Entered by</th>
                {canEdit && <th style={{ ...th, width: 36 }}></th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={allWeeks ? 13 : 12} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 32 }}>Loading...</td></tr>
              ) : adjs.length === 0 ? (
                <tr><td colSpan={allWeeks ? 13 : 12} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 32 }}>No adjustments {allWeeks ? 'recorded' : 'for this week'}.</td></tr>
              ) : adjs.map(a => (
                <tr key={a.id}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f8fafc'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                >
                  {allWeeks && <td style={{ ...td, fontSize: 11, color: '#64748b' }}>{a.weekEnd ? new Date(a.weekEnd).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' }) : '—'}</td>}
                  <td style={{ ...td, fontSize: 11, color: '#64748b' }}>{a.techId}</td>
                  <td style={{ ...td, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.technician?.name}</td>
                  <td style={td}>{teamPill(a.technician?.team || '')}</td>
                  <td style={{ ...td, fontSize: 12 }}>{a.technician?.office}</td>
                  <td style={{ ...td, fontWeight: 500, color: a.totalPoints > 0 ? '#27500A' : '#791F1F' }}>
                    {a.totalPoints > 0 ? `+${a.totalPoints}` : a.totalPoints}
                  </td>
                  <td style={{ ...td, fontSize: 12 }}>{a.leadershipPts ? (a.leadershipPts > 0 ? `+${a.leadershipPts}` : a.leadershipPts) : '—'}</td>
                  <td style={{ ...td, fontSize: 11, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.leadershipNote || '—'}</td>
                  <td style={{ ...td, fontSize: 12 }}>{a.frPts ? (a.frPts > 0 ? `+${a.frPts}` : a.frPts) : '—'}</td>
                  <td style={{ ...td, fontSize: 11, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.frNote || '—'}</td>
                  <td style={{ ...td, fontSize: 12 }}>{a.reviewsPts ? (a.reviewsPts > 0 ? `+${a.reviewsPts}` : a.reviewsPts) : '—'}</td>
                  <td style={{ ...td, fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.enteredBy || '—'}</td>
                  {canEdit && (
                    <td style={td}>
                      <button onClick={() => deleteAdj(a.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 14, padding: 0 }}>×</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', border: '0.5px solid #e2e8f0', borderRadius: 12, padding: 24, width: 480, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>Add Manual Adjustment</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>Week of {weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Technician</label>
              <select value={form.techId} onChange={e => setForm(f => ({ ...f, techId: e.target.value }))} style={inputStyle}>
                <option value="">Select tech...</option>
                {techs.map(t => <option key={t.techId} value={t.techId}>{t.name} ({t.techId})</option>)}
              </select>
            </div>

            {/* Leadership */}
            <div style={{ background: '#f8fafc', borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#0f172a', marginBottom: 8 }}>Leadership Feedback</div>
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 8 }}>
                <div>
                  <label style={labelStyle}>Points</label>
                  <input type="number" value={form.leadershipPts} onChange={e => setForm(f => ({ ...f, leadershipPts: Number(e.target.value) }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Note</label>
                  <input value={form.leadershipNote} onChange={e => setForm(f => ({ ...f, leadershipNote: e.target.value }))} style={inputStyle} placeholder="Reason..." />
                </div>
              </div>
            </div>

            {/* FR */}
            <div style={{ background: '#f8fafc', borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#0f172a', marginBottom: 8 }}>Office + FR Feedback</div>
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 8 }}>
                <div>
                  <label style={labelStyle}>Points</label>
                  <input type="number" value={form.frPts} onChange={e => setForm(f => ({ ...f, frPts: Number(e.target.value) }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Note</label>
                  <input value={form.frNote} onChange={e => setForm(f => ({ ...f, frNote: e.target.value }))} style={inputStyle} placeholder="Reason..." />
                </div>
              </div>
            </div>

            {/* Reviews */}
            <div style={{ background: '#f8fafc', borderRadius: 8, padding: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#0f172a', marginBottom: 8 }}>Reviews</div>
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 8 }}>
                <div>
                  <label style={labelStyle}>Points</label>
                  <input type="number" value={form.reviewsPts} onChange={e => setForm(f => ({ ...f, reviewsPts: Number(e.target.value) }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Note</label>
                  <input value={form.reviewsNote} onChange={e => setForm(f => ({ ...f, reviewsNote: e.target.value }))} style={inputStyle} placeholder="Reason..." />
                </div>
              </div>
            </div>

            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 14, padding: '8px 12px', background: totalPoints > 0 ? '#EAF3DE' : totalPoints < 0 ? '#FCEBEB' : '#f8fafc', borderRadius: 8, color: totalPoints > 0 ? '#27500A' : totalPoints < 0 ? '#791F1F' : '#64748b' }}>
              Total: {totalPoints > 0 ? `+${totalPoints}` : totalPoints} points
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowForm(false); setForm({ ...EMPTY_FORM }); }}
                style={{ padding: '7px 16px', fontSize: 13, borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', color: '#475569' }}>
                Cancel
              </button>
              <button onClick={save} disabled={saving || !form.techId || totalPoints === 0}
                style={{ padding: '7px 16px', fontSize: 13, fontWeight: 500, borderRadius: 8, border: 'none', background: saving || !form.techId || totalPoints === 0 ? '#94a3b8' : '#0052cc', color: '#fff', cursor: saving || !form.techId || totalPoints === 0 ? 'default' : 'pointer' }}>
                {saving ? 'Saving...' : 'Save adjustment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
