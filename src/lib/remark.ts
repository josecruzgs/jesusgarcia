// El campo "remark" de AdsPower es texto libre donde se anota a mano la edad
// y el género del perfil (ej. "25 Hombre", "Mujer, 30 años", "38 H", "30M").
// Se parsea una sola vez al sincronizar/crear el perfil y se guarda en campos
// propios (Profile.age / Profile.gender) para poder filtrar por rango de edad
// y género sin tener que re-parsear texto libre en cada query.
export type Gender = "hombre" | "mujer";

// El orden importa: se corta en la primera que coincida. Las palabras van
// primero porque "Hombre" también satisface la regla de la letra suelta, y
// ante un remark ambiguo queremos que gane la coincidencia más explícita.
//
// La letra suelta pide que no haya otra letra pegada a ningún lado — así
// dispara con "38 H", "H38" y "38H", pero no dentro de una palabra que
// casualmente empiece con H o M ("Monterrey", "Hidalgo").
const GENDER_PATTERNS: { pattern: RegExp; gender: Gender }[] = [
  { pattern: /\b(hombre|male|man)\b/i, gender: "hombre" },
  { pattern: /\b(mujer|female|woman)\b/i, gender: "mujer" },
  { pattern: /(?<!\p{L})h(?!\p{L})/iu, gender: "hombre" },
  { pattern: /(?<!\p{L})m(?!\p{L})/iu, gender: "mujer" },
];

export function parseRemark(remark: string): { age: number | null; gender: Gender | null } {
  // Sin \b, porque en "38H" no hay frontera entre el 8 y la H y la edad se
  // perdía: basta con que el número no esté pegado a otro dígito.
  const ageMatch = remark.match(/(?<!\d)(\d{1,3})(?!\d)/);
  const age = ageMatch ? Number(ageMatch[1]) : null;

  let gender: Gender | null = null;
  for (const { pattern, gender: g } of GENDER_PATTERNS) {
    if (pattern.test(remark)) {
      gender = g;
      break;
    }
  }

  return { age, gender };
}
