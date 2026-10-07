import { chromium } from "playwright";
import fs from "fs";

const DATA_FILE = "data/precos.json";

const URLS = {
  passagem:
    "https://www.skyscanner.com.br/transporte/passagens-aereas/igr/buea/270208/270217/?adultsv2=2&cabinclass=economy&childrenv2=&ref=home&rtn=1&preferdirects=false&outboundaltsenabled=false&inboundaltsenabled=false&fare-attributes=checked-bag,cabin-bag",

  airbnb:
    "https://www.airbnb.com.br/rooms/1784575327864593344?adults=2&check_in=2027-02-08&check_out=2027-02-17"
};

function carregarDados() {
  if (!fs.existsSync(DATA_FILE)) {
    return {
      ultimaAtualizacao: null,
      passagem: {
        url: URLS.passagem,
        preco: null,
        historico: []
      },
      airbnb: {
        url: URLS.airbnb,
        preco: null,
        historico: []
      }
    };
  }

  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function converterPreco(valor) {
  if (!valor) return null;

  let texto = String(valor)
    .replace(/\u00a0/g, " ")
    .replace(/R\$/gi, "")
    .trim();

  const match = texto.match(/[\d.]+(?:,\d{1,2})?/);

  if (!match) return null;

  const numero = Number(
    match[0]
      .replace(/\./g, "")
      .replace(",", ".")
  );

  if (!Number.isFinite(numero)) return null;

  return numero;
}

function extrairPrecosDoTexto(texto) {
  const resultados = [];

  const padroes = [
    /R\$\s?[\d.]+,\d{2}/gi,
    /BRL\s?[\d.]+,\d{2}/gi,
    /[\d.]+,\d{2}\s?BRL/gi
  ];

  for (const regex of padroes) {
    const encontrados = texto.match(regex) || [];

    for (const item of encontrados) {
      const preco = converterPreco(item);

      if (preco !== null) {
        resultados.push(preco);
      }
    }
  }

  return resultados;
}

function filtrarPrecos(precos, tipo) {
  const validos = precos.filter((p) => {
    if (!Number.isFinite(p)) return false;

    // Evita números absurdamente pequenos ou grandes
    if (p < 50 || p > 100000) return false;

    // Para passagem, preços muito baixos provavelmente são
    // impostos, taxas ou valores quebrados da página.
    if (tipo === "passagem" && p < 300) return false;

    return true;
  });

  return [...new Set(validos)];
}

async function extrairDadosDaPagina(page, tipo) {
  const resultados = [];

  // 1. Texto visível
  try {
    const texto = await page.locator("body").innerText();
    resultados.push(...extrairPrecosDoTexto(texto));
  } catch {}

  // 2. Meta tags
  try {
    const metas = await page.locator("meta").evaluateAll((elements) =>
      elements.map((el) => ({
        property: el.getAttribute("property"),
        name: el.getAttribute("name"),
        content: el.getAttribute("content")
      }))
    );

    for (const meta of metas) {
      if (meta.content) {
        resultados.push(...extrairPrecosDoTexto(meta.content));
      }
    }
  } catch {}

  // 3. JSON-LD
  try {
    const jsonld = await page.locator('script[type="application/ld+json"]').allTextContents();

    for (const bloco of jsonld) {
      resultados.push(...extrairPrecosDoTexto(bloco));
    }
  } catch {}

  // 4. HTML completo
  try {
    const html = await page.content();

    resultados.push(...extrairPrecosDoTexto(html));
  } catch {}

  return filtrarPrecos(resultados, tipo);
}

async function consultarPagina(browser, tipo, url) {
  console.log("");
  console.log("====================================");
  console.log(`Consultando ${tipo}...`);
  console.log("====================================");

  const page = await browser.newPage({
    locale: "pt-BR",
    timezoneId: "America/Campo_Grande",
    viewport: {
      width: 1440,
      height: 1000
    },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  });

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    console.log("Página carregada.");

    // Dá tempo para conteúdo dinâmico aparecer.
    await page.waitForTimeout(15000);

    const titulo = await page.title().catch(() => "");
    console.log(`Título: ${titulo}`);

    const precos = await extrairDadosDaPagina(page, tipo);

    console.log(`Preços encontrados: ${precos.length}`);

    if (precos.length) {
      console.log(
        "Valores encontrados:",
        precos
          .sort((a, b) => a - b)
          .slice(0, 20)
          .map((p) =>
            p.toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL"
            })
          )
          .join(" | ")
      );

      const menor = Math.min(...precos);

      console.log(
        `Menor valor candidato: ${menor.toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL"
        })}`
      );

      return menor;
    }

    console.log("Nenhum preço foi encontrado.");

    // Salva uma pequena evidência para diagnóstico
    try {
      await page.screenshot({
        path: `debug-${tipo}.png`,
        fullPage: true
      });

      console.log(`Screenshot salvo: debug-${tipo}.png`);
    } catch {}

    return null;
  } catch (erro) {
    console.log(`Erro ao consultar ${tipo}:`);
    console.log(erro.message);

    return null;
  } finally {
    await page.close();
  }
}

function registrarHistorico(item, preco) {
  if (preco === null) return;

  if (!Array.isArray(item.historico)) {
    item.historico = [];
  }

  item.preco = preco;

  item.historico.push({
    data: new Date().toISOString(),
    preco
  });

  if (item.historico.length > 30) {
    item.historico = item.historico.slice(-30);
  }
}

async function main() {
  const dados = carregarDados();

  const browser = await chromium.launch({
    headless: true
  });

  try {
    const passagem = await consultarPagina(
      browser,
      "passagem",
      URLS.passagem
    );

    const airbnb = await consultarPagina(
      browser,
      "Airbnb",
      URLS.airbnb
    );

    registrarHistorico(dados.passagem, passagem);
    registrarHistorico(dados.airbnb, airbnb);

    dados.passagem.url = URLS.passagem;
    dados.airbnb.url = URLS.airbnb;

    dados.ultimaAtualizacao = new Date().toISOString();

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(dados, null, 2),
      "utf8"
    );

    console.log("");
    console.log("====================================");
    console.log("Arquivo de preços atualizado.");
    console.log("====================================");

    console.log(
      "Passagem:",
      passagem === null ? "não encontrada" : passagem
    );

    console.log(
      "Airbnb:",
      airbnb === null ? "não encontrado" : airbnb
    );
  } finally {
    await browser.close();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
