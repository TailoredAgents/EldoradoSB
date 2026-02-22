"use server";

import crypto from "node:crypto";
import { prisma, Prisma, CampaignType } from "@el-dorado/db";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

function requireString(value: FormDataEntryValue | null, name: string): string {
  const str = String(value ?? "").trim();
  if (!str) throw new Error(`Missing ${name}`);
  return str;
}

function randomToken(bytes = 16): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export async function createCampaignAction(formData: FormData) {
  try {
    const name = requireString(formData.get("name"), "name");
    const typeRaw = String(formData.get("type") ?? "mixed").trim() as CampaignType;
    const type = Object.values(CampaignType).includes(typeRaw) ? typeRaw : CampaignType.mixed;

    await prisma.campaign.create({
      data: { name, type, active: true },
    });

    revalidatePath("/campaigns");
    redirect("/campaigns?ok=1");
  } catch {
    redirect("/campaigns?error=1");
  }
}

export async function createTrackingLinkAction(formData: FormData) {
  try {
    const campaignId = requireString(formData.get("campaignId"), "campaignId");
    const destinationUrl =
      String(formData.get("destinationUrl") ?? "").trim() || "https://eldoradosb.com/";
    const label = String(formData.get("label") ?? "").trim() || null;

    // Token collisions are unlikely, but handle them deterministically.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = randomToken(16);
      try {
        await prisma.trackingLink.create({
          data: {
            campaignId,
            token,
            destinationUrl,
            label,
            active: true,
          },
        });
        revalidatePath("/campaigns");
        redirect("/campaigns?ok=1");
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          continue;
        }
        throw err;
      }
    }

    throw new Error("Failed to generate unique token");
  } catch {
    redirect("/campaigns?error=1");
  }
}

