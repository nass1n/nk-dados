import { inflateRawSync } from "node:zlib";

// Leitor de .zip sem dependências (formato PKWARE), com suporte a zip64.
const FIM = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const LOCALIZADOR_ZIP64 = 0x07064b50;

function acharFim(buf) {
  const limite = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= limite; i--) {
    if (buf.readUInt32LE(i) === FIM) return i;
  }
  throw new Error("zip inválido: fim do diretório central não encontrado");
}

export function abrirZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error("zip inválido: arquivo curto demais");
  const fim = acharFim(buf);
  let total = buf.readUInt16LE(fim + 10);
  let inicio = buf.readUInt32LE(fim + 16);
  if ((inicio === 0xffffffff || total === 0xffff) && fim >= 20 && buf.readUInt32LE(fim - 20) === LOCALIZADOR_ZIP64) {
    const fim64 = Number(buf.readBigUInt64LE(fim - 20 + 8));
    total = Number(buf.readBigUInt64LE(fim64 + 32));
    inicio = Number(buf.readBigUInt64LE(fim64 + 48));
  }
  const entradas = new Map();
  let p = inicio;
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== CENTRAL) throw new Error("zip inválido: diretório central corrompido");
    const metodo = buf.readUInt16LE(p + 10);
    let comprimido = buf.readUInt32LE(p + 20);
    let tamanho = buf.readUInt32LE(p + 24);
    const nNome = buf.readUInt16LE(p + 28);
    const nExtra = buf.readUInt16LE(p + 30);
    const nComentario = buf.readUInt16LE(p + 32);
    let local = buf.readUInt32LE(p + 42);
    const nome = buf.toString("utf8", p + 46, p + 46 + nNome);
    for (let e = p + 46 + nNome; e + 4 <= p + 46 + nNome + nExtra; ) {
      const id = buf.readUInt16LE(e);
      const tam = buf.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (tamanho === 0xffffffff) { tamanho = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (comprimido === 0xffffffff) { comprimido = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (local === 0xffffffff) local = Number(buf.readBigUInt64LE(q));
      }
      e += 4 + tam;
    }
    entradas.set(nome, { metodo, comprimido, tamanho, local });
    p += 46 + nNome + nExtra + nComentario;
  }

  function ler(nome) {
    const e = entradas.get(nome);
    if (!e) return null;
    if (buf.readUInt32LE(e.local) !== LOCAL) throw new Error(`zip inválido: cabeçalho local de ${nome}`);
    const dados = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const bruto = buf.subarray(dados, dados + e.comprimido);
    if (e.metodo === 0) return Buffer.from(bruto);
    if (e.metodo === 8) return inflateRawSync(bruto);
    throw new Error(`zip: método de compressão ${e.metodo} não suportado (${nome})`);
  }

  const nomes = [...entradas.keys()];
  return {
    nomes,
    ler,
    lerPorPadrao(re) {
      const n = nomes.find((x) => re.test(x));
      return n ? ler(n) : null;
    },
  };
}
