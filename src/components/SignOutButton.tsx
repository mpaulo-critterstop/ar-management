"use client";
import { signOut } from "next-auth/react";

export default function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      style={{ background:"none", border:"1px solid #888780", color:"#888780", padding:"4px 12px", borderRadius:6, cursor:"pointer", fontSize:12, fontWeight:500 }}
    >
      Sign out
    </button>
  );
}
