"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError("");
    const res = await signIn("credentials", { email, password, redirect: false });
    if (res?.ok) router.push("/dashboard");
    else { setError("Invalid email or password"); setLoading(false); }
  };

  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#F7F6F2" }}>
      <div style={{ background:"#fff", borderRadius:12, border:"1px solid #D3D1C7", padding:"2rem", width:360, boxShadow:"0 4px 24px rgba(0,0,0,0.08)" }}>
        <div style={{ marginBottom:"1.5rem" }}>
          <div style={{ fontSize:20, fontWeight:700, marginBottom:4 }}>Critter Stopper AR</div>
          <div style={{ fontSize:13, color:"#888780" }}>Sign in to your account</div>
        </div>
        <form onSubmit={submit}>
          <div style={{ marginBottom:12 }}>
            <label style={{ display:"block", fontSize:12, fontWeight:500, color:"#888780", marginBottom:4 }}>Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="you@company.com" />
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={{ display:"block", fontSize:12, fontWeight:500, color:"#888780", marginBottom:4 }}>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
          </div>
          {error && <div style={{ fontSize:12, color:"#A32D2D", marginBottom:12, padding:"8px 12px", background:"#FCEBEB", borderRadius:6 }}>{error}</div>}
          <button type="submit" disabled={loading} style={{ width:"100%", padding:"9px", background:"#2C2C2A", color:"#fff", border:"none", borderRadius:8, fontSize:14, fontWeight:500, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1 }}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
