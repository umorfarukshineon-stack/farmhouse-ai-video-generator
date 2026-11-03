import { NextResponse } from "next/server";
import { Client } from "@gradio/client";

export const runtime = "nodejs";
export const maxDuration = 300;

type ProviderConfig = { id: string; name: string; spaceId: string; apiName: string; inputsJson: string; tokenEnv?: string };
function getProviders(): ProviderConfig[] {
  const raw = process.env.HF_PROVIDERS_JSON;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("HF_PROVIDERS_JSON must be a JSON array.");
    return parsed.filter((p: any) => p && p.id && p.name && p.spaceId && p.apiName).map((p: any) => ({
      id: String(p.id), name: String(p.name), spaceId: String(p.spaceId), apiName: String(p.apiName),
      inputsJson: typeof p.inputsJson === "string" ? p.inputsJson : '[ "{{prompt}}", null, null, "544x960 · 9:16 fast", 5, 42, false ]',
      tokenEnv: typeof p.tokenEnv === "string" ? p.tokenEnv : "HF_TOKEN",
    }));
  }
  if (process.env.HF_SPACE_ID && process.env.HF_API_NAME) return [{
    id: "huggingface-primary", name: "Hugging Face (primary)", spaceId: process.env.HF_SPACE_ID,
    apiName: process.env.HF_API_NAME,
    inputsJson: process.env.HF_INPUTS_JSON || '[ "{{prompt}}", null, null, "544x960 · 9:16 fast", 5, 42, false ]',
    tokenEnv: "HF_TOKEN",
  }];
  return [];
}
function findVideoUrl(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
  if (Array.isArray(value)) { for (const item of value) { const found = findVideoUrl(item); if (found) return found; } }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["video", "url", "path", "src"]) { const found = findVideoUrl(obj[key]); if (found) return found; }
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
  if (/quota|zerogpu|exceeded.*free|rate.?limit|too many requests|429/i.test(message))
    return "This provider's free generation quota is currently exhausted or rate-limited. Auto mode will try another configured provider. If all providers are exhausted, please try again after the quota resets.";
  return message;
}

export async function GET() {
  try {
    const providers = getProviders().map(({ id, name }) => ({ id, name }));
    return NextResponse.json({ providers });
  } catch {
    return NextResponse.json({ providers: [], error: "Provider configuration is invalid." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const duration = Number(body.duration ?? 14);
    const selected = typeof body.provider === "string" ? body.provider : "auto";
    if (prompt.length < 5) return NextResponse.json({ error: "Please enter a more detailed prompt." }, { status: 400 });
    if (![5, 10, 14].includes(duration)) return NextResponse.json({ error: "Choose 5, 10, or 14 seconds. This model's maximum is 14 seconds per clip." }, { status: 400 });

    const providers = getProviders();
    if (!providers.length) return NextResponse.json({ error: "No video provider is configured. Add HF_SPACE_ID and HF_API_NAME or HF_PROVIDERS_JSON in Render." }, { status: 503 });
    const candidates = selected === "auto" ? providers : providers.filter(p => p.id === selected);
    if (!candidates.length) return NextResponse.json({ error: "That provider is not configured. Refresh the page and choose an available provider." }, { status: 400 });

    const failures: string[] = [];
    for (const provider of candidates) {
      try {
        const token = provider.tokenEnv ? process.env[provider.tokenEnv]?.trim() : undefined;
        if (token && !token.startsWith("hf_")) throw new Error(`${provider.tokenEnv} must be a valid Hugging Face token beginning with hf_.`);
        const inputs = JSON.parse(provider.inputsJson);
        if (!Array.isArray(inputs)) throw new Error(`${provider.name}: inputsJson must be a JSON array.`);
        const resolved = inputs.map((v: unknown) => v === "{{prompt}}" ? prompt : v);
        if (resolved.length < 5) throw new Error(`${provider.name}: model duration input must be at index 4.`);
        resolved[4] = duration;
        const client = await Client.connect(provider.spaceId, token ? { hf_token: token as `hf_${string}` } : {});
        const result = await client.predict(provider.apiName, resolved);
        const videoUrl = findVideoUrl(result.data);
        if (!videoUrl) throw new Error("Provider responded, but no video URL was returned.");
        return NextResponse.json({ videoUrl, providerId: provider.id, providerName: provider.name });
      } catch (error) {
        const message = errorText(error);
        console.error(`Provider ${provider.id} failed:`, message);
        failures.push(`${provider.name}: ${friendlyError(message)}`);
        if (selected !== "auto") break;
      }
    }
    return NextResponse.json({ error: failures.length === 1 ? failures[0] : "All configured providers failed. " + failures.join(" | ") }, { status: 503 });
  } catch (error) {
    console.error("Video generation request failed:", error);
    return NextResponse.json({ error: friendlyError(errorText(error)) || "Video generation failed. Please try again." }, { status: 500 });
  }
}
