import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database…");

  const pw = await bcrypt.hash("CritterstopAR!1", 10);

  // Admin account — sees all offices
  await prisma.user.upsert({
    where: { username: "mpaulo" },
    update: {},
    create: {
      username: "mpaulo",
      email: "mpaulo@critterstop.com",
      name: "Mark Paulo",
      password: pw,
      role: "Admin",
      office: "ALL",
    },
  });

  // Office accounts
  const offices = [
    { username: "dfw", email: "dfw@critterstoppest.com", name: "DFW Office", office: "DFW" },
    { username: "atx", email: "atx@critterstoppest.com", name: "ATX Office", office: "ATX" },
    { username: "cstat", email: "cstat@critterstoppest.com", name: "CStat Office", office: "CSTAT" },
    { username: "okc", email: "okc@critterstoppest.com", name: "OKC Office", office: "OKC" },
  ];

  for (const o of offices) {
    await prisma.user.upsert({
      where: { username: o.username },
      update: {},
      create: {
        username: o.username,
        email: o.email,
        name: o.name,
        password: pw,
        role: "Manager",
        office: o.office,
      },
    });
    console.log(`✓ ${o.name} created — ${o.username}`);
  }

  console.log("✓ Admin created — mpaulo");
  console.log("All accounts password: CritterStop2026!");
  console.log("Seed complete!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
