import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const caseId = "demo-lantern-archive";

async function seed() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || database.pathname !== "/sherlock_demo") {
    throw new Error("The demonstration seed requires a local sherlock_demo database.");
  }

  await prisma.case.upsert({
    where: { id: caseId },
    update: {},
    create: {
      id: caseId,
      title: "The Lantern Archive",
      description: "A fictional museum loan review. Follow the records that establish when a missing lantern reached the conservation studio.",
      events: { create: [
        { title: "Loan crate received", description: "The receiving register lists two crates from the fictional Alder Quay collection.", startDate: new Date("2025-05-06T09:10:00Z"), eventType: "Document", category: "Evidence" },
        { title: "Packing list discrepancy reported", description: "The unpacking team records one unlabelled lantern in the second crate.", startDate: new Date("2025-05-07T11:30:00Z"), eventType: "Email", category: "Communication" },
        { title: "Conservation register checked", description: "The studio log matches the lantern to the temporary accession label.", startDate: new Date("2025-05-09T14:00:00Z"), eventType: "Meeting", category: "Meeting",
          people: { create: { role: "Witness", person: { create: { name: "Rowan Vale", role: "Registrar", organisation: "Alder Quay Museum", notes: "Fictional demonstration contact." } } } } },
        { title: "Reconciliation recorded", description: "The curator signs the corrected loan inventory.", startDate: new Date("2025-05-12T15:40:00Z"), eventType: "Decision", category: "Decision" },
      ] },
      actions: { create: { title: "File the corrected inventory", description: "Attach the signed register to the loan file.", dueDate: new Date("2025-05-13T16:00:00Z"), status: "Completed" } },
    },
  });
}

seed().catch(() => {
  console.error("Demo setup failed. Check the local database URL and migrations.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
