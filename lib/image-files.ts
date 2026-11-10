export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function imageMediaType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export function safeImageDataUrl(url: string, mediaType: string): boolean {
  return IMAGE_TYPES.includes(mediaType) && url.startsWith(`data:${mediaType};base64,`);
}

export async function validatePhotoFile(file: Blob): Promise<string | null> {
  if (!IMAGE_TYPES.includes(file.type)) return "Nieprawidłowy format. Wybierz zdjęcie JPG, PNG lub WebP.";
  if (!file.size || file.size > MAX_IMAGE_BYTES) return "Zdjęcie musi mieć od 1 bajta do 4 MB.";
  try {
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    return imageMediaType(header) === file.type ? null : "Zawartość pliku nie pasuje do formatu JPG, PNG lub WebP.";
  } catch {
    return "Nie można odczytać zdjęcia. Wybierz plik ponownie.";
  }
}
