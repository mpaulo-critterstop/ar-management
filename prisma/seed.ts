import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database…");

  // Create admin user
  const pw = await bcrypt.hash("password123", 10);
  await prisma.user.upsert({
    where: { email: "admin@critterstop.com" },
    update: {},
    create: {
      email: "admin@critterstop.com",
      name: "Admin",
      password: pw,
      role: "ADMIN",
    },
  });

  console.log("✓ Admin user created");
  console.log("  Email: admin@critterstop.com");
  console.log("  Password: password123");
  console.log("Seed complete!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
