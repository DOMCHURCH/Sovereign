import { defineRailway, project, service } from "railway/iac";

// Replaces the deprecated railway.json (Config as Code), which Railway stops honouring
// on 2026-12-01. The Dockerfile at the repo root is auto-detected, so the builder does
// not need declaring here — see the Deployment section of the README.
export const partial = "sovereign";

export default defineRailway(() => {
  const sovereign = service("sovereign", {
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    // One replica on purpose: DuckDB is single-writer and a second instance would
    // contend for the lock on the /data volume.
    replicas: 1,
  });
  return project("sovereign", {
    resources: [sovereign],
  });
});
