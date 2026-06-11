// src/app/api/bouncie/callback/route.ts
// One-time OAuth callback — exchanges auth code for tokens
// Stores refresh token in DB for ongoing use

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const CLIENT_ID     = 'critter-stop-';
const CLIENT_SECRET = process.env.BOUNCIE_CLIENT_SECRET!;
const REDIRECT_URI  = 'https://hub.critterstop.com/api/bouncie/callback';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:40px">
        <h2 style="color:#e24b4a">Bouncie Auth Error</h2>
        <p>${error}</p>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }

  if (!code) {
    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:40px">
        <h2 style="color:#e24b4a">Missing authorization code</h2>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://auth.bouncie.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type:    'authorization_code',
      code,
      redirect_uri:  REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:40px">
        <h2 style="color:#e24b4a">Token exchange failed</h2>
        <pre>${err}</pre>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }

  const tokens = await tokenRes.json();
  const { access_token, refresh_token, expires_in } = tokens;

  // Store tokens in DB as a key-value setting
  const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);

  await prisma.appSetting.upsert({
    where: { key: 'bouncie_access_token' },
    update: { value: access_token, updatedAt: new Date() },
    create: { key: 'bouncie_access_token', value: access_token },
  });

  await prisma.appSetting.upsert({
    where: { key: 'bouncie_refresh_token' },
    update: { value: refresh_token, updatedAt: new Date() },
    create: { key: 'bouncie_refresh_token', value: refresh_token },
  });

  await prisma.appSetting.upsert({
    where: { key: 'bouncie_token_expires_at' },
    update: { value: expiresAt.toISOString(), updatedAt: new Date() },
    create: { key: 'bouncie_token_expires_at', value: expiresAt.toISOString() },
  });

  return new NextResponse(
    `<html><body style="font-family:sans-serif;padding:40px;max-width:500px;margin:0 auto">
      <h2 style="color:#27500A">✓ Bouncie Connected!</h2>
      <p>Access token stored successfully. Driving data will be pulled automatically on the next weekly sync.</p>
      <p style="color:#64748b;font-size:13px">Expires: ${expiresAt.toLocaleString()}</p>
      <a href="https://hub.critterstop.com/field-performance" 
         style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0052cc;color:#fff;border-radius:8px;text-decoration:none">
        Go to Field Professional Effort Meter →
      </a>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}
