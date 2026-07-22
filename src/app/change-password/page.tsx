'use client';
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function ChangePasswordPage() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const mustChange = (session?.user as any)?.mustChangePassword;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) { setError('New passwords do not match'); return; }
    if (newPassword.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    const res = await fetch('/api/account/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: mustChange ? undefined : currentPassword, newPassword }),
    });
    const d = await res.json();
    if (!res.ok) { setError(d.error || 'Error'); setLoading(false); return; }
    // Refresh the session token so mustChangePassword clears, then go home.
    await update({ mustChangePassword: false });
    router.push('/');
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F7F6F2', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D3D1C7', padding: '2rem', width: 380, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: '#2C2C2A' }}>
            {mustChange ? 'Set your password' : 'Change password'}
          </div>
          <div style={{ fontSize: 13, color: '#888780' }}>
            {mustChange ? 'For security, please choose a new password before continuing.' : 'Update your account password.'}
          </div>
        </div>
        <form onSubmit={submit}>
          {!mustChange && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#888780', marginBottom: 4 }}>Current password</label>
              <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required />
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#888780', marginBottom: 4 }}>New password</label>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required placeholder="At least 6 characters" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#888780', marginBottom: 4 }}>Confirm new password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
          </div>
          {error && <div style={{ fontSize: 12, color: '#A32D2D', marginBottom: 12, padding: '8px 12px', background: '#FCEBEB', borderRadius: 6 }}>{error}</div>}
          <button type="submit" disabled={loading} style={{ width: '100%', padding: '9px', background: '#2C2C2A', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Saving…' : 'Save password'}
          </button>
        </form>
      </div>
    </div>
  );
}
