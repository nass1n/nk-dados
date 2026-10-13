export function normalizar(texto) {
  return String(texto ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function numero(valor) {
  if (valor === null || valor === undefined) return null;
  let s = String(valor).trim();
  if (!s) return null;
  if (!s.includes(".")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const CONECTIVOS = new Set(["de", "da", "do", "das", "dos", "e"]);
export function nomeEmTitulo(texto) {
  const palavras = String(texto ?? "").trim().split(/\s+/).filter(Boolean);
  return palavras.map((p, i) => {
    const min = p.toLowerCase();
    if (/[./]/.test(p)) return p.toUpperCase();
    if (i > 0 && CONECTIVOS.has(min)) return min;
    if (!/[aeiouy]/.test(normalizar(min).replace(/[^a-z]/g, "")) && /[a-z]/.test(normalizar(min))) return p.toUpperCase();
    return min.replace(/^([^a-zà-ÿ]*)([a-zà-ÿ])/, (_, a, b) => a + b.toUpperCase());
  }).join(" ");
}

export function arredondar(valor, casas = 2) {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return null;
  const f = 10 ** casas;
  const r = Math.sign(valor) * Math.round(Math.abs(valor) * f + 1e-9) / f;
  return Object.is(r, -0) ? 0 : r;
}
