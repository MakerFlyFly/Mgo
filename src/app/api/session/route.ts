import { newSession } from "@/lib/domain/types";
import { configuration } from "@/lib/server/config";
import { cookieHeader, noStoreHeaders, sessionCookie } from "@/lib/server/http";
import { LiveRepository } from "@/lib/server/repository";
import { publicError } from "@/lib/domain/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let repository: LiveRepository | undefined;
  try {
    const config = configuration();
    if (config.mode === "demo") return Response.json({ session: newSession("demo") }, { headers: noStoreHeaders });
    repository = await LiveRepository.open(config.dataDir, config.mcdToken);
    const id = sessionCookie(request), session = (id && repository.getSession(id)) || newSession("live");
    if (session.quote) {
      const attempt = await repository.findAttempt(session.quote.id);
      if (attempt) {
        session.attempt = attempt;
        if (attempt.status === "submitting" && Date.now() - Date.parse(attempt.createdAt) > 140000) {
          attempt.status = "unknown"; attempt.message = "上次提交结果待核实，请查询官方订单后再处理。"; await repository.saveAttempt(attempt);
        }
      }
    }
    await repository.saveSession(session);
    return Response.json({ session }, { headers: { ...noStoreHeaders, "Set-Cookie": cookieHeader(session.id, request) } });
  } catch (error) { const e = publicError(error); return Response.json({ error: e.message }, { status: e.status, headers: noStoreHeaders }); }
  finally { repository?.close(); }
}
