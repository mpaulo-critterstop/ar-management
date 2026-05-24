import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import ARApp from "@/components/ARApp";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <main style={{ maxWidth:1100, margin:"0 auto", padding:"1.5rem" }}>
      <div style={{ background:"#2C2C2A", padding:"0 1.5rem", height:50, display:"flex", alignItems:"center", marginBottom:"1.5rem", borderRadius:12 }}>
        <span style={{ color:"#fff", fontWeight:700, fontSize:16 }}>Critter Stop — AR Management</span>
        <div style={{ flex:1 }} />
        <span style={{ color:"#888780", fontSize:12, marginRight:8 }}>Office:</span>
        <div id="office-selector-slot" style={{marginRight:12}}/>
        <span style={{ color:"#888780", fontSize:13 }}>{session.user?.name}</span>
      </div>
      <ARApp />
    </main>
  );
}
