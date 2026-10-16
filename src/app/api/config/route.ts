import { publicConfiguration } from "@/lib/server/config";
import { noStoreHeaders } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export function GET() { return Response.json(publicConfiguration(), { headers: noStoreHeaders }); }
