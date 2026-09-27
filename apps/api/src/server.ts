import { JevCaptureAssessor, TypeSafeJevEvaluator } from "@wist/intelligence";
import { serve } from "@hono/node-server";

import { createPassportApp } from "./app.js";
import { PassportService } from "./service.js";
import { InMemoryPassportStore } from "./store.js";

const store = new InMemoryPassportStore();

const assessor =
  process.env.TYPESAFE_API_KEY === undefined
    ? undefined
    : new JevCaptureAssessor(new TypeSafeJevEvaluator());

const service =
  assessor === undefined
    ? new PassportService({ store })
    : new PassportService({ store, assessor });

const app = createPassportApp({ service, store });

const port = Number.parseInt(process.env.PORT ?? "8787", 10);

serve({ fetch: app.fetch, port });

process.stdout.write(`Wist API listening on http://localhost:${port}\n`);
