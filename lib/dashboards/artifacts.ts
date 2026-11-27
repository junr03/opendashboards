import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { apps, dashboardArtifacts, dashboards, dashboardVersions } from "@/lib/db/schema";
import { DashboardError } from "./errors";

export type DashboardDocument = { program: string; scripts: Record<string, string> };
export type Artifact = DashboardDocument & { id: string; version: number; appId: string };

export function createArtifactStore(db: Database) {
  const scope = (userId: string, appId: string, id: string) => and(
    eq(dashboardArtifacts.id, id), eq(dashboardArtifacts.userId, userId), eq(dashboardArtifacts.appId, appId),
  );
  return {
    /** Attach an exported program to an existing legacy metadata record without changing its id. */
    async importLegacy(userId: string, appId: string, id: string, document: DashboardDocument): Promise<Artifact> {
      return db.transaction(async (tx) => {
        const [owned] = await tx.select().from(dashboards).where(and(eq(dashboards.artifactId, id), eq(dashboards.appId, appId), eq(dashboards.userId, userId))).for("update");
        if (!owned) throw new DashboardError("Dashboard not found", "not_found", 404);
        const [inserted] = await tx.insert(dashboardArtifacts).values({ id, appId, userId }).onConflictDoNothing().returning();
        if (!inserted) throw new DashboardError("This dashboard already has local content. Use its version when updating.", "version_conflict", 409);
        await tx.insert(dashboardVersions).values({ artifactId: id, version: 1, ...document });
        return { id, appId, version: 1, ...document };
      });
    },
    async create(userId: string, appId: string, title: string, document: DashboardDocument): Promise<Artifact> {
      return db.transaction(async (tx) => {
        const [app] = await tx.select().from(apps).where(and(eq(apps.id, appId), eq(apps.userId, userId))).for("update");
        if (!app) throw new DashboardError("App not found", "not_found", 404);
        const id = `dash_${randomUUID()}`;
        const rows = await tx.select({ id: dashboards.id }).from(dashboards).where(eq(dashboards.appId, appId));
        await tx.insert(dashboardArtifacts).values({ id, appId, userId });
        await tx.insert(dashboardVersions).values({ artifactId: id, version: 1, ...document });
        await tx.insert(dashboards).values({ artifactId: id, appId, userId, title, position: rows.length });
        return { id, appId, version: 1, ...document };
      });
    },
    async read(userId: string, appId: string, id: string, version?: number): Promise<Artifact | null> {
      const [row] = await db.select({ id: dashboardArtifacts.id, appId: dashboardArtifacts.appId,
        version: dashboardVersions.version, program: dashboardVersions.program, scripts: dashboardVersions.scripts })
        .from(dashboardArtifacts).innerJoin(dashboardVersions, and(eq(dashboardVersions.artifactId, dashboardArtifacts.id),
          version === undefined ? eq(dashboardVersions.version, dashboardArtifacts.version) : eq(dashboardVersions.version, version)))
        .where(scope(userId, appId, id)).limit(1);
      return row ?? null;
    },
    async update(userId: string, appId: string, id: string, expectedVersion: number, document: DashboardDocument): Promise<Artifact> {
      return db.transaction(async (tx) => {
        const [updated] = await tx.update(dashboardArtifacts).set({ version: expectedVersion + 1 })
          .where(and(scope(userId, appId, id), eq(dashboardArtifacts.version, expectedVersion))).returning();
        if (!updated) throw new DashboardError("The dashboard changed while it was being edited. Read it and retry.", "version_conflict", 409);
        await tx.insert(dashboardVersions).values({ artifactId: id, version: updated.version, ...document });
        return { id, appId, version: updated.version, ...document };
      });
    },
    async remove(userId: string, appId: string, id: string) {
      await db.delete(dashboardArtifacts).where(scope(userId, appId, id));
    },
  };
}
