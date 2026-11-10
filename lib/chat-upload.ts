import type { FileUIPart } from "ai";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, imageMediaType } from "./image-files";

export class ImageUploadError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// JSON jest nadal obsługiwany dla zwykłego czatu. Zdjęcia trafiają jako binarne
// multipart, a do AI SDK jako standardowe części file z lokalnymi data URL.
export async function readChatBody(request: Request) {
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) return request.json();
  const form = await request.formData();
  const raw = form.get("messages");
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > 100_000) {
    throw new ImageUploadError("Historia rozmowy jest zbyt długa. Odśwież czat i spróbuj ponownie.", 413);
  }
  const body = JSON.parse(raw);
  if (!Array.isArray(body.messages)) throw new ImageUploadError("Nieprawidłowy format rozmowy.");
  let attachments = 0;
  for (const message of body.messages) {
    if (!Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      if (part.type !== "file") continue;
      attachments++;
      if (attachments > 1 || message.role !== "user" || part.url !== "upload:image") throw new ImageUploadError("Dołącz jedno zdjęcie JPG, PNG lub WebP.");
      const file = form.get("image");
      if (!(file instanceof File) || !IMAGE_TYPES.includes(file.type) || file.type !== part.mediaType) throw new ImageUploadError("Dozwolone zdjęcia: JPG, PNG i WebP.");
      if (!file.size || file.size > MAX_IMAGE_BYTES) throw new ImageUploadError("Zdjęcie musi mieć od 1 bajta do 4 MB.", 413);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (imageMediaType(bytes) !== file.type) throw new ImageUploadError("Zawartość zdjęcia nie pasuje do formatu JPG, PNG lub WebP.");
      part.url = `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`;
    }
  }
  return body;
}

export function validateChatImage(part: FileUIPart) {
  if (!IMAGE_TYPES.includes(part.mediaType) || !part.url.startsWith(`data:${part.mediaType};base64,`)) return false;
  const encoded = part.url.slice(part.url.indexOf(",") + 1);
  if (!encoded || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return false;
  const bytes = Buffer.from(encoded, "base64");
  return bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES && bytes.toString("base64") === encoded && imageMediaType(bytes) === part.mediaType;
}
