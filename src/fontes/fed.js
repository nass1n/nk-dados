// Juros dos EUA: taxa efetiva dos Fed Funds (EFFR) e a meta do Fed, pela API pública do
// Federal Reserve Bank of New York.
export const URL_FED = "https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json";

const numeroOuNull = (v) => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
};

export function lerJurosEua(json) {
  const r = Array.isArray(json?.refRates) ? json.refRates[0] : null;
  if (!r) throw new Error("Fed: resposta sem refRates");
  const efetiva = numeroOuNull(r.percentRate);
  const metaMin = numeroOuNull(r.targetRateFrom);
  const metaMax = numeroOuNull(r.targetRateTo);
  if (efetiva === null && (metaMin === null || metaMax === null)) throw new Error("Fed: resposta sem taxa");
  return { efetiva, metaMin, metaMax, data: r.effectiveDate ?? null };
}

export async function buscarJurosEua({ baixar }) {
  const buf = await baixar(URL_FED);
  let json;
  try {
    json = JSON.parse(String(buf ?? ""));
  } catch {
    throw new Error("Fed: resposta inválida");
  }
  return lerJurosEua(json);
}
