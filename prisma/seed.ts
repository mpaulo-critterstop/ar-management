import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database…");

  const pw = await bcrypt.hash("CritterstopAR!1", 10);

  // Admin account — sees all offices
  await prisma.user.upsert({
    where: { email: "admin@critterstop.com" },
    update: {},
    create: {
      email: "admin@critterstop.com",
      name: "Admin",
      password: pw,
      role: "ADMIN",
      office: "ALL",
    },
  });

  // Office accounts
  const offices = [
    { email: "dfw@critterstoppest.com", name: "DFW Office", office: "DFW" },
    { email: "atx@critterstoppest.com", name: "ATX Office", office: "ATX" },
    { email: "cstat@critterstoppest.com", name: "CStat Office", office: "CSTAT" },
    { email: "okc@critterstoppest.com", name: "OKC Office", office: "OKC" },
  ];

  for (const o of offices) {
    await prisma.user.upsert({
      where: { email: o.email },
      update: {},
      create: {
        email: o.email,
        name: o.name,
        password: pw,
        role: "MANAGER",
        office: o.office,
      },
    });
    console.log(`✓ ${o.name} created — ${o.email}`);
  }

  console.log("✓ Admin created — admin@critterstop.com");
  console.log("All accounts password: CritterStop2026!");
  console.log("Seed complete!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
