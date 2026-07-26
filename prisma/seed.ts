import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.user.upsert({
    where: { email: 'admin@cocfet.local' },
    update: {},
    create: {
      email: 'admin@cocfet.local',
      role: Role.SUPER_ADMIN,
      firstName: 'Bureau',
      lastName: 'Finissants',
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
