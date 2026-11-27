import { getArtifacts, getDashboardService } from "@/lib/dashboards";
import { HttpError, readJson, route } from "@/lib/http";
import { validateDocument } from "@/lib/dashboards/generation";
import { DashboardError } from "@/lib/dashboards/errors";
import { toolsFor } from "@/lib/tools";

type Ctx = { params: Promise<{ artifactId: string }> };

export const GET = route<Ctx>(async (request, user, { params }) => {
  const { artifactId } = await params;
  const dashboard = await getDashboardService().findByArtifact(user.id, artifactId);
  if (!dashboard) throw new HttpError(404, "Dashboard not found");
  const versionParam = new URL(request.url).searchParams.get("version");
  const version = versionParam === null ? undefined : Number(versionParam);
  if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) throw new HttpError(400, "Invalid version");
  const artifact = await getArtifacts().read(user.id, dashboard.appId, artifactId, version);
  if (!artifact) throw new HttpError(404, version !== undefined ? "Dashboard version not found" : "This dashboard is stored in OpenUI Cloud. Import its program into this deployment before opening it.");
  if (new URL(request.url).searchParams.get("download") === "1") {
    return Response.json({ program: artifact.program, scripts: artifact.scripts }, { headers: {
      "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="dashboard-v${artifact.version}.json"`,
    } });
  }
  return Response.json({ id: artifact.id, version: artifact.version, program: artifact.program }, { headers: { "Cache-Control": "private, no-store" } });
});

/** Imports a validated document. Local edits require If-Match to avoid overwriting a newer version. */
export const PUT = route<Ctx>(async (request, user, { params }) => {
  const { artifactId } = await params;
  const dashboard = await getDashboardService().findByArtifact(user.id, artifactId);
  if (!dashboard) throw new HttpError(404, "Dashboard not found");
  try {
    const document = await validateDocument(await readJson(request, { maxBytes: 512 * 1024 }), toolsFor("dashboard").map((tool) => tool.name));
    const store = getArtifacts();
    const current = await store.read(user.id, dashboard.appId, artifactId);
    const expectedVersion = Number(request.headers.get("if-match")?.replaceAll('"', ""));
    if (current && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) throw new HttpError(428, "If-Match with the current version is required");
    const artifact = current
      ? await store.update(user.id, dashboard.appId, artifactId, expectedVersion, document)
      : await store.importLegacy(user.id, dashboard.appId, artifactId, document);
    return Response.json({ id: artifact.id, version: artifact.version });
  } catch (error) {
    if (error instanceof DashboardError) throw new HttpError(error.status, error.message);
    if (error instanceof Error && error.name === "ZodError") throw new HttpError(400, "Invalid dashboard document");
    throw error;
  }
});
