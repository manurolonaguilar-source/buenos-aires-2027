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

function extrairPrecos(texto) {
  const encontrados = [];

  const regex = /R\$\s?([\d.]+,\d{2})/g;

  let match;

  while ((match = regex.exec(texto)) !== null) {
    const numero = Number(
      match[1]
        .replace(/\./g, "")
        .replace(",", ".")
    );

    if (Number.isFinite(numero)) {
      encontrados.push(numero);
    }
  }

  return encontrados;
}

function menorPreco(precos) {
  if (!precos.length) return null;

  return Math.min(...precos);
}

async function consultarPagina(browser, tipo, url) {
  console.log(`\nConsultando ${tipo}...`);

  const page = await browser.newPage({
    locale: "pt-BR",
    timezoneId: "America/Campo_Grande"
  });

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(8000);

    const texto = await page.locator("body").innerText();

    const precos = extrairPrecos(texto);

    console.log(`Preços encontrados: ${precos.length}`);

    if (!precos.length) {
      console.log(`Nenhum preço encontrado em ${tipo}.`);
      return null;
    }

    const preco = menorPreco(precos);

    console.log(`Menor preço encontrado: R$ ${preco}`);

    return preco;
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

  // Mantém somente os últimos 30 registros
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

    console.log("\nArquivo de preços atualizado.");
  } finally {
    await browser.close();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
