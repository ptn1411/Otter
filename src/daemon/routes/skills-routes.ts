import { jsonResponse, errorResponse } from "./common";
import { matchDaemonRoute, getDaemonRoute } from "./lcg-routes";
import { getAllSkills, findSkillMarkdown } from "../skills-catalog";

export async function handleSkillsRoutes(req: Request, url: URL): Promise<Response | null> {
  if (matchDaemonRoute(url.pathname, "SKILLS") && req.method === "GET") {
    try {
      let list = await getAllSkills();
      const q = url.searchParams.get("q");
      if (q) {
        const query = q.toLowerCase();
        list = list.filter((s: any) => s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query));
      }
      return jsonResponse({ skills: list, total: list.length });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  const skillsPrefix = getDaemonRoute("SKILLS") + "/";
  if (url.pathname.startsWith(skillsPrefix) && req.method === "GET") {
    try {
      const skillName = decodeURIComponent(url.pathname.slice(skillsPrefix.length));
      const content = await findSkillMarkdown(skillName);
      if (!content) {
        return errorResponse(`Skill not found: ${skillName}`, 404);
      }
      return jsonResponse({ name: skillName, markdown: content });
    } catch (err: any) {
      return errorResponse(`Skill not found: ${err.message}`, 404);
    }
  }

  return null;
}
