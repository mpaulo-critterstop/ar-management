'use client';
export const dynamic = 'force-dynamic';
import EmployeeRaiseTracker from '@/components/EmployeeRaiseTracker';
export default function Page() { return <EmployeeRaiseTracker region="US" backHref="/payroll/us" />; }
