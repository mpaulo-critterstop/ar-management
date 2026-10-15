// Redirects to the Bouncie OAuth consent screen with the CORRECT production redirect_uri, so authorization
// completes back at the Hub (not localhost). Click this instead of any hand-built/dashboard link.
//   /api/bouncie/authorize
import { NextResponse } from 'next/server';
const CLIENT_ID = 'critter-stop-';
const REDIRECT_URI = 'https://hub.critterstop.com/api/bouncie/callback';
export async function GET() {
  const url = `https://auth.bouncie.com/dialog/authorize?response_type=code&client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  return NextResponse.redirect(url);
}
