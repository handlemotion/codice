import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { Suspense, use, type ReactNode } from "react";

import { OpenAPIPage } from "../../components/api-page";
import { useMDXComponents } from "../../components/mdx";
import { docs } from "../../lib/collections";
import { baseOptions } from "../../lib/layout.shared";
import { source } from "../../lib/source";

// Every docs page: a guide from content/docs, or an API operation from the OpenAPI document.
export const Route = createFileRoute("/docs/$")({
  component: Page,
  loader: async ({ params }) => {
    const data = await serverLoader({ data: params._splat?.split("/").filter(Boolean) ?? [] });
    if (data.type === "docs") await docs.getPage(data.path)?.preload();
    return data;
  },
  head: ({ loaderData }) => ({
    meta: loaderData ? [{ title: `${loaderData.title} · Códice` }] : [],
  }),
});

const serverLoader = createServerFn({ method: "GET" })
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs);
    if (!page) throw notFound();
    const pageTree = await source.serializePageTree(source.getPageTree());
    if (page.type === "openapi") {
      return {
        type: "openapi" as const,
        title: page.data.title,
        pageTree,
        props: page.data.getOpenAPIPageProps(),
      };
    }
    return { type: "docs" as const, title: page.data.title, path: page.path, pageTree };
  });

function Guide({ path }: { path: string }) {
  const page = docs.getPage(path);
  if (!page) throw new Error(`unknown page: ${path}`);
  const { toc } = use(page.load());
  const MDX = page.body;
  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <DocsBody>
        <MDX components={useMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

function Page() {
  const page = useFumadocsLoader(Route.useLoaderData());
  let content: ReactNode;
  if (page.type === "openapi") {
    content = (
      <DocsPage full>
        <DocsTitle>{page.title}</DocsTitle>
        <DocsBody>
          <OpenAPIPage {...page.props} />
        </DocsBody>
      </DocsPage>
    );
  } else {
    content = (
      <Suspense>
        <Guide path={page.path} />
      </Suspense>
    );
  }
  return (
    <DocsLayout {...baseOptions()} tree={page.pageTree}>
      {content}
    </DocsLayout>
  );
}
