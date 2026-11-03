"use client";

import { FormEvent, useState } from "react";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<15 | 30>(15);
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setVideoUrl("");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, duration }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Video generation failed.");
      setVideoUrl(data.videoUrl || data.url || "");
      if (!data.videoUrl && !data.url) throw new Error("The model did not return a video URL.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">AI CREATIVE STUDIO</p>
        <h1>Farmhouse AI Video Generator</h1>
        <p className="intro">Turn your ideas into warm, cozy farmhouse-inspired videos.</p>
        <form onSubmit={handleSubmit} className="generator">
          <label htmlFor="prompt">Describe your video</label>
          <textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} required minLength={5} placeholder="A cozy American farmhouse kitchen with warm sunlight, cream cabinets, rustic wooden countertops and fresh flowers..." />
          <label htmlFor="duration">Video duration</label>
          <select id="duration" value={duration} onChange={(e) => setDuration(Number(e.target.value) as 15 | 30)}>
            <option value={15}>15 seconds</option>
            <option value={30}>30 seconds</option>
          </select>
          <p className="footnote">Video format: 9:16 vertical (Reels / TikTok)</p>
          <button disabled={loading || prompt.trim().length < 5}>{loading ? "Generating video..." : "Generate video"}</button>
        </form>
        {loading && <p className="notice">Your {duration}-second video request has been sent to the video model. Generation may take a few minutes.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {videoUrl && <section className="result"><h2>Your video</h2><video controls playsInline src={videoUrl} /><a href={videoUrl} target="_blank" rel="noreferrer">Open or download video</a></section>}
        <p className="footnote">Video generation requires a compatible Hugging Face Gradio Space configured in the server environment. Available duration depends on the model's limits.</p>
      </section>
    </main>
  );
}
