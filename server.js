import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import OpenAI from "openai";

import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || "gpt-5.4";

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY environment variable.");
  process.exit(1);
}

const client = new OpenAI({ apiKey: OPENAI_API_KEY });
const conversationMap = new Map();

const SYSTEM_INSTRUCTIONS = `
You are Plant Systems Second Brain.

Role:
- Manufacturing operations and automation copilot for York MES / Liquid Laundry.
- Interpret live MES context in plant language.
- Be practical, direct, structured, and production-oriented.

Operating assumptions:
- LLD = Liquid Laundry.
- Lines are lld1, lld2, lld3, lld4, lld5.
- Use the supplied context as the current source of truth.
- Do not invent live values that are not present in context.
- If context is stale or incomplete, say so clearly.

Preferred answer structure:
1. Current read
2. Why it matters
3. Do this next
4. Confidence / freshness caveat if relevant

Tone:
- concise
- decisive
- implementation-focused
`;

function normalizeContext(context) {
  return {
    site: context?.site ?? "York",
    area: context?.area ?? "Liquid Laundry",
    focusedLine: context?.focusedLine ?? "unknown",
    focusedLineIndex: context?.focusedLineIndex ?? null,
    runStatus: context?.runStatus ?? null,
    runStatusText: context?.runStatusText ?? "unknown",
    faultCode: context?.faultCode ?? "--------",
    decodedCategory: context?.decodedCategory ?? "Other",
    oeeProxyPct: context?.oeeProxyPct ?? null,
    shiftNumber: context?.shiftNumber ?? null,
    shiftEndsIn: context?.shiftEndsIn ?? null,
    freshness: context?.freshness ?? {},
    lines: Array.isArray(context?.lines) ? context.lines : []
  };
}

function buildInput(prompt, context) {
  const normalized = normalizeContext(context);

  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text:
`User question:
${prompt}

Current MES context:
${JSON.stringify(normalized, null, 2)}

Respond as Plant Systems Second Brain using only this context for live status.`
        }
      ]
    }
  ];
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "plant-systems-second-brain-version1",
    model: MODEL
  });
});

app.post("/api/plant-second-brain/respond", async (req, res) => {
  try {
    const { prompt, context, conversation_id } = req.body ?? {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required" });
    }

    if (!context || typeof context !== "object") {
      return res.status(400).json({ error: "context is required" });
    }

    const browserConversationId = conversation_id || crypto.randomUUID();
    const previousResponseId = conversationMap.get(browserConversationId);

    const response = await client.responses.create({
      model: MODEL,
      instructions: SYSTEM_INSTRUCTIONS,
      input: buildInput(prompt, context),
      previous_response_id: previousResponseId,
      store: true,
      reasoning: { effort: "low" }
    });

    conversationMap.set(browserConversationId, response.id);

    res.json({
      conversation_id: browserConversationId,
      response_id: response.id,
      output_text: response.output_text || ""
    });
  } catch (error) {
    console.error("Assistant backend error:", error);

    res.status(500).json({
      error: "assistant_backend_error",
      message: error?.message || "Unknown server error"
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "z.html"));
});

app.listen(PORT, () => {
  console.log(`Plant Systems Second Brain backend listening on http://localhost:${PORT}`);
});
