// Dockside Radio — "dj-intro": writes a short spoken song intro in a station host's voice using
// Google Gemini (free tier). Uses the project's existing GEMINI_API_KEY secret (shared with identify-fish).
// Only answers requests coming from the Dockside Radio page. Host personalities live here, not in the page.

const ALLOWED_ORIGINS = ["https://rich9267-stack.github.io"];

const cors = (origin: string) => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

const HOSTS: Record<string, { host: string; station: string; persona: string }> = {
  classic: {
    host: "Big Mike", station: "Classic Rock",
    persona: "a gravelly veteran rock DJ who has been on the air for decades and seen every big band live. Warm, a little gruff, loves a good piece of rock history.",
  },
  alt: {
    host: "Jess", station: "Alternative Rock",
    persona: "a dry, witty alternative rock host with record-store-clerk energy. Understated, a bit sarcastic, clearly loves the music.",
  },
  country: {
    host: "Dusty", station: "Country",
    persona: "a warm, down-home country DJ and natural storyteller. Friendly, unhurried, talks about the heart of the song.",
  },
  rap: {
    host: "Static", station: "Rap",
    persona: "a high-energy hip-hop radio host who knows the culture and its history. Hype, confident, quick.",
  },
  dance: {
    host: "Nova", station: "Dance",
    persona: "a cheeky, glamorous British club-radio host with nonstop party energy. Playful, fast, a little posh, always hyping the dance floor.",
  },
  jazz: {
    host: "Theo", station: "Jazz",
    persona: "a smooth, late-night jazz host. Relaxed, velvet-toned, appreciative of the musicians and the moment.",
  },
};

const MODELS = (Deno.env.get("DJ_MODELS") || Deno.env.get("GEMINI_MODELS") || "gemini-3.5-flash-lite,gemini-3.8-flash")
  .split(",").map((m) => m.trim()).filter(Boolean);

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f"`<>{}]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const headers = { ...cors(origin), "Content-Type": "application/json" };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  if (!ALLOWED_ORIGINS.includes(origin)) return reply({ error: "Not allowed from this site." }, 403);

  try {
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return reply({ error: "No Gemini key saved in Supabase." }, 503);

    const input = await req.json();
    const h = HOSTS[String(input.station)];
    if (!h) return reply({ error: "Unknown station." }, 400);
    const song = clean(input.song, 120);
    const artist = clean(input.artist, 80);
    const prevSong = clean(input.prevSong, 120);
    const prevArtist = clean(input.prevArtist, 80);
    const when = clean(input.when, 40); // e.g. "Sunday morning"
    const first = input.first === true;
    if (!song) return reply({ error: "No song." }, 400);

    const prompt =
      `You are ${h.host}, the on-air host of the ${h.station} station on Dockside Radio, a personal radio station. ` +
      `Your personality: ${h.persona}\n\n` +
      `Write exactly what you say on air right before the next song plays.\n` +
      `Next song: "${song}"${artist ? ` by ${artist}` : ""}.\n` +
      (prevSong ? `The song that just played: "${prevSong}"${prevArtist ? ` by ${prevArtist}` : ""}. You may mention it briefly.\n` : "") +
      (first ? `This is the first song of the session, so welcome the listener to the station and introduce yourself by name.\n` : "") +
      (when ? `It is ${when} for the listener.\n` : "") +
      `Rules: 1 to 3 sentences, under 45 words, written to be spoken aloud. Stay in character. ` +
      `You may share one well-known, true fact about the song or artist only if you are certain of it; never invent facts, dates, chart positions or stories. If unsure, talk about the mood instead. ` +
      `Say the song title and the artist. No emojis, hashtags, sound effects, stage directions, or quotation marks. Don't start with "Next up".`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.95, maxOutputTokens: 1024 },
    };

    let lastErr = "";
    for (const model of MODELS) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        console.error("gemini", model, res.status, detail);
        lastErr += (lastErr ? " | " : "") + `${model}: ${res.status}`;
        continue;
      }
      const data = await res.json();
      let text = (data?.candidates?.[0]?.content?.parts || [])
        .map((p: { text?: string; thought?: boolean }) => (p.thought ? "" : p.text || "")).join(" ");
      text = text.replace(/[*_#"“”]/g, "").replace(/\([^)]*\)|\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
      const words = text.split(" ");
      if (words.length > 60) text = words.slice(0, 60).join(" ").replace(/[,;:]?$/, ".");
      if (!text) { lastErr += (lastErr ? " | " : "") + `${model}: empty`; continue; }
      return reply({ text, host: h.host, model });
    }
    return reply({ error: "Gemini didn't answer.", detail: lastErr }, 503);
  } catch (e) {
    return reply({ error: "Intro failed: " + ((e as Error).message || e) }, 500);
  }
});
