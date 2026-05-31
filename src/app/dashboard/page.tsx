import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import ARApp from "@/components/ARApp";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  return (
    <main style={{ maxWidth:1200, margin:"0 auto", padding:"1.5rem" }}>
      <div style={{ background:"#92c1e9", padding:"0 1.5rem", height:50, display:"flex", alignItems:"center", marginBottom:"1.5rem", borderRadius:12 }}>
        <span style={{ color:"#fff", fontWeight:500, fontSize:16 }}>Accounts Receivable</span>
      </div>
      <ARApp />
    </main>
  );
}
