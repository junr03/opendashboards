import { getThreadService } from "@/lib/apps";
import { HttpError, readJson, respond, route } from "@/lib/http";

type Ctx = { params: Promise<{ appId: string; threadId: string }> };

/** Provider-format history, owned by the authenticated user and app. */
export const GET = route<Ctx>(async (_request, user, { params }) => {
  const { appId, threadId } = await params;
  const messages = await getThreadService().messages(user.id, appId, threadId);
  if (messages === null) throw new HttpError(404, "Conversation not found");
  return Response.json({ messages });
});

/** Renames a thread in the app's list. */
export const PATCH = route<Ctx>(async (request, user, { params }) => {
  const { appId, threadId } = await params;
  const result = await getThreadService().rename(user.id, appId, threadId, await readJson(request));
  return respond(result, { emptyOk: true });
});

/** Removes a conversation and its stored turns. */
export const DELETE = route<Ctx>(async (_request, user, { params }) => {
  const { appId, threadId } = await params;
  return respond(await getThreadService().remove(user.id, appId, threadId), { emptyOk: true });
});
