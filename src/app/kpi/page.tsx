'use client';
export const dynamic = 'force-dynamic';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// KPIs moved into the Leads Tracker as a tab. Redirect the old standalone route so any
// bookmarks or links keep working.
export default function KPIRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/leads?tab=kpi');
  }, [router]);
  return null;
}
