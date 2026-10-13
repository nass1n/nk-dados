export const URL_SELIC = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json";

// Meta Selic (SGS 432), último valor.
export async function buscarSelic({ baixar }) {
  const buf = await baixar(URL_SELIC);
  let dados;
  try {
    dados = JSON.parse(String(buf ?? ""));
  } catch {
    throw new Error("Selic: resposta inválida do Banco Central");
  }
  const ultimo = Array.isArray(dados) ? dados.at(-1) : null;
  const valor = Number(String(ultimo?.valor ?? "").replace(",", "."));
  if (!ultimo || !Number.isFinite(valor)) throw new Error("Selic: resposta vazia do Banco Central");
  const [d, m, a] = String(ultimo.data).split("/");
  return { valor, data: `${a}-${m}-${d}` };
}
