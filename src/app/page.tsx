'use client';
export const dynamic = 'force-dynamic';
import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

// Root landing: routes authenticated users to the right home and renders nothing itself (no flash of old UI).
export default function HomePage() {
  const sessionData = useSession();
  const session = sessionData?.data;
  const status = sessionData?.status;
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') { router.push('/login'); return; }
    if (status === 'authenticated') {
      const u = session?.user as any;
      if (u?.mustChangePassword) { router.replace('/change-password'); return; }
      // Technicians -> personal mobile dashboard; everyone else -> the command-center Overview.
      if (u?.role === 'Technician' || u?.techId) { router.replace('/my-performance'); return; }
      router.replace('/overview'); return;
    }
  }, [status, router, session]);

  return null; // always redirects; render nothing so no old UI flashes
}
