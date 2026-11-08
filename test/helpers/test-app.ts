import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp, setupSwagger } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
}

/** Boots the complete application (all modules, pipes, filters) against the test database. */
export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  setupSwagger(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

/** Empties every table (children first) so each test starts from a known state. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.stockReservation.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.order.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.sku.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();
}
