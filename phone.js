function normalizeClientPhone(value) {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!/^\+?[0-9\s().-]+$/.test(trimmed)) return null;

  const compact = trimmed.replace(/[\s().-]/g, "");
  const localMatch = compact.match(/^0([567]\d{8})$/);
  if (localMatch) return `213${localMatch[1]}`;

  const internationalMatch = compact.match(/^\+?213([567]\d{8})$/);
  return internationalMatch ? `213${internationalMatch[1]}` : null;
}

module.exports = { normalizeClientPhone };
