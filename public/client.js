function addMessage(role, content, meta = null) {
  const chat = el("chat");
  if (!chat) return;

  const wrap = document.createElement("div");
  wrap.className = "msg " + (role === "user" ? "user" : "assistant");

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (meta && meta.type === "file" && meta.file_id) {
    const isImg = (meta.mimetype || "").startsWith("image/");
    const url = `/api/files/${meta.file_id}/download`;

    const card = document.createElement("div");
    card.className = "file-card";

    if (isImg) {
      const img = document.createElement("img");
      img.className = "file-thumb";
      img.src = url;
      img.alt = meta.filename || "imagem";
      card.appendChild(img);
    } else {
      const ic = document.createElement("div");
      ic.className = "file-ic";
      ic.textContent = "📎";
      card.appendChild(ic);
    }

    const txt = document.createElement("div");
    txt.innerHTML = `
      <div><a href="${url}" target="_blank" rel="noopener">${meta.filename || "arquivo"}</a></div>
      <div style="font-size:11px;opacity:.68;">${meta.mimetype || ""}</div>
    `;
    card.appendChild(txt);
    bubble.appendChild(card);
  } else {
    bubble.textContent = content || "";
  }

  wrap.appendChild(bubble);
  chat.appendChild(wrap);
}
