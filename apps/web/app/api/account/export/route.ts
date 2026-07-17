import { apiUser, requestIp } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { scopeFor } from "@/lib/server/dal";

export const dynamic = "force-dynamic";

/** Complete archive of the requesting user's data, as a JSON download. */
export async function GET() {
  const user = await apiUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const archive = await scopeFor(user.id).exportAll();
  await audit({ userId: user.id, action: "account.exported", ip: await requestIp() });

  return new Response(JSON.stringify(archive, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="tess-portal-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
