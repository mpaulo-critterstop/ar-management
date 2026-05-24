import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import ARApp from "@/components/ARApp";
import SignOutButton from "@/components/SignOutButton";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <main style={{ maxWidth:1100, margin:"0 auto", padding:"1.5rem" }}>
      <div style={{ background:"#2C2C2A", padding:"0 1.5rem", height:50, display:"flex", alignItems:"center", marginBottom:"1.5rem", borderRadius:12 }}>
        <span style={{ color:"#fff", fontWeight:700, fontSize:16 }}>Critter Stop — AR Management</span>
        <div style={{ flex:1 }} />
        <SignOutButton />
      </div>
      <ARApp />
    </main>
  );
}
