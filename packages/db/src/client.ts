import { PrismaClient } from "@prisma/client";

type PrismaGlobal = typeof globalThis & {
  __prisma?: PrismaClient;
};

const globalForPrisma = globalThis as PrismaGlobal;

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = prisma;

