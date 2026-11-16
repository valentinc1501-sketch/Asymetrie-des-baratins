export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8"
    };
    const url = new URL(request.url);
    const num = (url.searchParams.get("page") || "").trim();
    if (!num) {
      return new Response(JSON.stringify({ error: "page manquante" }), { status: 400, headers: cors });
    }

    const headers = {
      "Authorization": "Bearer " + env.NOTION_TOKEN,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    };

    const titreDe = p => {
      const t = Object.values(p.properties || {}).find(x => x.type === "title");
      return t ? t.title.map(r => r.plain_text).join("").trim() : "";
    };

    // 1. Trouver la page dont le titre commence par le numéro (ex: "17 -")
    const search = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: num + " -",
        filter: { property: "object", value: "page" },
        page_size: 50
      })
    });
    const found = await search.json();
    if (found.object === "error") {
      return new Response(JSON.stringify({ error: found.message }), { status: 500, headers: cors });
    }
    const page = (found.results || []).find(p => /^\d+/.test(titreDe(p)) && titreDe(p).match(/^\d+/)[0] === num.replace(/^0+/, "").padStart(2, "0"));
    if (!page) {
      return new Response(JSON.stringify({ error: "page introuvable" }), { status: 404, headers: cors });
    }

    // 2. Lire tous les blocs de la page
    let blocks = [];
    let cursor = null;
    do {
      const r = await fetch(
        "https://api.notion.com/v1/blocks/" + page.id + "/children?page_size=100" + (cursor ? "&start_cursor=" + cursor : ""),
        { headers }
      );
      const j = await r.json();
      blocks = blocks.concat(j.results || []);
      cursor = j.has_more ? j.next_cursor : null;
    } while (cursor);

    const texteDe = b => {
      const d = b[b.type];
      return d && d.rich_text ? d.rich_text : [];
    };
    const brut = b => texteDe(b).map(r => r.plain_text).join("").trim();

    const versHtml = b => texteDe(b).map(r => {
      let s = r.plain_text.replace(/&/g, "&").replace(/</g, "<").replace(/\n/g, "<br>");
      if (r.annotations.bold) s = "<b>" + s + "</b>";
      if (r.annotations.italic) s = "<i>" + s + "</i>";
      return s;
    }).join("");

    // 3. Titre = dernier titre commençant par "Idée" avant "Contenu de la carte"
    //    Points = paragraphes entre "Contenu de la carte" et "Sources"
    let titre = "";
    let dedans = false;
    const points = [];
    for (const b of blocks) {
      const t = brut(b).toLowerCase();
      if (b.type.startsWith("heading")) {
        if (t.startsWith("contenu de la carte")) { dedans = true; continue; }
        if (dedans && t.startsWith("source")) break;
        if (!dedans && t.startsWith("idée")) { titre = versHtml(b); continue; }
      }
      if (dedans && b.type === "paragraph" && brut(b) !== "") {
        points.push(versHtml(b));
      }
    }

    return new Response(JSON.stringify({ titre, points }), { headers: cors });
  }
};
