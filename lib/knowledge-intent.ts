// Rozpoznaje typowe pytania o Studio Nova; pozostałe rozstrzyga również model
// na podstawie opisu searchKnowledge i instrukcji bazowania na źródłach.
export function isCompanyQuestion(text: string) {
  const value = text.normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/gi, "l").toLowerCase();
  if (/diagnostyk|konfiguracj|narzedzi|klucz api|model embedding/u.test(value)) return false;
  return /\bstudio\s+nova\b|\b(?:firm(?:a|y|ie|e)|ofert\p{L}*|cennik\p{L}*|regulamin\p{L}*|konsultacj\p{L}*|pakiet\p{L}*|reklamacj\p{L}*)\b/iu.test(value)
    || /(?:cen\p{L}*|koszt\p{L}*|zaplac\p{L}*).*(?:plan|uslug|wasz)|(?:wasz|uslug|plan).*(?:cen\p{L}*|koszt\p{L}*)/iu.test(value);
}
