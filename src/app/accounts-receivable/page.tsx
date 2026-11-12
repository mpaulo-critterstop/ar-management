import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canAccessModule } from "@/lib/access";
import ARApp from "@/components/ARApp";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!canAccessModule(session.user as any, 'ar')) redirect("/");
  return <ARApp />;
}
