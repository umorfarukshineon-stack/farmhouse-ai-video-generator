import { NextResponse } from "next/server";
import { Client } from "@gradio/client";

export const runtime = "nodejs";
export const maxDuration = 300;

type HFProvider = { id: string; name: string; spaceId: string; apiName: string; inputsJson: string; tokenEnv?: string };

function getHFProviders(): HFProvider[] {
  const raw = process.env.HF_PROVIDERS_JSON;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("HF_PROVIDERS_JSON must be a JSON array.");
    return parsed.filter((p: any) => p && p.id && p.name && p.spaceId && p.apiName).map((p: any) => ({
      id: String(p.id), name: String(p.name), spaceId: String(p.spaceId), apiName: String(p.apiName),
      inputsJson: typeof p.inputsJson === "string" ? p.inputsJson : '["{{prompt}}"]',
      tokenEnv: typeof p.tokenEnv === "string" ? p.tokenEnv : "HF_TOKEN",
    }));
  }
  if (process.env.HF_SPACE_ID && process.env.HF_API_NAME) return [{
    id: "huggingface-primary", name: "Hugging Face", spaceId: process.env.HF_SPACE_ID,
    apiName: process.env.HF_API_NAME, inputsJson: process.env.HF_INPUTS_JSON || '["{{prompt}}"]', tokenEnv: "HF_TOKEN",
  }];
  return [];
}

function findVideoUrl(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
  if (Array.isArray(value)) { for (const item of value) { const found = findVideoUrl(item); if (found) return found; } }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["video_url", "video", "url", "path", "src", "output"]) { const found = findVideoUrl(obj[key]); if (found) return found; }
    for (const item of Object.values(obj)) { const found = findVideoUrl(item); if (found) return found; }
  }
  return undefined;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return "Unknown provider error"; }
}

function friendlyError(message: string): string {
  if (/quota|zerogpu|exceeded.*free|rate.?limit|too many requests|429|402/i.test(message))
    return "This free provider's quota is exhausted or rate-limited. Auto mode will try another configured free Hugging Face Space. No paid fallback is enabled. Please wait for the free quota to reset.";
  return message;
}

export async function GET() {
  try {
    return NextResponse.json({ providers: getHFProviders().map(({ id, name }) => ({ id, name })) });
  } catch {
    return NextResponse.json({ providers: [], error: "Free provider configuration is invalid." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const duration = Number(body.duration ?? 5);
    const selected = typeof body.provider === "string" ? body.provider : "auto";
    if (prompt.length < 5) return NextResponse.json({ error: "Please enter a more detailed prompt." }, { status: 400 });
    if (![3, 5, 10, 14].includes(duration)) return NextResponse.json({ error: "Choose 3, 5, 10, or 14 seconds." }, { status: 400 });

    const hfProviders = getHFProviders();
    const candidates = hfProviders.filter(p => selected === "auto" || p.id === selected);
    if (!candidates.length) return NextResponse.json({
      error: "No free Hugging Face video provider is configured for this selection. No paid provider will be used.",
    }, { status: 503 });

    const failures: string[] = [];
    for (const p of candidates) {
      try {
        const token = p.tokenEnv ? process.env[p.tokenEnv]?.trim() : undefined;
        if (token && !token.startsWith("hf_")) throw new Error(`${p.tokenEnv} must be a valid Hugging Face token beginning with hf_.`);
        const inputs = JSON.parse(p.inputsJson);
        if (!Array.isArray(inputs)) throw new Error(`${p.name}: inputsJson must be a JSON array.`);
        const resolved = inputs.map((v: unknown) => v === "{{prompt}}" ? prompt : v);
        const client = await Client.connect(p.spaceId, token ? { hf_token: token as `hf_${string}` } : {});
        const result = await client.predict(p.apiName, resolved);
        const videoUrl = findVideoUrl(result.data);
        if (!videoUrl) throw new Error("Provider responded, but no video URL was returned.");
        return NextResponse.json({ videoUrl, providerId: p.id, providerName: p.name });
      } catch (error) {
        const message = friendlyError(errorText(error));
        console.error(`Provider ${p.id} failed:`, message);
        failures.push(`${p.name}: ${message}`);
        if (selected !== "auto") break;
      }
    }
    return NextResponse.json({
      error: failures.length
        ? "All configured free providers failed. " + failures.join(" | ")
        : "No free video provider is configured. Add a compatible public Hugging Face Space in Render. Paid APIs are disabled.",
    }, { status: 503 });
  } catch (error) {
    console.error("Video generation request failed:", error);
    return NextResponse.json({ error: friendlyError(errorText(error)) || "Video generation failed. Please try again." }, { status: 500 });
  }
}
