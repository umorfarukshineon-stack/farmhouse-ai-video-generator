"use client";

import { FormEvent, useEffect, useState } from "react";
type Provider = { id: string; name: string };
type Work = { id: string; prompt: string; duration: number; provider: string; videoUrl: string; createdAt: string };
const STORAGE_KEY = "farmhouse-ai-work-library-v1";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<3 | 5 | 10 | 14>(5);
  const [provider, setProvider] = useState("auto");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [usedProvider, setUsedProvider] = useState("");
  const [error, setError] = useState("");
  const [library, setLibrary] = useState<Work[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);

  useEffect(() => {
    fetch("/api/generate").then(r => r.json()).then(d => setProviders(d.providers || [])).catch(() => {});
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setLibrary(parsed);
      }
    } catch { /* Ignore corrupted local library data. */ }
    setLibraryReady(true);
  }, []);

  useEffect(() => {
    if (!libraryReady) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(library)); }
    catch { setError("Your browser storage is full. Remove older library items and try again."); }
  }, [library, libraryReady]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(""); setVideoUrl(""); setUsedProvider("");
    try {
      const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, duration, provider }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Video generation failed.");
      const url = data.videoUrl || data.url || "";
      if (!url) throw new Error("The model did not return a video URL.");
      const name = data.providerName || "AI provider";
      setVideoUrl(url); setUsedProvider(name);
      setLibrary(current => [{ id: crypto.randomUUID(), prompt, duration, provider: name, videoUrl: url, createdAt: new Date().toISOString() }, ...current].slice(0, 40));
    } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong."); }
    finally { setLoading(false); }
  }

  function removeWork(id: string) {
    setLibrary(current => current.filter(item => item.id !== id));
  }

  return <main className="shell"><section className="hero">
    <p className="eyebrow">AI CREATIVE STUDIO</p><h1>Farmhouse AI Video Generator</h1>
    <p className="intro">Turn your ideas into warm, cozy farmhouse-inspired videos.</p>
    <form onSubmit={handleSubmit} className="generator">
      <label htmlFor="prompt">Describe your video</label>
      <textarea id="prompt" value={prompt} onChange={e => setPrompt(e.target.value)} required minLength={5} placeholder="A cozy American farmhouse kitchen with warm sunlight, cream cabinets, rustic wooden countertops and fresh flowers..." />
      <label htmlFor="provider">AI provider</label>
      <select id="provider" value={provider} onChange={e => setProvider(e.target.value)}>
        <option value="auto">Auto — try providers in order</option>
        {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <label htmlFor="duration">Video duration</label>
      <select id="duration" value={duration} onChange={e => setDuration(Number(e.target.value) as 3 | 5 | 10 | 14)}>
        <option value={3}>3 seconds</option><option value={5}>5 seconds</option><option value={10}>10 seconds (Hugging Face)</option><option value={14}>14 seconds (Hugging Face maximum)</option>
      </select>
      <p className="footnote">9:16 vertical · Reels / TikTok. Only configured free Hugging Face Spaces are used. No paid API fallback.</p>
      <button disabled={loading || prompt.trim().length < 5}>{loading ? "Generating video..." : "Generate video"}</button>
    </form>
    {loading && <p className="notice">Your request is processing. Auto mode will try the next configured provider if one fails.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {videoUrl && <section className="result"><h2>Your video</h2><p className="footnote">Generated with: {usedProvider}</p><video controls playsInline src={videoUrl} /><a href={videoUrl} target="_blank" rel="noreferrer">Open or download video</a></section>}
    <section className="result" aria-labelledby="work-library-title">
      <h2 id="work-library-title">Work Library</h2>
      <p className="footnote">Your recent generated videos are saved in this browser. Video links from AI providers may expire; download videos you want to keep permanently.</p>
      {!library.length ? <p className="footnote">No saved videos yet. Generate a video and it will appear here.</p> : <div className="library-list">
        {library.map(item => <article className="library-item" key={item.id}>
          <h3>{item.prompt.length > 100 ? item.prompt.slice(0, 100) + "…" : item.prompt}</h3>
          <p className="footnote">{item.duration}s · {item.provider} · {new Date(item.createdAt).toLocaleString()}</p>
          <video controls playsInline preload="metadata" src={item.videoUrl} />
          <div className="library-actions"><a href={item.videoUrl} target="_blank" rel="noreferrer">Open / Download</a><button type="button" className="secondary" onClick={() => removeWork(item.id)}>Remove</button></div>
        </article>)}
      </div>}
    </section>
    <p className="footnote">30-second stitching is not enabled yet. This app uses free Hugging Face Spaces only; it will never switch to a paid API automatically.</p>
  </section></main>;
}
