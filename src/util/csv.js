// CSV dos arquivos oficiais: separador ';', aspas opcionais, UTF-8 ou latin-1.
const utf8Estrito = new TextDecoder("utf-8", { fatal: true });

export function decodificar(buffer) {
  let texto;
  try {
    texto = utf8Estrito.decode(buffer);
  } catch {
    texto = Buffer.from(buffer).toString("latin1");
  }
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

export function dividirLinha(linha, separador = ";") {
  if (!linha.includes('"')) return linha.split(separador);
  const campos = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) {
      if (c === '"') {
        if (linha[i + 1] === '"') { atual += '"'; i++; } else aspas = false;
      } else atual += c;
    } else if (c === '"') aspas = true;
    else if (c === separador) { campos.push(atual); atual = ""; }
    else atual += c;
  }
  campos.push(atual);
  return campos;
}

export function lerCsv(texto, { separador = ";", filtro = null } = {}) {
  const linhas = texto.split("\n");
  let cabecalho = null;
  const saida = [];
  for (let linha of linhas) {
    if (linha.endsWith("\r")) linha = linha.slice(0, -1);
    if (!linha) continue;
    const campos = dividirLinha(linha, separador);
    if (!cabecalho) { cabecalho = campos.map((c) => c.trim()); continue; }
    const obj = {};
    for (let i = 0; i < cabecalho.length; i++) obj[cabecalho[i]] = campos[i] ?? "";
    if (!filtro || filtro(obj)) saida.push(obj);
  }
  return saida;
}

// Procura o primeiro nome de coluna existente entre os candidatos.
export function coluna(obj, ...nomes) {
  for (const n of nomes) if (obj[n] !== undefined) return obj[n];
  return undefined;
}
