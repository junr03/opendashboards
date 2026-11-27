import { getThreadService } from "@/lib/apps";
import { renameThreadSchema } from "@/lib/apps/schemas";
import { HttpError, readJson, respond, route } from "@/lib/http";

type Ctx = { params: Promise<{ appId: string }> };

/** The app's chat threads, newest activity first. `?cursor=` pages. */
export const GET = route<Ctx>(async (request, user, { params }) => {
  const { appId } = await params;
  const cursor = new URL(request.url).searchParams.get("cursor");
  return respond(await getThreadService().list(user.id, appId, cursor));
});

/**
 * Creates an app-scoped conversation in this deployment.
 */
export const POST = route<Ctx>(async (request, user, { params }) => {
  const { appId } = await params;
  const input = await readJson(request);
  const parsed = renameThreadSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Invalid conversation title");
  return respond(await getThreadService().create(user.id, appId, parsed.data.title));
});
