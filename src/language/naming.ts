/** Canonical code-library / CLI naming, not an invented Icon suffix. */
export const proxyName = (id: string): string => {
  const parts = id.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").split("-").filter(Boolean).map(part => part.replace(/[^A-Za-z0-9_$]/g, ""));
  let name = parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join("") || "Icon";
  if (/^[0-9]/.test(name) || /^(default|class|function|var|let|const|new|return|delete|import|export)$/i.test(name)) name = `Icon${name}`;
  return name;
};
