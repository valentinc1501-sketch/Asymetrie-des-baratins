export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8"
    };
    const url = new URL(request.url);
    const num = url.searchParams.get("page");
    if (!num) {
      return new Response(JSON.stringify({ error: "page manquante" }), { status: 400, headers: cors });
    }

    const headers = {
      "Authorization": "Bearer " + env.NOTION_TOKEN,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    };

    // 1. Chercher la page dont le titre commence par le numéro
    const search = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: num + " -",
        filter: { property: "object", value: "page" }
      })
    });
    const found = await search.json();
    const page = (found.results || []).find(p => {
      const t = Object.values(p.properties || {}).find(x => x.type === "title");
      const titre = t && t.title.map(r => r.plain_text).join("");
      return titre && titre.trim().startsWith(num);
    });
    if (!page) {
      return new Response(JSON.stringify({ error: "page introuvable" }), { status: 404, headers: cors });
    }

    // 2. Lire les blocs de la page
    let blocks = [];
    let cursor;
    do {
      const r = await fetch(
        "https://api.notion.com/v1/blocks/" + page.id + "/children?page_size=100" + (cursor ? "&start_cursor=" + cursor : ""),
        { headers }
      );
      const j = await r.json();
      blocks = blocks.concat(j.results || []);
      cursor = j.has_more ? j.next_cursor : null;
    } while (cursor);

    // 3. Garder uniquement ce qui est entre "Contenu de la carte" et "Sources"
    const texteDe = b => {
      const d = b[b.type];
      return d && d.rich_text ? d.rich_text : [];
    };
    const brut = b => texteDe(b).map(r => r.plain_text).join("").trim().toLowerCase();

    let dedans = false;
    const lignes = [];
    for (const b of blocks) {
      const t = brut(b);
      if (b.type.startsWith("heading")) {
        if (t.startsWith("contenu de la carte")) { dedans = true; continue; }
        if (dedans && t.startsWith("source")) break;
      }
      if (!dedans) continue;
      const html = texteDe(b).map(r => {
        let s = r.plain_text.replace(/&/g, "&").replace(/</g, "<");
        if (r.annotations.bold) s = "<b>" + s + "</b>";
        if (r.annotations.italic) s = "<i>" + s + "</i>";
        return s;
      }).join("");
      lignes.push(html);
    }

    return new Response(JSON.stringify({ lignes }), { headers: cors });
  }
};
