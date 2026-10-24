// Surname particles that belong with the surname: Le Normand, De Paul, Di María.
const PARTICLES = new Set(['le', 'la', 'de', 'del', 'della', 'di', 'da', 'dos', 'du', 'van', 'von', 'der', 'ter', 'mac', 'st'])

// Players known by more than their last word.
const KNOWN_AS: Record<string, string> = {
  'Kolo Muani': 'Kolo Muani',
  // Family name first.
  'Son Heung-Min': 'Son',
  'Son Heung-min': 'Son',
  'Kim Min-Jae': 'Kim',
}

/** The short name a commentator would use: the surname, keeping its particles. */
export function shortName(name: string): string {
  if (KNOWN_AS[name]) return KNOWN_AS[name]
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name
  let start = parts.length - 1
  while (start > 1 && PARTICLES.has(parts[start - 1].toLowerCase())) start--
  return parts.slice(start).join(' ')
}
