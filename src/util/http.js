export const USER_AGENT = "nk-dados/1.0 (+https://github.com/nass1n/nk-dados)";

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Download com novas tentativas. 404 → null (arquivo ainda não publicado).
export async function baixar(url, { tentativas = 3, timeoutMs = 180000, esperasMs = [2000, 5000] } = {}) {
  let detalhe = "";
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 404) return null;
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      detalhe = `HTTP ${r.status}`;
      if (r.status < 500 && r.status !== 429) break;
    } catch (e) {
      detalhe = e.message;
    }
    if (i < tentativas - 1) await esperar(esperasMs[i] ?? esperasMs[esperasMs.length - 1] ?? 1000);
  }
  throw new Error(`falha ao baixar ${url}: ${detalhe}`);
}
