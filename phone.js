// Normalise un numéro de mobile algérien en « 213XXXXXXXXX » (clé unique d'un client).
// Formats acceptés (espaces, points, tirets et parenthèses ignorés) :
//   0556751401 | +213556751401 | 213556751401 | 00213556751401 | +213 (0)556751401
// Seuls les chiffres 0-9 ASCII sont acceptés : les chiffres arabes (٠١٢…) sont volontairement ignorés.
function normalizeClientPhone(value) {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!/^\+?[0-9\s().-]+$/.test(trimmed)) return null;

  const compact = trimmed.replace(/[\s().-]/g, "");

  // Format local : 05XXXXXXXX, 06XXXXXXXX, 07XXXXXXXX
  const localMatch = compact.match(/^0([567]\d{8})$/);
  if (localMatch) return `213${localMatch[1]}`;

  // Format international : +213…, 213… ou 00213…, avec éventuellement le 0 local gardé (+213 (0)5…)
  const internationalMatch = compact.match(/^(?:\+|00)?213(?:0)?([567]\d{8})$/);
  return internationalMatch ? `213${internationalMatch[1]}` : null;
}

module.exports = { normalizeClientPhone };
