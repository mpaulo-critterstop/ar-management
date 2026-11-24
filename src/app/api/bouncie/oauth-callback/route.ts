import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// One-time OAuth callback to authorize the SEPARATE Bouncie app registered for Chisam's analytics.
// Flow: you visit the Bouncie authorize URL -> approve -> Bouncie redirects here with ?code=... ->
// this exchanges the code for access + refresh tokens and shows them so you can hand them to Chisam.
//
// Credentials come from env (set in Vercel): BOUNCIE_CHISAM_CLIENT_ID, BOUNCIE_CHISAM_CLIENT_SECRET.
// The redirect_uri MUST exactly match what you registered on the Bouncie Developer Portal.
const REDIRECT_URI = 'https://hub.critterstop.com/api/bouncie/oauth-callback';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  // Chisam's separate analytics app credentials.
  const clientId = process.env.BOUNCIE_CHISAM_CLIENT_ID || 'critter-stop-chisam';
  const clientSecret = process.env.BOUNCIE_CHISAM_CLIENT_SECRET || '52jqbaSvmqPOyPDuOpCfMxQ79GWXWirGCjHqjJjHVdfw87GNIl';

  if (sp.get('start') === '1') {
    if (!clientId) return NextResponse.json({ error: 'BOUNCIE_CHISAM_CLIENT_ID not set in env' }, { status: 400 });
    const authUrl = `https://auth.bouncie.com/dialog/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&state=chisam`;
    return NextResponse.redirect(authUrl);
  }

  const code = sp.get('code');
  if (!code) {
    return NextResponse.json({
      message: 'Bouncie OAuth callback for Chisam\'s app.',
      howTo: 'Visit this same URL with ?start=1 to begin authorization (redirects you to Bouncie to approve). After approving you\'ll land back here and see the tokens.',
      authorizeUrl: clientId ? `${REDIRECT_URI}?start=1` : 'set BOUNCIE_CHISAM_CLIENT_ID first',
    });
  }

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'BOUNCIE_CHISAM_CLIENT_ID / BOUNCIE_CHISAM_CLIENT_SECRET not set in env', code }, { status: 400 });
  }

  // Exchange the authorization code for tokens.
  try {
    const res = await fetch('https://auth.bouncie.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tokens = await res.json().catch(() => null);
    if (!res.ok) return NextResponse.json({ error: 'token exchange failed', status: res.status, detail: tokens }, { status: 502 });

    return NextResponse.json({
      success: true,
      note: 'Copy these and give them to Chisam. The access_token expires in ~1 hour; use the refresh_token (with the Client ID + Secret) to get a new one via POST https://auth.bouncie.com/oauth/token.',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      token_type: tokens.token_type,
      apiBaseUrl: 'https://api.bouncie.dev/v1/',
    });
  } catch (e) {
    return NextResponse.json({ error: 'token exchange threw: ' + String(e) }, { status: 502 });
  }
}
