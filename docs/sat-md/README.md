# SAT CFDI 4.0 and Pagos 2.0 — reference docs (markdown)

The SAT's own documents for the fiscal rules the Stamping pipeline must satisfy, converted to markdown
for agents and search. **Check these before assuming a fiscal rule** (what a receptor field must hold,
what a `CFDI40xxx` error means, how a payment complement is filled). This repo once cited the wrong `CFDI40xxx` code for a rule
from memory; these files are the SAT's text.

Generated from the SAT's [Anexo 20 page](http://omawww.sat.gob.mx/tramitesyservicios/Paginas/anexo_20.htm),
its RMF page and the Cámara de Diputados' [Leyes Federales Vigentes](https://www.diputados.gob.mx/LeyesBiblio/index.htm) by `pnpm --filter @codice/api sat:knowledge`. Every file here except this README is
generated: never edit one by hand. Códice (`apps/api`) ingests them for search, and the Agent
reads them from Códice. [`sources.json`](./sources.json) records each file's URL,
SHA-256, publication date, and retrieval date, and each Markdown file starts with the same
provenance.

| Topic                                                                                              | File                                                                                                             |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Anexo 20 filling guide: every CFDI 4.0 node and attribute (Emisor, Receptor, …)                    | [`anexo-20-guia-de-llenado-cfdi.md`](./anexo-20-guia-de-llenado-cfdi.md)                                         |
| Payment complement (REP, Pagos 2.0): Pago, DoctoRelacionado, TipoCambioP, … rules                  | [`complemento-pagos-guia-de-llenado.md`](./complemento-pagos-guia-de-llenado.md)                                 |
| Validation matrix: every `CFDI40xxx` code, the rule behind it, and its message, one node a section | [`matriz-de-errores-cfdi-4.0.md`](./matriz-de-errores-cfdi-4.0.md), [`.json`](./matriz-de-errores-cfdi-4.0.json) |
| Catalogs (catCFDI): c_RegimenFiscal, c_UsoCFDI, c_FormaPago, c_Moneda, c_Pais, c_TasaOCuota, …     | [`catalogos-cfdi-4.0.md`](./catalogos-cfdi-4.0.md), [`.json`](./catalogos-cfdi-4.0.json)                         |
| Resolución Miscelánea Fiscal 2026 (RMF): every regla, as the SAT compiles it with its amendments   | [`resolucion-miscelanea-fiscal-2026.md`](./resolucion-miscelanea-fiscal-2026.md)                                 |
| Código Fiscal de la Federación (CFF): every article in force, as the Cámara de Diputados publishes | [`codigo-fiscal-de-la-federacion.md`](./codigo-fiscal-de-la-federacion.md)                                       |

The RMF comes from the SAT's [RMF and RGCE page](https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/normatividad_rmf_rgce2026.html):
`sat:knowledge` takes the latest compiled RMF it links (`Compilado_…`), the only file with each
regla's whole current text. The SAT marks each regla an amendment changed with that amendment's
DOF date (`- Reformada en la Primera RMRMF para 2026, publicada en el DOF el 09 de julio de 2026.`).
The compilation is informative: the SAT's own note says the DOF publication is what has legal
effect. It lags the DOF: an amendment published after it (the Segunda RMRMF of 1 October 2026,
reglas 9.4.4 and 11.7.3) is in the next compilation. The page footers are left out, and the file is
not formatted (oxfmt would renumber its numbered lines as Markdown lists).

The CFF comes from the Cámara de Diputados' [Leyes Federales Vigentes](https://www.diputados.gob.mx/LeyesBiblio/index.htm)
page (`pdf/CFF.pdf`), its text in force after the last reform the cover names (`Última reforma
publicada DOF 09-04-2026`), which `sources.json` records as its `publishedAt`. The Cámara notes each
part a reform changed since 2021 below it (`Párrafo reformado DOF 12-11-2021`). Like the SAT's
compilation, it is informative: the DOF publication has legal effect. The page headers and footers
are left out, and the file is not formatted, as for the RMF.

Not included: the large catalogs (c_ClaveProdServ, c_ClaveUnidad, c_CodigoPostal, c_Colonia,
c_Localidad, c_Municipio, c_NumPedimentoAduana, c_PatenteAduanal). Códice loads them into its D1
straight from the same `catCFDI_V_4_*.xls` (the version `sources.json` pins) and answers one entry
at `GET /v1/catalogs/:name/:key`, such as `/v1/catalogs/c_CodigoPostal/01000`; see
`apps/api/SPEC.md`, "Large catalogs". They stay out of this folder.

## Regenerate

```bash
pnpm --filter @codice/api sat:knowledge --check   # exit 1 if the SAT published something new
pnpm --filter @codice/api sat:knowledge           # regenerate what changed
pnpm --filter @codice/api sat:knowledge --force   # regenerate everything
```

It needs LibreOffice (`soffice`) for the spreadsheets, and Microsoft MarkItDown
(`pipx install 'markitdown[pdf]'`) with Poppler (`pdfinfo`) for the PDF guides. The spreadsheets
are parsed into records (codes keep the SAT's display format, such as `01`), and each catalog is
checked against the SAT's `catCFDI.xsd`; differences are reported, not changed. The PDF conversion
is lossy (page footers, wrapped table cells, attribute names cut at a column edge), so search by
attribute name and quote the rule rather than citing PDF page numbers.

## Rules this codebase depends on

Quoted verbatim from the SAT files above.

### Receptor with a generic RFC (`XAXX010101000` national, `XEXX010101000` foreign resident)

Matrix, `cfdi:Receptor` / `DomicilioFiscalReceptor`:

| Code        | Validation                                                                                                                                          | Message                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `CFDI40147` | Este atributo, debe encontrarse en la lista de RFC inscritos no cancelados en el SAT.                                                               | El campo DomicilioFiscalReceptor del receptor, debe encontrarse en la lista de RFC inscritos no cancelados en el SAT.             |
| `CFDI40148` | Este atributo, debe pertenecer al nombre asociado al RFC registrado en el atributo Rfc del Nodo Receptor.                                           | El campo DomicilioFiscalReceptor del receptor, debe pertenecer al nombre asociado al RFC registrado en el campo Rfc del Receptor. |
| `CFDI40149` | Si el valor del atributo Rfc del receptor es "XAXX010101000" o "XEXX010101000", este atributo debe ser igual al valor del atributo LugarExpedicion. | El campo DomicilioFiscalReceptor, no es igual al valor del campo LugarExpedicion.                                                 |

So for a generic receptor the postal code is the **issuer's** `LugarExpedicion`, never the client's own
(a foreign client's postcode is in its country's format: `489-491`, 6 digits, ZIP+4). The filling guide
says the same from the other side: _"El código postal, en caso de que sea diferente de los RFC genéricos,
debe estar asociado a la clave de RFC registrado en el campo Rfc de este Nodo."_ Code:
`packages/stamping/src/core/sat/generic-receptor.ts`. In Facturapi TEST the stamped XML carried the issuing organization's own postal code for a
generic receptor, and Facturapi validated only the length (5 digits) of the value sent.

Other Receptor fields for `XEXX010101000`:

- `RegimenFiscalReceptor`: _"Cuando se trate de operaciones con residentes en el extranjero y se registre el valor "XEXX010101000" en este campo se debe registrar la clave "616" Sin obligaciones fiscales."_ (both guides).
- `UsoCFDI` on an ordinary CFDI: _"En el caso de que se emita un CFDI a un residente en el extranjero con RFC genérico (XEXX010101000), en este campo se debe registrar la clave "S01" (Sin efectos fiscales)."_
- `UsoCFDI` on a payment complement (REP): _"Se debe registrar la clave "CP01" (Pagos) del catálogo c_UsoCFDI"_ — always, whatever the receptor.
- `ResidenciaFiscal` is required for a foreign generic RFC only when the CFDI carries the Comercio Exterior complement or `NumRegIdTrib`.

### Payment complement (REP)

See `complemento-pagos-guia-de-llenado.md` for `Pago`, `DoctoRelacionado`, `EquivalenciaDR`,
`TipoCambioP` and `ImpSaldoAnt` / `ImpPagado` / `ImpSaldoInsoluto`. The existing pipeline's
reconciliation rules (`packages/stamping/src/core/sat/`) encode these. The `CRP20xxx` payment-complement
validation codes the rejection mapper reads are in neither file here (the matrix covers `CFDI40xxx` only);
their source is not mirrored here yet.
