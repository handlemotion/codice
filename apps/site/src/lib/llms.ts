import { flattenTree } from "fumadocs-core/page-tree";
import { llms } from "fumadocs-core/source/llms";

import { source } from "./source";

const ORIGIN = "https://codice.io";

// The llms.txt header (llmstxt.org): the project's name, a one-line summary, then what to know
// before reading the pages.
const HEADER = `# Códice

> Índice de las reglas fiscales de México publicadas por el SAT: la guía de llenado del CFDI 4.0 (Anexo 20), la del complemento de pagos 2.0, la matriz de errores CFDI40xxx, los catálogos del CFDI 4.0 y la Resolución Miscelánea Fiscal 2026. Cada respuesta cita el texto del SAT con su fuente y su vigencia.

Códice se consulta por HTTP (\`${ORIGIN}/v1\`, con una clave en \`Authorization: Bearer\`) y por MCP (\`${ORIGIN}/mcp\`). Devuelve reglas, no asesoría fiscal: cita el texto en vez de parafrasearlo. Toda la documentación en un solo archivo: [llms-full.txt](${ORIGIN}/llms-full.txt).`;

const docsLlms = llms(source, {
  // Guides as their processed Markdown; an API operation, which has no Markdown, as its title and
  // link, like the index.
  renderPage: async (page) => {
    const url = `${ORIGIN}${page.url}`;
    if (!("getText" in page.data)) return `# ${page.data.title} (${url})`;
    return `# ${page.data.title} (${url})\n\n${await page.data.getText("processed")}`;
  },
});

/**
 * `/llms.txt`: the header, then the docs' sidebar, each separator a `##` section of links with
 * their descriptions, as llmstxt.org lays it out.
 */
export function llmsIndex(): string {
  const lines = source
    .getPageTree()
    .children.map((node) =>
      node.type === "separator" ? `\n## ${node.name}\n` : docsLlms.indexNode(node),
    );
  return `${HEADER}\n${absolute(lines.join("\n"))}\n`;
}

/** `/llms-full.txt`: every guide in full, in the sidebar's order. */
export async function llmsFull(): Promise<string> {
  const guides = flattenTree(source.getPageTree().children)
    .map((node) => source.getNodePage(node))
    .filter((page) => page !== undefined && "getText" in page.data);
  const pages = await Promise.all(guides.map((page) => docsLlms.page(page!)));
  return `${HEADER}\n\n${pages.join("\n\n")}\n`;
}

// The index links pages by path; an assistant reading the file on its own needs the host.
function absolute(markdown: string): string {
  return markdown.replaceAll("](/docs", `](${ORIGIN}/docs`);
}
