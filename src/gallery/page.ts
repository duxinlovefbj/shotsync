// The demo variant is derived once at module load (see the bottom of this file)
// by flipping the DEMO const the inline script declares.
export const galleryHTML = /* html */ `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>shotsync</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#111111">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #111; color: #eee; font: 15px/1.4 -apple-system, system-ui, sans-serif; }
  header { position: sticky; top: 0; display: flex; align-items: center; gap: 10px;
           padding: 10px 14px; background: #181818; border-bottom: 1px solid #2a2a2a; z-index: 5; flex-wrap: wrap; }
  header h1 { font-size: 16px; margin: 0; flex: 1; }
  button, select { background: #2b6cff; color: #fff; border: 0; border-radius: 8px; padding: 8px 12px; font-size: 14px; cursor: pointer; }
  select { background: #222; border: 1px solid #3a3a3a; color: #eee; outline: none; }
  #grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; padding: 8px; }
  .grid-cell { width: 100%; aspect-ratio: 1; border-radius: 8px; position: relative; overflow: hidden; cursor: pointer; background: #1a1a1a; display: flex; flex-direction: column; }
  .grid-cell img { width: 100%; height: 100%; object-fit: cover; background: #222; }
  .grid-cell .file-badge { position: absolute; top: 6px; left: 6px; background: rgba(0,0,0,0.65); backdrop-filter: blur(4px); font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; color: #8ab4ff; }
  .grid-cell .name-footer { position: absolute; bottom: 0; inset-inline: 0; background: linear-gradient(transparent, rgba(0,0,0,0.85)); padding: 12px 6px 4px; font-size: 11px; color: #ccc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  
  .txtcell { width: 100%; height: 100%; background: #1c2030; color: #cdd3e0; padding: 10px; font-size: 12px; line-height: 1.4; overflow: hidden; white-space: pre-wrap; word-break: break-word; }
  
  .filecell { width: 100%; height: 100%; background: #20242c; color: #eee; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px; text-align: center; gap: 6px; }
  .filecell .icon { font-size: 28px; line-height: 1; }
  .filecell .title { font-size: 12px; font-weight: 500; word-break: break-all; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.2; }
  .filecell .meta { font-size: 10px; color: #888; }
  
  #gate { position: fixed; inset: 0; display: flex; flex-direction: column; gap: 12px;
          align-items: center; justify-content: center; background: #111; padding: 24px; z-index: 100; }
  #gate input { padding: 10px; border-radius: 8px; border: 1px solid #333; background: #1c1c1c; color: #eee; width: min(360px, 90vw); }
  .hidden { display: none !important; }
  #toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
           background: #333; color: #fff; padding: 10px 16px; border-radius: 20px; opacity: 0; transition: opacity .2s; z-index: 200; pointer-events: none; }
  #toast.show { opacity: 1; }
  
  #viewerText { flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 16px; white-space: pre-wrap;
                word-break: break-word; color: #eee; font: 14px/1.6 ui-monospace, monospace; }
  #compose { position: fixed; inset: 0; z-index: 20; background: rgba(0,0,0,.92);
             display: flex; flex-direction: column; gap: 10px; padding: 12px; }
  #compose textarea { flex: 1; min-height: 0; resize: none; padding: 12px; border-radius: 8px;
                      border: 1px solid #333; background: #1c1c1c; color: #eee; font-size: 15px; }
  #compose .row { display: flex; justify-content: flex-end; gap: 10px; }
  #grid .sel { outline: 3px solid #2b6cff; outline-offset: -3px; opacity: .8; }

  .dialog-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 16px; }
  .dialog-card { background: #1e1e1e; border: 1px solid #333; border-radius: 12px; padding: 20px; width: min(400px, 92vw); display: flex; flex-direction: column; gap: 14px; }
  .dialog-card h3 { margin: 0; font-size: 16px; }
  .dialog-card select, .dialog-card input { padding: 8px 10px; border-radius: 6px; border: 1px solid #444; background: #121212; color: #eee; width: 100%; }
</style>
</head>
<body>
  <div id="gate" class="hidden">
    <div>输入访问 token</div>
    <input id="tokenInput" type="password" placeholder="Bearer token" autocomplete="off">
    <button id="tokenSave">进入中转池</button>
    <div id="gateErr" style="color:#ff6b6b"></div>
  </div>

  <header class="hidden" id="bar">
    <h1>shotsync</h1>
    <input id="fileInput" type="file" multiple class="hidden">
    <button id="textBtn" style="background:#444">✎ 文本</button>
    <button id="uploadBtn">+ 上传文件</button>
    <button id="selectBtn" style="background:#444">选择</button>
    <button id="delSelBtn" class="hidden" style="background:#d23">删除选中</button>
    <button id="cancelSelBtn" class="hidden" style="background:#444">取消</button>
  </header>
  <main id="grid"></main>
  <div id="toast"></div>

  <!-- 分享 TTL 配置弹窗 -->
  <div id="shareDialog" class="dialog-mask hidden">
    <div class="dialog-card">
      <h3>生成公开分享链接</h3>
      <div id="shareDialogTip" style="font-size:13px;color:#aaa">选择链接有效期：</div>
      <select id="shareTtlSelect">
        <option value="3600">1 小时</option>
        <option value="86400">1 天 (24 小时)</option>
        <option value="604800" selected>7 天</option>
        <option value="2592000">30 天</option>
      </select>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:6px">
        <button id="shareDialogCancel" style="background:#444">取消</button>
        <button id="shareDialogConfirm" style="background:#0a8a5f">生成并复制</button>
      </div>
    </div>
  </div>

  <div id="compose" class="hidden">
    <textarea id="composeText" placeholder="粘贴或输入文字，发送到中转池…"></textarea>
    <div class="row">
      <button id="composeSend">发送</button>
      <button id="composeCancel" style="background:#444">取消</button>
    </div>
  </div>

  <div id="viewer" class="hidden" style="position:fixed;inset:0;background:rgba(0,0,0,.95);display:flex;flex-direction:column;z-index:30">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#161616;border-bottom:1px solid #282828">
      <div id="viewerFilename" style="font-size:14px;color:#ddd;max-width:50vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
      <div style="display:flex;gap:8px">
        <button id="shareBtn" style="background:#0a8a5f">分享</button>
        <button id="saveBtn" style="background:#2b6cff">下载/保存</button>
        <button id="delBtn" style="background:#d23">删除</button>
        <button id="closeBtn" style="background:#444">关闭</button>
      </div>
    </div>
    <div id="viewerBody" style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;position:relative">
      <img id="viewerImg" class="hidden" style="max-width:100%;max-height:100%;object-fit:contain">
      <pre id="viewerText" class="hidden"></pre>
      <div id="viewerGeneric" class="hidden" style="text-align:center;padding:24px">
        <div style="font-size:48px;margin-bottom:12px">📄</div>
        <div id="genericFilename" style="font-size:16px;font-weight:bold;margin-bottom:6px;word-break:break-all"></div>
        <div id="genericFilesize" style="font-size:13px;color:#888;margin-bottom:16px"></div>
        <button id="genericDownloadBtn" style="background:#2b6cff;padding:10px 20px;font-size:15px">直接下载</button>
      </div>
    </div>
  </div>

<script>
const DEMO = false;
const DEMO_EN = DEMO && !((navigator.language || "").toLowerCase().startsWith("zh"));
const TOKEN_KEY = "shotsync_token";
let token = localStorage.getItem(TOKEN_KEY) || "";

const $ = (s) => document.querySelector(s);
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 1800); }
function authHeaders() { return { authorization: "Bearer " + token }; }

async function apiOk() {
  const res = await fetch("/api/list?limit=1", { headers: authHeaders() });
  return res.ok;
}

function showGate(err) { $("#gate").classList.remove("hidden"); $("#bar").classList.add("hidden"); if (err) $("#gateErr").textContent = err; }
function showApp() { $("#gate").classList.add("hidden"); $("#bar").classList.remove("hidden"); }

$("#tokenSave").onclick = async () => {
  token = $("#tokenInput").value.trim();
  if (!token) return;
  localStorage.setItem(TOKEN_KEY, token);
  if (await apiOk()) { showApp(); setupUpload(); await initFeed(); }
  else { localStorage.removeItem(TOKEN_KEY); showGate("token 无效"); }
};

let currentItem = null;

function formatSize(bytes) {
  if (!bytes || isNaN(bytes)) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

async function openFull(item) {
  currentItem = item;
  const v = $("#viewer"), img = $("#viewerImg"), txt = $("#viewerText"), gen = $("#viewerGeneric");
  img.removeAttribute("src"); img.classList.add("hidden");
  txt.textContent = ""; txt.classList.add("hidden");
  gen.classList.add("hidden");
  v.classList.remove("hidden");

  const origName = item.origName || item.id;
  $("#viewerFilename").textContent = origName;

  const ct = (item.contentType || "").toLowerCase();
  const isImage = ct.startsWith("image/") && !ct.includes("svg");
  const isText = ct.startsWith("text/") || ct.includes("json") || ct.includes("javascript");

  if (isText) {
    try {
      const res = await fetch("/i/" + item.id + "?size=full", { headers: authHeaders() });
      if (!res.ok) return;
      txt.textContent = await res.text();
      txt.classList.remove("hidden");
    } catch {}
    $("#saveBtn").textContent = DEMO_EN ? "Copy Text" : "复制文本";
  } else if (isImage) {
    try {
      const res = await fetch("/i/" + item.id + "?size=full", { headers: authHeaders() });
      if (!res.ok) return;
      const url = URL.createObjectURL(await res.blob());
      img.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
      img.src = url; img.classList.remove("hidden");
    } catch {}
    $("#saveBtn").textContent = DEMO_EN ? "Save Image" : "保存图片";
  } else {
    $("#genericFilename").textContent = origName;
    $("#genericFilesize").textContent = formatSize(item.size);
    gen.classList.remove("hidden");
    $("#saveBtn").textContent = DEMO_EN ? "Download" : "下载文件";
  }
}

$("#closeBtn").onclick = () => $("#viewer").classList.add("hidden");

// 分享 TTL 弹窗逻辑
$("#shareBtn").onclick = () => {
  if (!currentItem) return;
  const isLarge = currentItem.size > 500 * 1024 * 1024;
  const sel = $("#shareTtlSelect");
  if (isLarge) {
    sel.innerHTML = `
      <option value="3600">1 小时</option>
      <option value="86400">1 天 (24 小时)</option>
      <option value="259200" selected>3 天 (大文件最长)</option>
    `;
    $("#shareDialogTip").textContent = "大文件 (>500MB) 为保护容量，最长支持分享 3 天：";
  } else {
    sel.innerHTML = `
      <option value="3600">1 小时</option>
      <option value="86400">1 天 (24 小时)</option>
      <option value="604800" selected>7 天</option>
      <option value="2592000">30 天</option>
    `;
    $("#shareDialogTip").textContent = "选择链接有效期：";
  }
  $("#shareDialog").classList.remove("hidden");
};
$("#shareDialogCancel").onclick = () => $("#shareDialog").classList.add("hidden");

$("#shareDialogConfirm").onclick = async () => {
  if (!currentItem) return;
  const ttlSec = Number($("#shareTtlSelect").value) || 604800;
  $("#shareDialog").classList.add("hidden");
  try {
    const res = await fetch("/api/share/" + currentItem.id + "?ttl=" + ttlSec, { method: "POST", headers: authHeaders() });
    if (!res.ok) { toast("生成链接失败"); return; }
    const { url, exp, ttlSec: actualTtl } = await res.json();
    const days = Math.round(actualTtl / 86400);
    const ttlDesc = days >= 1 ? days + "天" : Math.round(actualTtl / 3600) + "小时";
    try {
      await navigator.clipboard.writeText(url);
      toast("链接已复制（" + ttlDesc + "有效）");
    } catch {
      prompt("分享链接（" + ttlDesc + "有效），选中复制：", url);
    }
  } catch { toast("生成链接失败"); }
};

// 下载/保存
async function doDownload() {
  if (!currentItem) return;
  const ct = (currentItem.contentType || "").toLowerCase();
  if (ct.startsWith("text/") && !currentItem.origName?.includes(".")) {
    try {
      await navigator.clipboard.writeText($("#viewerText").textContent);
      toast(DEMO_EN ? "Copied" : "已复制");
    } catch {
      toast(DEMO_EN ? "Copy failed" : "复制失败");
    }
    return;
  }
  try {
    const res = await fetch("/i/" + currentItem.id + "?size=full&download=1", { headers: authHeaders() });
    if (!res.ok) { toast(DEMO_EN ? "Download failed" : "下载失败"); return; }
    const blob = await res.blob();
    const filename = currentItem.origName || (currentItem.id + (ct.includes("jpeg") ? ".jpg" : ct.includes("png") ? ".png" : ""));
    const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /Mobi|Android|iPhone/i.test(navigator.userAgent)) {
      await navigator.share({ files: [file] });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (e) {
    if (e && e.name !== "AbortError") toast(DEMO_EN ? "Download failed" : "下载失败");
  }
}

$("#saveBtn").onclick = doDownload;
$("#genericDownloadBtn").onclick = doDownload;

$("#delBtn").onclick = async () => {
  if (!currentItem || !confirm("删除此项？")) return;
  const res = await fetch("/api/img/" + currentItem.id, { method: "DELETE", headers: authHeaders() });
  if (res.ok) {
    const cell = document.querySelector('#grid [data-id="' + currentItem.id + '"]');
    if (cell) cell.remove();
    itemsMap.delete(currentItem.id);
    $("#viewer").classList.add("hidden");
    toast("已删除");
  } else { toast("删除失败"); }
};

let cursor = null, loading = false, itemsMap = new Map(), pollTimer = null;
let contentObserver;

let selectMode = false; const selected = new Set();
function toggleSelect(el) {
  const id = el.dataset.id;
  if (selected.has(id)) { selected.delete(id); el.classList.remove("sel"); }
  else { selected.add(id); el.classList.add("sel"); }
  $("#delSelBtn").textContent = "删除选中 (" + selected.size + ")";
}
function enterSelect() {
  selectMode = true; selected.clear();
  $("#selectBtn").classList.add("hidden"); $("#textBtn").classList.add("hidden"); $("#uploadBtn").classList.add("hidden");
  $("#delSelBtn").classList.remove("hidden"); $("#cancelSelBtn").classList.remove("hidden");
  $("#delSelBtn").textContent = "删除选中 (0)";
}
function exitSelect() {
  selectMode = false; selected.clear();
  document.querySelectorAll("#grid .sel").forEach((e) => e.classList.remove("sel"));
  $("#selectBtn").classList.remove("hidden"); $("#textBtn").classList.remove("hidden"); $("#uploadBtn").classList.remove("hidden");
  $("#delSelBtn").classList.add("hidden"); $("#cancelSelBtn").classList.add("hidden");
}
async function deleteSelected() {
  if (!selected.size) { exitSelect(); return; }
  if (!confirm("删除选中的 " + selected.size + " 项？")) return;
  const ids = [...selected];
  let ok = 0;
  await Promise.all(ids.map(async (id) => {
    try {
      const res = await fetch("/api/img/" + id, { method: "DELETE", headers: authHeaders() });
      if (res.ok) {
        ok++;
        const cell = document.querySelector('#grid [data-id="' + id + '"]');
        if (cell) cell.remove();
        itemsMap.delete(id);
      }
    } catch {}
  }));
  exitSelect();
  toast("已删除 " + ok + " 项");
}

async function fetchPage(c) {
  const qs = c ? "?cursor=" + encodeURIComponent(c) + "&limit=40" : "?limit=40";
  const res = await fetch("/api/list" + qs, { headers: authHeaders() });
  if (!res.ok) throw new Error("list failed");
  return res.json();
}

async function loadThumb(img) {
  const id = img.dataset.id;
  try {
    const res = await fetch("/i/" + id + "?size=thumb", { headers: authHeaders() });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    img.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
    img.src = url;
  } catch {}
}

async function loadTextSnippet(card) {
  try {
    const res = await fetch("/i/" + card.dataset.id, { headers: authHeaders() });
    if (!res.ok) return;
    card.textContent = (await res.text()).slice(0, 140);
  } catch {}
}

function getFileIcon(ext, ct) {
  if (ct.startsWith("image/")) return "🖼️";
  if (ct.startsWith("video/")) return "🎬";
  if (ct.startsWith("audio/")) return "🎵";
  if (ct.includes("zip") || ct.includes("tar") || ct.includes("rar") || ct.includes("7z")) return "📦";
  if (ct.includes("pdf")) return "📕";
  if (ct.includes("word") || ext === "doc" || ext === "docx") return "📘";
  if (ct.includes("sheet") || ext === "xls" || ext === "xlsx" || ext === "csv") return "📊";
  if (ct.includes("presentation") || ext === "ppt" || ext === "pptx") return "📙";
  if (["js", "ts", "py", "go", "rs", "java", "c", "cpp", "html", "css", "json", "md"].includes(ext)) return "💻";
  return "📄";
}

function makeCell(item) {
  const ct = (item.contentType || "").toLowerCase();
  const isImage = ct.startsWith("image/") && !ct.includes("svg");
  const isTextSnippet = ct.startsWith("text/plain") && !item.origName;

  const cell = document.createElement("div");
  cell.className = "grid-cell";
  cell.dataset.id = item.id;

  const ext = (item.origName ? item.origName.split(".").pop() : (ct.split("/")[1] || "")).toLowerCase();

  if (isImage || item.hasThumb) {
    const img = document.createElement("img");
    img.dataset.id = item.id;
    cell.appendChild(img);

    if (item.origName) {
      const footer = document.createElement("div");
      footer.className = "name-footer";
      footer.textContent = item.origName;
      cell.appendChild(footer);
    }
    contentObserver.observe(img);
  } else if (isTextSnippet) {
    const txt = document.createElement("div");
    txt.className = "txtcell";
    txt.dataset.id = item.id;
    txt.textContent = "…";
    cell.appendChild(txt);
    contentObserver.observe(txt);
  } else {
    const fileDiv = document.createElement("div");
    fileDiv.className = "filecell";
    const icon = getFileIcon(ext, ct);
    fileDiv.innerHTML = '<div class="icon">' + icon + '</div><div class="title">' + (item.origName || item.id) + '</div><div class="meta">' + (formatSize(item.size) || ext.toUpperCase()) + '</div>';
    cell.appendChild(fileDiv);
  }

  if (ext && !isTextSnippet) {
    const badge = document.createElement("div");
    badge.className = "file-badge";
    badge.textContent = ext.slice(0, 5);
    cell.appendChild(badge);
  }

  cell.onclick = () => {
    if (selectMode) toggleSelect(cell);
    else openFull(item);
  };

  return cell;
}

function appendItems(items, prepend) {
  const grid = $("#grid");
  for (const it of items) {
    if (itemsMap.has(it.id)) continue;
    itemsMap.set(it.id, it);
    const cell = makeCell(it);
    if (prepend) grid.prepend(cell); else grid.append(cell);
  }
}

async function loadMore() {
  if (loading || cursor === false) return;
  loading = true;
  try {
    const { items, cursor: next } = await fetchPage(cursor);
    appendItems(items, false);
    cursor = next || false;
  } finally { loading = false; }
}

async function poll() {
  try {
    const { items } = await fetchPage(null);
    appendItems(items.filter((i) => !itemsMap.has(i.id)).reverse(), true);
  } catch {}
}

async function initFeed() {
  contentObserver = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) {
      if (e.target.classList.contains("txtcell")) loadTextSnippet(e.target);
      else if (e.target.tagName === "IMG") loadThumb(e.target);
      contentObserver.unobserve(e.target);
    }
  }, { rootMargin: "200px" });

  cursor = null; itemsMap.clear();
  $("#grid").innerHTML = "";
  await loadMore();

  window.onscroll = () => {
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 400) loadMore();
  };
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, 20000);
}

function fitDims(w, h, maxEdge) {
  const longEdge = Math.max(w, h);
  if (longEdge <= maxEdge) return { w, h };
  const s = maxEdge / longEdge;
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

async function encode(bitmap, maxEdge, type, quality) {
  const { w, h } = maxEdge ? fitDims(bitmap.width, bitmap.height, maxEdge) : { w: bitmap.width, h: bitmap.height };
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function uploadOne(file) {
  const isImg = file.type.startsWith("image/");
  const fd = new FormData();

  if (isImg) {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const thumb = await encode(bitmap, 480, "image/jpeg", 0.7);
        if (thumb) fd.set("thumb", thumb, "t.jpg");
      } finally {
        bitmap.close();
      }
    } catch {}
  }

  fd.set("full", file, file.name);
  const headers = { ...authHeaders(), "x-source": "pwa", "x-filename": encodeURIComponent(file.name) };
  const res = await fetch("/api/upload", { method: "POST", headers, body: fd });
  if (!res.ok) throw new Error("upload failed");
  return (await res.json()).id;
}

async function sendText(text) {
  if (!text.trim()) return false;
  const fd = new FormData();
  fd.set("full", new Blob([text], { type: "text/plain;charset=utf-8" }), "note.txt");
  const res = await fetch("/api/upload", { method: "POST", headers: { ...authHeaders(), "x-source": "pwa" }, body: fd });
  if (!res.ok) { toast("文字发送失败"); return false; }
  return true;
}

function setupUpload() {
  const input = $("#fileInput");
  $("#uploadBtn").onclick = () => input.click();
  input.onchange = async () => {
    const files = [...input.files];
    input.value = "";
    let ok = 0;
    for (const f of files) {
      try { await uploadOne(f); ok++; } catch { toast("文件上传失败: " + f.name); }
    }
    if (ok > 0) toast(ok === files.length ? "上传完成" : ok + "/" + files.length + " 上传成功");
    await poll();
  };

  const compose = $("#compose"), composeText = $("#composeText");
  $("#textBtn").onclick = () => { composeText.value = ""; compose.classList.remove("hidden"); composeText.focus(); };
  $("#composeCancel").onclick = () => compose.classList.add("hidden");
  $("#composeSend").onclick = async () => {
    if (await sendText(composeText.value)) { compose.classList.add("hidden"); toast("已发送"); await poll(); }
  };

  $("#selectBtn").onclick = enterSelect;
  $("#cancelSelBtn").onclick = exitSelect;
  $("#delSelBtn").onclick = deleteSelected;
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

async function enterDemo() {
  showApp();
  ["#uploadBtn", "#textBtn", "#selectBtn", "#shareBtn", "#delBtn"].forEach((s) => $(s).classList.add("hidden"));
  if (DEMO_EN) document.documentElement.lang = "en";
  $("#bar h1").textContent = DEMO_EN ? "shotsync · read-only demo" : "shotsync · 只读演示池";
  $("#closeBtn").textContent = DEMO_EN ? "Close" : "关闭";
  const link = document.createElement("a");
  link.href = "https://github.com/Defiabell/shotsync";
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = DEMO_EN ? "Deploy your own in ~5 min →" : "5 分钟部署自己的 →";
  link.style.cssText = "color:#8ab4ff;font-size:13px;text-decoration:none;white-space:nowrap";
  $("#bar").appendChild(link);
  await initFeed();
}

(async function boot() {
  if (DEMO) { await enterDemo(); return; }
  if (token && await apiOk()) { showApp(); setupUpload(); await initFeed(); }
  else { showGate(); }
})();
</script>
</body>
</html>`;

export const galleryDemoHTML = galleryHTML.replace("const DEMO = false", "const DEMO = true");
