/**
 * A SAT workbook's sheets as CSV rows, through LibreOffice (`soffice`). Shared by `sat-knowledge.ts`
 * and the ingestion (`ingest.ts`), which loads the large catalogs.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parseCsv } from "./sat-knowledge-render";

/** Every sheet of a workbook by name, cells as the SAT's file shows them (`01`, not `1`). */
export function workbookSheets(path: string, workDir: string) {
  const dir = mkdtempSync(join(workDir, "csv-"));
  try {
    execFileSync(
      "soffice",
      [
        "--headless",
        "--convert-to",
        "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,true,false,false,-1",
        "--outdir",
        dir,
        path,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    throw new Error(`soffice failed; is it installed? ${(error as Error).message}`);
  }
  const byName = new Map<string, string[][]>();
  // LibreOffice names each file after its sheet in Latin-1 (`Códigos_Error_CFDI40`), so the
  // names are read as bytes.
  for (const file of readdirSync(dir, { encoding: "buffer" })) {
    const sheet = /-([^-]+)\.csv$/u.exec(file.toString("latin1"))?.[1];
    const csv = Buffer.concat([Buffer.from(`${dir}/`), file]);
    if (sheet) byName.set(sheet, parseCsv(readFileSync(csv, "utf8")));
  }
  return byName;
}
