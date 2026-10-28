/**
 * Regenerates Códice's SAT corpus in `docs/sat-md` from the SAT's published files (the Phase 0
 * Anexo 20 files, and the current RMF as the SAT compiles it) and the federal laws in force as the
 * Cámara de Diputados publishes them (the CFF), and records each file's version in
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
  SAT_CORPUS_CATALOGS,
  type SatCatalogSet,
  type SatErrorMatrix,
  type SatSource,
} from "./sat-records";
import {
  catalogXsdDifferences,
  lawLastReform,
  lawMarkdown,
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
/**
 * The Cámara de Diputados' "Leyes Federales Vigentes" (`index.htm`): each federal law's text in
 * force, at a fixed URL a reform replaces, with the Cámara's note on each reformed part.
 */
const LEYES_FEDERALES = "https://www.diputados.gob.mx/LeyesBiblio";

type SourceId = "anexo20" | "pagos" | "matrix" | "catalogs" | "rmf" | "cff";
type Manifest = Record<SourceId, SatSource & { readonly outputs: readonly string[] }>;

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

/** The current file the Anexo 20 page links, such as `catCFDI_V_4_20261015.xls`. */
function linked(page: string, pattern: RegExp) {
  const match = pattern.exec(page);
  if (!match) throw new Error(`The Anexo 20 page no longer links ${pattern}`);
  return `${DOCUMENTS}/${match[0]}`;
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

function pdfGuide(id: "anexo20" | "pagos", src: SatSource, path: string) {
  const info = run("pdfinfo", [path]);
  const pages = /^Pages:\s+(\d+)/mu.exec(info)?.[1] ?? "?";
  const markdown = run("markitdown", [path]);
  const meta =
    id === "anexo20"
      ? {
          file: "anexo-20-guia-de-llenado-cfdi.md",
          title: "# Anexo 20: guía de llenado de los comprobantes fiscales (CFDI 4.0)",
        }
      : {
          file: "complemento-pagos-guia-de-llenado.md",
          title:
            "# Guía de llenado del comprobante con complemento para recepción de pagos (REP, Pagos 2.0)",
        };
  const header = provenanceHeader({
    source: src,
    format: `PDF, ${pages} pages, last modified by the SAT ${src.publishedAt ?? "unknown"}`,
  });
  return [write(meta.file, `${meta.title}\n\n${header}\n\n---\n\n${markdown.trim()}\n`)];
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

/**
 * A federal law in force, from the Cámara de Diputados' PDF without its page headers and footers,
 * dated by the last reform its cover names (`Última reforma publicada DOF 09-04-2026`).
 */
function federalLaw(url: string, bytes: Uint8Array, path: string) {
  const info = run("pdfinfo", [path]);
  const pages = /^Pages:\s+(\d+)/mu.exec(info)?.[1] ?? "?";
  const markdown = lawMarkdown(run("markitdown", [path]));
  const src = source(url, bytes, lawLastReform(markdown));
  const header = provenanceHeader({
    source: src,
    format: `PDF, ${pages} pages, the Cámara de Diputados' text in force, last reformed DOF ${src.publishedAt}; the page headers and footers are left out`,
    publisher: "the Cámara de Diputados'",
  });
  const title = "# Código Fiscal de la Federación (texto vigente)";
  const outputs = [
    write(
      "codigo-fiscal-de-la-federacion.md",
      `${title}\n\n${header}\n\n---\n\n${markdown.trim()}\n`,
    ),
  ];
  return { ...src, outputs };
}

/** The PDF's own modification date, ISO; the guides carry no date in their file names. */
function pdfDate(path: string) {
  const info = run("pdfinfo", ["-isodates", path]);
  return /^ModDate:\s+(\d{4}-\d{2}-\d{2})/mu.exec(info)?.[1] ?? null;
}

async function main() {
  const page = new TextDecoder("utf-8").decode(await download(ANEXO_20_PAGE));
  const rmfPage = new TextDecoder("utf-8").decode(await download(RMF_PAGE));
  const urls: Record<SourceId, string> = {
    anexo20: linked(page, /Anexo_20_Guia_de_llenado_CFDI\.pdf/u),
    pagos: `${DOCUMENTS}/Guia_llenado_pagos.pdf`,
    matrix: linked(page, /MatrizDeErrores_CFDI_v40_\d{8}\.xls/u),
    catalogs: linked(page, /catCFDI_V_4_\d{8}\.xls/u),
    rmf: latestRmfCompilation(rmfPage),
    cff: `${LEYES_FEDERALES}/pdf/CFF.pdf`,
  };
  const previous = (
    existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {}
  ) as Partial<Manifest>;
  const manifest: Partial<Manifest> = { ...previous };
  const written: string[] = [];
  let changed = 0;
  for (const id of Object.keys(urls) as SourceId[]) {
    const url = urls[id];
    const bytes = await download(url);
    const path = join(work, url.split("/").at(-1)!);
    writeFileSync(path, bytes);
    const hash = sha256(bytes);
    const same = previous[id]?.url === url && previous[id]?.sha256 === hash;
    console.log(`${same ? "unchanged" : "CHANGED  "} ${id} ${url} ${hash}`);
    if (!same) changed += 1;
    if (args.has("--check") || (same && !args.has("--force"))) continue;
    if (id === "cff") {
      manifest[id] = federalLaw(url, bytes, path);
      written.push(...manifest[id].outputs);
      continue;
    }
    const pdf = id === "anexo20" || id === "pagos" || id === "rmf";
    const src = source(url, bytes, pdf ? pdfDate(path) : fileNameDate(url));
    let outputs: string[];
    if (id === "anexo20" || id === "pagos") {
      outputs = pdfGuide(id, src, path);
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
  // guides' broken PDF tables settle only on the second pass. The RMF and the CFF are in
  // `ignorePatterns`: their numbered lines (`1. Contraseña…`) read as Markdown lists, which oxfmt
  // renumbers.
  const formatted = [...written, "sources.json"].map((file) => join(OUT, file));
  for (let pass = 0; pass < 2; pass += 1) {
    run("pnpm", ["exec", "oxfmt", ...formatted], { cwd: ROOT });
  }
  console.log(`Wrote ${written.join(", ")}, sources.json`);
}

mkdirSync(OUT, { recursive: true });
await main();
