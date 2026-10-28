import { loader } from "fumadocs-core/source";

import { docs } from "./collections";
import { openapi } from "./openapi";

/** Server only: the guides (content/docs) and one page per API operation under `/docs/api`. */
export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    openapi: await openapi.staticSource({ baseDir: "api" }),
  },
  { baseUrl: "/docs", plugins: [openapi.loaderPlugin()] },
);
