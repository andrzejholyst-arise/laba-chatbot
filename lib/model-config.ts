// Konfiguracja wyłącznie serwerowa. Nie używamy prefiksu NEXT_PUBLIC_.
export function speechConfig() {
  return {
    model: process.env.OPENROUTER_SPEECH_MODEL?.trim() || "elevenlabs/eleven-flash-v2.5",
    voice: process.env.OPENROUTER_SPEECH_VOICE?.trim() || "sarah",
  };
}

export function imageModelId() {
  return process.env.OPENROUTER_IMAGE_MODEL?.trim() || "google/gemini-3.1-flash-image-preview";
}
