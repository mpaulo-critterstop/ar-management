'use client';
import { useRouter } from 'next/navigation';

// Goes back one layer (previous page) instead of jumping to the main home page.
// Falls back to home if there's no history (e.g. opened directly via a deep link).
export default function BackButton({ style }: { style?: React.CSSProperties }) {
  const router = useRouter();
  const go = () => {
    // If there's prior in-app history, go back; else go home.
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/');
  };
  return (
    <button
      onClick={go}
      style={{ fontSize: 13, color: '#888780', textDecoration: 'none', background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit', ...style }}
    >
      ↩ Back
    </button>
  );
}
