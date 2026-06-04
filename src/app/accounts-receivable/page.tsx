import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import ARApp from "@/components/ARApp";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  return (
    <main style={{ maxWidth:1200, margin:"0 auto", padding:"1.5rem" }}>
      <ARApp />
    </main>
  );
}
