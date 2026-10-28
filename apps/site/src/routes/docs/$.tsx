import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { Suspense, use } from "react";

import { OpenAPIPage } from "../../components/api-page";
import { DocsSidebar } from "../../components/docs-sidebar";
import { DocsToc } from "../../components/docs-toc";
import { PageActions } from "../../components/page-actions";
import { SiteBar } from "../../components/site-bar";
import { useMDXComponents } from "../../components/mdx";
import { docs } from "../../lib/collections";
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
  use(page.load());
  const MDX = page.body;
  return (
    <article className="doc-sheet prose">
      <h1>{page.title}</h1>
      {page.description && <p className="doc-lead">{page.description}</p>}
      <MDX components={useMDXComponents()} />
    </article>
  );
}

function Page() {
  const page = useFumadocsLoader(Route.useLoaderData());
  const content =
    page.type === "openapi" ? (
      <>
        <header className="doc-sheet doc-api prose">
          <h1>{page.title}</h1>
        </header>
        <div className="codice-api px-4 pb-6 sm:px-6">
          <OpenAPIPage {...page.props} />
        </div>
      </>
    ) : (
      <Suspense>
        <Guide path={page.path} />
      </Suspense>
    );
  // The site's bar on top, then the sidebar and the page. A guide's text is 800px wide and centered
  // on the screen, not on the space beside the sidebar, while the screen is wide enough; its
  // contents and actions float at the right edge from 1280px. Narrower, the actions sit above the
  // title. An API operation is the sidebar and the operation, which has its own example column.
  // Below 1024px the sidebar stacks above the page.
  const guide = page.type === "docs";
  return (
    <div className="codice-docs">
      <SiteBar grounded />
      <div className="pt-[44px] sm:pt-[52px] lg:grid lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="max-lg:border-b max-lg:border-line lg:sticky lg:top-[52px] lg:h-[calc(100dvh-52px)]">
          <DocsSidebar tree={page.pageTree} />
        </div>
        <main className="min-h-[calc(100dvh-52px)] min-w-0 overflow-x-clip">
          {guide ? (
            <div className="flex">
              <div className="w-full max-w-[800px] min-w-0 lg:ml-[max(0px,calc(50vw-700px))]">
                <div className="p-4 sm:px-6 xl:hidden">
                  <PageActions className="flex-wrap" path={page.path} title={page.title} />
                </div>
                {content}
              </div>
              <aside className="ml-auto w-[276px] shrink-0 pr-6 pl-12 max-xl:hidden">
                <div className="sticky top-[52px] -ml-2 flex max-h-[calc(100dvh-52px)] flex-col gap-10 overflow-y-auto px-2 pt-14 pb-6">
                  <DocsToc />
                  <PageActions className="flex-col" path={page.path} title={page.title} />
                </div>
              </aside>
            </div>
          ) : (
            content
          )}
        </main>
      </div>
    </div>
  );
}
