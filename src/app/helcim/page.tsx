import { redirect } from 'next/navigation';
// The Stax Payments module moved from /helcim to /stax. Redirect old links/bookmarks.
export default function HelcimRedirect() {
  redirect('/stax');
}
