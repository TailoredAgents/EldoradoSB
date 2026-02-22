"use server";

import { prisma } from "@el-dorado/db";
import { Prisma } from "@el-dorado/db";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export async function saveTemplatesAction(formData: FormData) {
  const raw = String(formData.get("templates") ?? "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    redirect("/templates?error=json");
  }

  const templates = (parsed === null ? {} : parsed) as Prisma.InputJsonValue;

  await prisma.settings.upsert({
    where: { id: 1 },
    update: { templates },
    create: { id: 1, templates },
  });

  revalidatePath("/templates");
  redirect("/templates?ok=1");
}

