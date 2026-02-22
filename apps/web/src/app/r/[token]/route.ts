import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@el-dorado/db";

export const dynamic = "force-dynamic";

const FALLBACK_DESTINATION = "https://eldoradosb.com/";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token: tokenRaw } = await context.params;
  const token = String(tokenRaw ?? "").trim();
  if (!token) return NextResponse.redirect(FALLBACK_DESTINATION, { status: 302 });

  const link = await prisma.trackingLink.findUnique({
    where: { token },
    select: {
      id: true,
      active: true,
      destinationUrl: true,
      campaign: { select: { active: true } },
    },
  });

  if (!link || !link.active || !link.campaign.active) {
    return NextResponse.redirect(FALLBACK_DESTINATION, { status: 302 });
  }

  const referrer = req.headers.get("referer");
  const userAgent = req.headers.get("user-agent");

  await prisma.clickEvent.create({
    data: {
      trackingLinkId: link.id,
      referrer: referrer ? referrer.slice(0, 500) : null,
      userAgent: userAgent ? userAgent.slice(0, 500) : null,
    },
  });

  return NextResponse.redirect(link.destinationUrl, { status: 302 });
}
