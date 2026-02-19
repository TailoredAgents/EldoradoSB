import type OpenAI from "openai";

export type WriterInput = {
  prospect: {
    handle: string;
    name?: string | null;
    bio?: string | null;
    url?: string | null;
    location?: string | null;
    followers?: number | null;
    tier?: string | null;
    primarySport?: string | null;
    rationale?: string[] | null;
  };
  offer: {
    revsharePercent: string; // "15-20%"
  };
  disclaimerText?: string | null;
};

export type WriterOutput = {
  dm_text: string;
  email_subject: string;
  email_body: string;
};

export function normalizeWriterOutput(raw: unknown): WriterOutput {
  if (!raw || typeof raw !== "object") throw new Error("Writer output not an object");
  const obj = raw as Record<string, unknown>;
  const dm_text = String(obj.dm_text ?? "").trim();
  const email_subject = String(obj.email_subject ?? "").trim();
  const email_body = String(obj.email_body ?? "").trim();

  if (!dm_text || !email_subject || !email_body) throw new Error("Writer output missing fields");
  return { dm_text, email_subject, email_body };
}

export async function runWriter(args: {
  client: OpenAI;
  model: string;
  input: WriterInput;
}): Promise<{ output: WriterOutput; usage?: { inputTokens?: number; outputTokens?: number } }> {
  const schema = {
    type: "json_schema",
    name: "outreach_drafts",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["dm_text", "email_subject", "email_body"],
      properties: {
        dm_text: { type: "string" },
        email_subject: { type: "string" },
        email_body: { type: "string" },
      },
    },
  } as const;

  const response = await args.client.responses.create({
    model: args.model,
    instructions:
      "You write outreach drafts for recruiting X sports/betting accounts as ambassadors.\n\nRules:\n- Assist-only; do NOT claim the message was sent.\n- Keep DM <= 600 characters.\n- Email should be concise and professional.\n- Include the offer: ambassador receives a rev share percent of deposits from signups under their code.\n- Include a placeholder token {{AMBASSADOR_CODE}} and {{SIGNUP_LINK}}.\n- If disclaimerText is provided, include it at the end of both DM and email (separated clearly).\n- Output STRICT JSON only matching the schema.",
    input: JSON.stringify(args.input),
    temperature: 0.4,
    text: { format: schema },
  });

  const text = (response as any).output_text as string | undefined;
  if (!text) throw new Error("No output_text from writer response");

  const parsed = JSON.parse(text) as unknown;
  const output = normalizeWriterOutput(parsed);

  const usageAny = (response as any).usage as any | undefined;
  const usage =
    usageAny && typeof usageAny === "object"
      ? {
          inputTokens:
            typeof usageAny.input_tokens === "number" ? usageAny.input_tokens : undefined,
          outputTokens:
            typeof usageAny.output_tokens === "number" ? usageAny.output_tokens : undefined,
        }
      : undefined;

  return { output, usage };
}

