/**
 * Regenerates Códice's SAT corpus in `docs/sat-md` from the SAT's published files (the Phase 0
 * Anexo 20 files; the current RMF as the SAT compiles it; the current Carta Porte instructivos, one
 * a mode of transport; the Comercio Exterior guide) and records each file's version in
 * `docs/sat-md/sources.json`.
 *
 *   pnpm --filter @codice/api sat:knowledge            regenerate what changed
 *   pnpm --filter @codice/api sat:knowledge --check    exit 1 if the SAT published anything new
 *   pnpm --filter @codice/api sat:knowledge --force    regenerate everything
 *
 * Needs LibreOffice (`soffice`) for the spreadsheets, and MarkItDown (`markitdown`) with Poppler
 * (`pdfinfo`) for a changed PDF guide.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  CARTA_PORTE_MODES,
  cartaPorteFile,
  type CartaPorteSourceId,
  type SatSourceId,
} from "./sat-documents";
import {
  SAT_CORPUS_CATALOGS,
  type SatCatalogSet,
  type SatErrorMatrix,
  type SatSource,
} from "./sat-records";
import {
  catalogXsdDifferences,
  instructivoMarkdown,
  parseCatalogSheet,
  parseErrorMatrix,
  provenanceHeader,
  renderCatalogs,
  renderErrorMatrix,
  rmfCompilationMarkdown,
  xsdCatalogCodes,
} from "./sat-knowledge-render";
import { workbookSheets } from "./sat-workbook";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, "docs/sat-md");
const MANIFEST = join(OUT, "sources.json");
const ANEXO_20_PAGE = "http://omawww.sat.gob.mx/tramitesyservicios/Paginas/anexo_20.htm";
const DOCUMENTS = "http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos";
const CATALOG_XSD = "http://www.sat.gob.mx/sitio_internet/cfd/catalogos/catCFDI.xsd";
/** The SAT's page for the current RMF: the resolution, its amendments and their compilations. */
const RMF_SITE = "https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE";
const RMF_YEAR = 2026;
const RMF_PAGE = `${RMF_SITE}/normatividad_rmf_rgce${RMF_YEAR}.html`;
const RMF_FILE = `resolucion-miscelanea-fiscal-${RMF_YEAR}.md`;
/** The SAT's pages for the Carta Porte and Comercio Exterior complements. */
const CARTA_PORTE_PAGE =
  "http://omawww.sat.gob.mx/tramitesyservicios/Paginas/complemento_carta_porte.htm";
const COMERCIO_EXTERIOR_PAGE =
  "http://omawww.sat.gob.mx/tramitesyservicios/Paginas/complemento_comercio_exterior.htm";
const COMERCIO_EXTERIOR_FILE = "complemento-comercio-exterior-guia-de-llenado.md";

type Manifest = Record<SatSourceId, SatSource & { readonly outputs: readonly string[] }>;

const args = new Set(process.argv.slice(2));
const today = new Date().toISOString().slice(0, 10);
const work = mkdtempSync(join(tmpdir(), "sat-knowledge-"));

async function download(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `MatrizDeErrores_CFDI_v40_20260325.xls` → `2026-03-25`. */
function fileNameDate(url: string) {
  const match = /_(\d{4})(\d{2})(\d{2})\.\w+$/u.exec(url);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** The current file a SAT page links, such as `catCFDI_V_4_20261015.xls`. */
function linked(page: string, pattern: RegExp) {
  const match = pattern.exec(page);
  if (!match) throw new Error(`The SAT's page no longer links ${pattern}`);
  return `${DOCUMENTS}/${match[0]}`;
}

/**
 * The current Carta Porte instructivo for a mode of transport: the page links one a version of the
 * complement (`…_Maritimo_31.pdf` for 3.1, `…_Maritimo_3.0.pdf` for 3.0, and 2.0's unnumbered), and
 * the highest version is the one in force.
 */
function currentInstructivo(page: string, id: CartaPorteSourceId) {
  const pattern = new RegExp(
    `Instructivo_ComplementoCartaPorte_${CARTA_PORTE_MODES[id].file}_(\\d)\\.?(\\d)\\.pdf`,
    "gu",
  );
  const latest = [...page.matchAll(pattern)]
    .map((match) => ({ file: match[0], version: Number(`${match[1]}.${match[2]}`) }))
    .sort((left, right) => left.version - right.version)
    .at(-1);
  if (!latest) throw new Error(`${CARTA_PORTE_PAGE} no longer links a ${id} instructivo`);
  return { url: `${DOCUMENTS}/${latest.file}`, version: latest.version.toFixed(1) };
}

/**
 * The latest compiled RMF the SAT's page links. Each compilation holds the whole RMF as amended by
 * every resolution the DOF published until then, and marks each regla an amendment changed with
 * that amendment's DOF date; the amendments themselves only quote the changed paragraphs. The page
 * lists the compilations oldest first, beside those of the annexes.
 */
function latestRmfCompilation(page: string) {
  const pattern = new RegExp(`documentos${RMF_YEAR}/rmf/compiladas/Compilado_[^"]+\\.pdf`, "gu");
  const compilations = [...page.matchAll(pattern)]
    .map((match) => match[0])
    .filter((path) => !/Anexo/iu.test(path));
  const latest = compilations.at(-1);
  if (!latest) throw new Error(`${RMF_PAGE} no longer links a compiled RMF`);
  return `${RMF_SITE}/${latest}`;
}

function run(command: string, commandArgs: string[], options: { readonly cwd?: string } = {}) {
  try {
    return execFileSync(command, commandArgs, {
      cwd: options.cwd,
      encoding: "utf8",
      // The compiled RMF converts to a few MB of Markdown, past the 1 MB default.
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(`${command} failed; is it installed? ${(error as Error).message}`);
  }
}

function source(url: string, bytes: Uint8Array, publishedAt: string | null): SatSource {
  return { url, sha256: sha256(bytes), publishedAt, retrievedAt: today };
}

function write(name: string, content: string) {
  writeFileSync(join(OUT, name), content);
  return name;
}

const GUIDES = {
  anexo20: {
    file: "anexo-20-guia-de-llenado-cfdi.md",
    title: "# Anexo 20: guía de llenado de los comprobantes fiscales (CFDI 4.0)",
  },
  pagos: {
    file: "complemento-pagos-guia-de-llenado.md",
    title:
      "# Guía de llenado del comprobante con complemento para recepción de pagos (REP, Pagos 2.0)",
  },
  comercioExterior: {
    file: COMERCIO_EXTERIOR_FILE,
    title:
      "# Guía de llenado del comprobante al que se le incorpore el complemento para comercio exterior (Comercio Exterior 2.0)",
  },
} as const;

function pdfGuide(id: keyof typeof GUIDES, src: SatSource, path: string) {
  const info = run("pdfinfo", [path]);
  const pages = /^Pages:\s+(\d+)/mu.exec(info)?.[1] ?? "?";
  const markdown = run("markitdown", [path]);
  const meta = GUIDES[id];
  const header = provenanceHeader({
    source: src,
    format: `PDF, ${pages} pages, last modified by the SAT ${src.publishedAt ?? "unknown"}`,
  });
  return [write(meta.file, `${meta.title}\n\n${header}\n\n---\n\n${markdown.trim()}\n`)];
}

function cartaPorteInstructivo(
  id: CartaPorteSourceId,
  version: string,
  src: SatSource,
  path: string,
) {
  const info = run("pdfinfo", [path]);
  const pages = /^Pages:\s+(\d+)/mu.exec(info)?.[1] ?? "?";
  const markdown = instructivoMarkdown(run("markitdown", [path]));
  const header = provenanceHeader({
    source: src,
    format: `PDF, ${pages} pages, last modified by the SAT ${src.publishedAt ?? "unknown"}; the page footers and running headers are left out`,
  });
  const title = `# Instructivo de llenado del CFDI con complemento Carta Porte ${version}: ${CARTA_PORTE_MODES[id].name}`;
  return [write(cartaPorteFile(id), `${title}\n\n${header}\n\n---\n\n${markdown.trim()}\n`)];
}

function rmfCompilation(src: SatSource, path: string) {
  const info = run("pdfinfo", [path]);
  const pages = /^Pages:\s+(\d+)/mu.exec(info)?.[1] ?? "?";
  const markdown = rmfCompilationMarkdown(run("markitdown", [path]));
  const header = provenanceHeader({
    source: src,
    format: `PDF, ${pages} pages, the SAT's compilation of the RMF and its amendments, last modified by the SAT ${src.publishedAt ?? "unknown"}; the page footers are left out`,
  });
  const title = `# Resolución Miscelánea Fiscal para ${RMF_YEAR} (compilación del SAT)`;
  return [write(RMF_FILE, `${title}\n\n${header}\n\n---\n\n${markdown.trim()}\n`)];
}

/** The PDF's own modification date, ISO; the guides carry no date in their file names. */
function pdfDate(path: string) {
  const info = run("pdfinfo", ["-isodates", path]);
  return /^ModDate:\s+(\d{4}-\d{2}-\d{2})/mu.exec(info)?.[1] ?? null;
}

async function main() {
  const page = new TextDecoder("utf-8").decode(await download(ANEXO_20_PAGE));
  const rmfPage = new TextDecoder("utf-8").decode(await download(RMF_PAGE));
  const cartaPortePage = new TextDecoder("utf-8").decode(await download(CARTA_PORTE_PAGE));
  const comercioExteriorPage = new TextDecoder("utf-8").decode(
    await download(COMERCIO_EXTERIOR_PAGE),
  );
  const instructivos = Object.fromEntries(
    (Object.keys(CARTA_PORTE_MODES) as CartaPorteSourceId[]).map((id) => [
      id,
      currentInstructivo(cartaPortePage, id),
    ]),
  ) as Record<CartaPorteSourceId, { url: string; version: string }>;
  const urls: Record<SatSourceId, string> = {
    anexo20: linked(page, /Anexo_20_Guia_de_llenado_CFDI\.pdf/u),
    pagos: `${DOCUMENTS}/Guia_llenado_pagos.pdf`,
    matrix: linked(page, /MatrizDeErrores_CFDI_v40_\d{8}\.xls/u),
    catalogs: linked(page, /catCFDI_V_4_\d{8}\.xls/u),
    rmf: latestRmfCompilation(rmfPage),
    cartaPorteAutotransporte: instructivos.cartaPorteAutotransporte.url,
    cartaPorteMaritimo: instructivos.cartaPorteMaritimo.url,
    cartaPorteAereo: instructivos.cartaPorteAereo.url,
    cartaPorteFerroviario: instructivos.cartaPorteFerroviario.url,
    comercioExterior: linked(comercioExteriorPage, /Guia_complemento_Comercio_Exterior\.pdf/u),
  };
  const previous = (
    existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {}
  ) as Partial<Manifest>;
  const manifest: Partial<Manifest> = { ...previous };
  const written: string[] = [];
  let changed = 0;
  for (const id of Object.keys(urls) as SatSourceId[]) {
    const url = urls[id];
    const bytes = await download(url);
    const path = join(work, url.split("/").at(-1)!);
    writeFileSync(path, bytes);
    const hash = sha256(bytes);
    const same = previous[id]?.url === url && previous[id]?.sha256 === hash;
    console.log(`${same ? "unchanged" : "CHANGED  "} ${id} ${url} ${hash}`);
    if (!same) changed += 1;
    if (args.has("--check") || (same && !args.has("--force"))) continue;
    const pdf = url.endsWith(".pdf");
    const src = source(url, bytes, pdf ? pdfDate(path) : fileNameDate(url));
    let outputs: string[];
    if (id === "anexo20" || id === "pagos" || id === "comercioExterior") {
      outputs = pdfGuide(id, src, path);
    } else if (id in CARTA_PORTE_MODES) {
      const instructivo = id as CartaPorteSourceId;
      outputs = cartaPorteInstructivo(instructivo, instructivos[instructivo].version, src, path);
    } else if (id === "rmf") {
      outputs = rmfCompilation(src, path);
    } else if (id === "matrix") {
      const sheet = [...workbookSheets(path, work).values()][0];
      if (!sheet) throw new Error("The error matrix has no sheet");
      const parsed = parseErrorMatrix(sheet);
      const matrix: SatErrorMatrix = { source: src, ...parsed };
      outputs = [
        write("matriz-de-errores-cfdi-4.0.json", `${JSON.stringify(matrix, null, 2)}\n`),
        write("matriz-de-errores-cfdi-4.0.md", renderErrorMatrix(matrix)),
      ];
    } else {
      const workbook = workbookSheets(path, work);
      const xsd = new TextDecoder("utf-8").decode(await download(CATALOG_XSD));
      const catalogs = SAT_CORPUS_CATALOGS.map((name) => {
        const sheet = workbook.get(name);
        if (!sheet) throw new Error(`catCFDI has no sheet ${name}`);
        const catalog = parseCatalogSheet(name, sheet);
        const codes = xsdCatalogCodes(xsd, name);
        if (codes) {
          const { missingFromSheet, missingFromXsd } = catalogXsdDifferences(catalog, codes);
          if (missingFromSheet.length > 0 || missingFromXsd.length > 0) {
            console.warn(
              `${name}: sheet and catCFDI.xsd differ (not in sheet: ${missingFromSheet.join(", ") || "none"}; not in XSD: ${missingFromXsd.join(", ") || "none"})`,
            );
          }
        }
        return catalog;
      });
      const set: SatCatalogSet = { source: src, catalogs };
      outputs = [
        write("catalogos-cfdi-4.0.json", `${JSON.stringify(set, null, 2)}\n`),
        write("catalogos-cfdi-4.0.md", renderCatalogs(set)),
      ];
    }
    manifest[id] = { ...src, outputs };
    written.push(...outputs);
  }
  if (args.has("--check")) {
    console.log(changed > 0 ? `${changed} SAT source(s) changed; run sat:knowledge` : "Up to date");
    process.exitCode = changed > 0 ? 1 : 0;
    return;
  }
  if (written.length === 0) {
    console.log("Up to date; nothing regenerated (pass --force to regenerate anyway)");
    return;
  }
  write("sources.json", `${JSON.stringify(manifest, null, 2)}\n`);
  // From the repository root, where oxfmt finds the repository's formatting settings. Twice: the
  // guides' broken PDF tables settle only on the second pass. The RMF, the Carta Porte
  // instructivos and the Comercio Exterior guide are in `ignorePatterns`: their numbered lines
  // (`1. Contraseña…`, `13. ¿Qué debo…`) read as Markdown lists, which oxfmt renumbers.
  const formatted = [...written, "sources.json"].map((file) => join(OUT, file));
  for (let pass = 0; pass < 2; pass += 1) {
    run("pnpm", ["exec", "oxfmt", ...formatted], { cwd: ROOT });
  }
  console.log(`Wrote ${written.join(", ")}, sources.json`);
}

mkdirSync(OUT, { recursive: true });
await main();
