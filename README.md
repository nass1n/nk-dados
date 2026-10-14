# nk-dados

Indicadores de **ações, FIIs e opções da B3** calculados só com dados oficiais e abertos,
para o app NK Invest. Um workflow do GitHub Actions roda em dias úteis, baixa os arquivos
oficiais, aplica as regras abaixo, valida e publica JSON em `dados/`.

> Não é recomendação de investimento. Os números podem ter erros de cálculo ou de
> preenchimento nas fontes; confira nos documentos originais antes de decidir.

## Fontes

| Fonte | O que vem dela |
|---|---|
| [CVM – DFP e ITR](https://dados.cvm.gov.br/dataset/cia_aberta-doc-dfp) | demonstrações financeiras anuais e trimestrais, composição do capital |
| [CVM – FCA](https://dados.cvm.gov.br/dataset/cia_aberta-doc-fca) e [cadastro](https://dados.cvm.gov.br/dataset/cia_aberta-cad) | tickers de cada empresa, composição das units, nome e setor |
| [CVM – Informe mensal de FII](https://dados.cvm.gov.br/dataset/fii-doc-inf_mensal) | patrimônio, cotas, cotistas, rendimentos e composição do ativo dos FIIs |
| [B3 – COTAHIST diário](https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/mercado-a-vista/series-historicas/) | fechamento e volume de ações, FIIs e opções (últimos 21 pregões) |
| [Banco Central – SGS 432](https://dadosabertos.bcb.gov.br/dataset/432-taxa-de-juros---meta-selic-definida-pelo-copom) | meta Selic |
| [Federal Reserve Bank of New York – EFFR](https://www.newyorkfed.org/markets/reference-rates/effr) | juros dos EUA: meta dos Fed Funds e taxa efetiva (opcional: se a API falhar, o campo sai nulo e o resto publica) |

## Regras

**Ações** (12 meses até o último trimestre entregue à CVM; consolidado quando existe)

- Receita, lucro bruto e EBIT pela DRE; lucro dos controladores (se a linha vier em branco, o lucro da controladora).
- EBITDA = EBIT + depreciação/amortização do fluxo de caixa, desacumulada trimestre a trimestre.
- Dívida bruta = empréstimos e financiamentos + **arrendamento**, inclusive o lançado em outras contas. Caixa = caixa + aplicações de curto prazo.
- Ações em circulação (sem tesouraria), com escala e tesouraria conferidas pelo LPA que a empresa publica.
- Units pela composição declarada no FCA. DY = dividendos + JCP **pagos** em 12 meses ÷ valor de mercado.
- CAGR de 5 anos de receita e lucro (só com os dois valores positivos). Bancos e seguradoras sem dívida e EBITDA.

**FIIs**: P/VP = fechamento ÷ valor patrimonial da cota; DY 12m = soma dos rendimentos por cota dos últimos 12
informes ÷ fechamento (rendimento por cota = rendimentos a distribuir ÷ cotas quando coerente com DY do mês × VP;
senão DY do mês × VP); tipo pela composição do ativo (≥ 75% imóveis: Tijolo; ≤ 25%: Papel; entre os dois: Híbrido).

**Opções**: séries que negociaram nos últimos 10 pregões; ativo-objeto pelo ISIN; volatilidade implícita e gregas
pelo Black-Scholes com a Selic e os dias úteis até o vencimento (calendário da B3). Theta por dia útil, vega por 1 ponto
de volatilidade.

## Arquivos

- `dados/mercado.json` — data do pregão, Selic, juros dos EUA (`jurosEua`: `metaMin`, `metaMax`, `efetiva`, `data`) e datas das fontes.
- `dados/acoes.json` — por ticker: empresa, setor, classe, período, fechamento, volume médio, LPA, VPA, P/L, P/VP,
  DY 12m, ROE, margem líquida, dívida líquida/EBITDA, CAGRs, valor de mercado.
- `dados/fiis.json` — por ticker: nome, tipo, segmento, fechamento, VP da cota, P/VP, DY 12m, liquidez, cotistas e os 12 rendimentos.
- `dados/opcoes/indice.json` e `dados/opcoes/<ATIVO>.json` — ativos com opções, mais negociadas e a grade de cada ativo.

Percentuais em pontos percentuais (6.5 = 6,5%); valores em reais.

## Execução

- Dias úteis às 22h30 e às 7h30 (Brasília). Se a B3 ainda não publicou o arquivo do dia às 22h30, a execução termina
  sem publicar e a das 7h30 tenta de novo. Também dá para rodar pelo botão "Run workflow".
- Antes de publicar, a validação exige ≥ 300 ações, ≥ 150 FIIs e ≥ 20 ativos com opções (e PETR4, VALE3, ITUB4,
  HGLG11, KNRI11, MXRF11 e BOVA11 presentes); valores fora de faixas plausíveis viram nulos. Se falhar, nada é
  publicado e o GitHub avisa por e-mail.

```bash
npm test                         # testes com recortes reais das fontes
node src/gerar.js                # gera dados/ (MODO=noturno|matinal|manual)
node src/gerar.js --diagnostico  # grava em saida-diagnostico/ e não falha
```
