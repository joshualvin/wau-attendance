"use strict";
/* Attendance front end: hash-routed pages over api.php (MySQL). */

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const shift = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const mins = (hm) => { const [h, m] = (hm || "0:0").split(":").map(Number); return h * 60 + m; };
const nowMins = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const fmt = (s, o) => (s ? parse(s).toLocaleDateString("en-GB", o || { day: "numeric", month: "short", year: "numeric" }) : "-");
const fmtDay = (s) => parse(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const initials = (n) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

const ICON = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  profile: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18a6 6 0 0 1 11 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  chev: '<path d="M9 6l6 6-6 6"/>', left: '<path d="M15 6l-6 6 6 6"/>',
  collapse: '<path d="M4 4v16M20 12H9M13 8l-4 4 4 4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  warn: '<path d="M12 3l10 18H2zM12 10v5M12 18h.01"/>', pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  doc: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  empty: '<rect x="14" y="10" width="68" height="52" rx="4"/><path d="M14 22h68M24 34h30M24 44h44M24 54h20"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>', building: '<path d="M4 21V5l8-2v18M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2M2 21h20"/>',
};
const icon = (n, vb = "0 0 24 24") => `<svg viewBox="${vb}" aria-hidden="true">${ICON[n]}</svg>`;
const emptyState = (title, sub) => `<div class="empty">${icon("empty", "0 0 96 72")}<strong>${esc(title)}</strong><span>${esc(sub)}</span></div>`;

const LV = { annual: { label: "Annual leave", code: "CT" }, sick: { label: "Sick leave", code: "S" }, permission: { label: "Permission", code: "I" } };
const REQ = { full_day: "Full day", half_day_morning: "Half day (morning)", half_day_afternoon: "Half day (afternoon)" };
const FLAGS = [["ontime", "On time"], ["late", "Late clock in"], ["early", "Early clock out"], ["noout", "No clock out"], ["noin", "No clock in"], ["absent", "Absent"], ["dayoff", "Day off"], ["timeoff", "Time off"]];
const DAYNAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* ---------- state ---------- */
const S = {
  co: { name: "Wahyu Agung Utama", workStart: "09:00", workEnd: "17:00", grace: 15, workDays: [1, 2, 3, 4, 5], leaveQuota: 12 },
  emps: new Map(), days: new Map(), leave: [], today: iso(new Date()), dbLabel: "", mode: "loading", error: "",
  meId: null, route: "home", arg: null, ui: {}, activity: { date: null, events: [] }, myLog: [], geo: { state: "idle" },
};
const ui = (k, d = {}) => (S.ui[k] = S.ui[k] || { page: 1, size: 10, sort: null, dir: "asc", q: "", ...d });
const today = () => S.today;
const empList = () => [...S.emps.values()].sort((a, b) => a.name.localeCompare(b.name));
const emp = (id) => S.emps.get(String(id));
const me = () => (S.meId ? emp(S.meId) : null);
const rec = (date, id) => (S.days.get(date) || {})[id] || null;
const leaveOn = (date, id) => S.leave.find((l) => l.empId === String(id) && l.status === "approved" && l.from <= date && date <= l.to) || null;
const isWorkday = (date) => S.co.workDays.includes(parse(date).getDay());
const reqId = (id) => "TO-" + String(id).padStart(5, "0");
const sub = (e) => [e.code, e.org || e.position].filter(Boolean).join(" | ");
const matches = (e, q) => !q || (e.name + " " + (e.code || "")).toLowerCase().includes(q.toLowerCase());

/** Talenta-style reading of one employee's day: flags for the counters plus the two codes. */
function dayInfo(date, e) {
  if (e.joinDate && date < e.joinDate) return { r: {}, lv: null, scheduled: false, f: {}, attCode: "", toCode: "" };
  const r = rec(date, e.id) || {}, lv = leaveOn(date, e.id), scheduled = isWorkday(date);
  const past = date < today(), isToday = date === today(), now = nowMins();
  const start = mins(S.co.workStart), end = mins(S.co.workEnd), f = {};
  if (r.status === "absent") f.absent = 1;
  else if (r.status === "sick" || r.status === "leave" || (lv && !r.in)) f.timeoff = 1;
  else if (!scheduled && !r.in) f.dayoff = 1;
  else if (r.in) {
    if (mins(r.in) > start + S.co.grace) f.late = 1; else f.ontime = 1;
    if (r.out && mins(r.out) < end) f.early = 1;
    if (!r.out && (past || (isToday && now > end))) f.noout = 1;
  } else if (scheduled && date <= today() && (past || now > start + S.co.grace)) f.noin = 1;
  const toCode = lv ? LV[lv.type].code : r.status === "sick" ? "S" : r.status === "leave" ? "CT" : "";
  const attCode = r.in ? "H" : f.absent ? "A" : f.dayoff ? "OFF" : f.timeoff ? toCode : "";
  return { r, lv, scheduled, f, attCode, toCode };
}
function workdaysBetween(from, to) { let n = 0; for (let d = from; d <= to; d = shift(d, 1)) if (isWorkday(d)) n++; return n; }
function leaveDays(l) { return l.requestType === "full_day" ? workdaysBetween(l.from, l.to) : 0.5; }

/* ---------- API ---------- */
async function api(body, query) {
  const url = "api.php" + (query ? "?" + new URLSearchParams(query) : "");
  const res = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  let data;
  try { data = await res.json(); } catch (_) { throw new Error("The server sent an unexpected reply (HTTP " + res.status + ")."); }
  if (!res.ok || data.error) throw new Error(data.error || "HTTP " + res.status);
  return data;
}
let loadingNow = null;
function load() { return (loadingNow = loadingNow || loadOnce().finally(() => (loadingNow = null))); }
async function loadOnce() {
  try {
    const d = await api(null, { action: "state" });
    S.co = d.company; S.today = d.server.today; S.dbLabel = d.server.database;
    S.emps = new Map(d.employees.map((e) => [String(e.id), { ...e, id: String(e.id) }]));
    S.days = new Map(Object.entries(d.days));
    S.leave = d.leave.map((l) => ({ ...l, id: String(l.id), empId: String(l.empId) }));
    S.mode = "ok"; S.error = ""; S.loadedAt = new Date();
    if (S.meId && !S.emps.has(S.meId)) setMe(null);
  } catch (e) { S.mode = "error"; S.error = e.message; }
  render();
}
async function act(body, okMsg) {
  try {
    const r = await api(body);
    if (okMsg) toast(typeof okMsg === "function" ? okMsg(r) : okMsg);
    await load();
    return r;
  } catch (e) { toast(e.message, true); return null; }
}
function setMe(id) { S.meId = id; try { id ? localStorage.setItem("wau-me", id) : localStorage.removeItem("wau-me"); } catch (_) {} }

/* ---------- toast, modal, popovers ---------- */
let toastT;
function toast(m, bad) { const t = $("#toast"); t.textContent = m; t.className = "toast" + (bad ? " bad" : ""); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3400); }
function openModal(title, body, foot) {
  $("#modalTitle").textContent = title; $("#modalBody").innerHTML = body; $("#modalFoot").innerHTML = foot || "";
  $("#modal").hidden = false;
  setTimeout(() => ($("#modalBody input, #modalBody select, #modalBody textarea") || $("#modal [data-close]")).focus(), 0);
}
function closeModal() { $("#modal").hidden = true; if (pending) { pending = false; render(); } }
let popAnchor = null;
function openPop(anchor, html, align = "right") {
  const p = $("#menuPop");
  if (popAnchor === anchor && !p.hidden) return closePop();
  p.innerHTML = html; p.hidden = false; popAnchor = anchor;
  const r = anchor.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
  let left = align === "right" ? r.right - w : r.left;
  left = Math.max(8, Math.min(left, innerWidth - w - 8));
  let top = r.bottom + 6 + scrollY;
  if (r.bottom + h + 12 > innerHeight && r.top - h - 6 > 0) top = r.top - h - 6 + scrollY;
  p.style.left = left + "px"; p.style.top = top + "px";
}
function closePop() { $("#menuPop").hidden = true; popAnchor = null; }

/* ---------- navigation ---------- */
const MENU = [
  { key: "home", label: "Home", icon: "home", href: "#/home" },
  { key: "live", label: "Live attendance", icon: "profile", href: "#/live-attendance" },
  { key: "employees", label: "Employees", icon: "users", section: "Employees", items: [["#/employees/list", "Employee directory"], ["#/employees/create", "Add employee"]] },
  { key: "time", label: "Time", icon: "clock", section: "Time", items: [["#/time-off/requests", "Time off"], ["#/attendance/data", "Attendance"], ["#/live-attendance", "Live attendance"]] },
  { sep: true },
  { key: "settings", label: "Settings", icon: "gear", href: "#/settings" },
];
const SUBNAV = {
  attendance: { title: "Attendance", items: [["#/attendance/data", "Attendance data"], ["#/attendance/activity", "Attendance activity"], ["#/attendance/report", "Attendance report"], ["#/settings", "Setting"]] },
  "time-off": { title: "Time off", items: [["#/time-off/requests", "Time off requests"], ["#/time-off/balance", "Balance"], ["#/settings", "Settings"]] },
  employees: { title: "Employee directory", items: [["#/employees/list", "Employee list"]] },
};
const moduleOf = (route) => route.split("/")[0];
const menuKeyOf = (route) => ({ home: "home", "live-attendance": "live", employees: "employees", attendance: "time", "time-off": "time", settings: "settings" }[moduleOf(route)]);
let railWide = null;
try { railWide = localStorage.getItem("wau-rail"); railWide = railWide === null ? null : railWide === "1"; } catch (_) {}

function renderRail() {
  const wide = railWide ?? S.route === "home";
  const rail = $("#rail");
  rail.className = "rail" + (wide ? " wide" : "");
  const cur = menuKeyOf(S.route);
  rail.innerHTML = MENU.map((m) => m.sep ? `<hr class="sep">` :
    m.items ? `<button class="item${cur === m.key ? " on" : ""}" data-fly="${m.key}" aria-haspopup="true" aria-label="${m.label}" title="${m.label}">${icon(m.icon)}<span class="lbl">${m.label}</span>${icon("chev").replace("<svg", '<svg class="chev"')}</button>`
      : `<a class="item${cur === m.key ? " on" : ""}" href="${m.href}" title="${m.label}">${icon(m.icon)}<span class="lbl">${m.label}</span></a>`).join("")
    + `<div class="bottom"><button class="item" data-act="toggleRail" title="${wide ? "Collapse menu" : "Expand menu"}" aria-label="${wide ? "Collapse menu" : "Expand menu"}">${icon("collapse")}<span class="lbl cid">Company: ${esc(S.co.name)}</span></button></div>`;
}
function showFly(btn) {
  const m = MENU.find((x) => x.key === btn.dataset.fly), f = $("#flyout"), r = btn.getBoundingClientRect();
  f.innerHTML = `<div class="label">${m.section}</div>` + m.items.map(([h, l]) => `<a href="${h}" class="${location.hash === h ? "on" : ""}">${l}</a>`).join("");
  f.hidden = false; f.style.left = r.right + 6 + "px"; f.style.top = Math.min(r.top, innerHeight - f.offsetHeight - 8) + "px";
}
let flyT;
function hideFlySoon() { clearTimeout(flyT); flyT = setTimeout(() => ($("#flyout").hidden = true), 220); }

function renderSubnav() {
  const n = SUBNAV[moduleOf(S.route)], el = $("#subnav");
  if (!n) { el.hidden = true; return; }
  el.hidden = false;
  const h = "#/" + S.route;
  el.innerHTML = `<div class="title">${n.title}</div>` + n.items.map(([href, l]) => `<a href="${href}" class="${h.startsWith(href) ? "on" : ""}">${l}</a>`).join("");
}
function renderChrome() {
  $("#coName").textContent = S.co.name || "Your company";
  $("#mark").textContent = initials(S.co.name).slice(0, 3) || "HR";
  const m = me();
  $("#meIni").textContent = m ? initials(m.name) : "?";
  $("#meName").textContent = m ? m.name : "Choose who you are";
  $("#meCo").textContent = S.co.name;
  const pend = S.leave.filter((l) => l.status === "pending").length;
  $("#bellCount").textContent = pend; $("#bellCount").hidden = !pend;
  renderRail(); renderSubnav();
}

/* ---------- table ---------- */
function table(key, cols, rows, emptyHtml) {
  const st = ui(key);
  const col = cols.find((c) => c.k === st.sort);
  if (col && col.sort) rows = [...rows].sort((a, b) => { const x = col.sort(a), y = col.sort(b); return (x > y ? 1 : x < y ? -1 : 0) * (st.dir === "asc" ? 1 : -1); });
  const n = rows.length, pages = Math.max(1, Math.ceil(n / st.size));
  st.page = Math.min(Math.max(1, st.page), pages);
  const slice = rows.slice((st.page - 1) * st.size, st.page * st.size);
  const head = cols.map((c) => `<th class="${c.sort ? "sort" : ""}${st.sort === c.k ? " " + st.dir : ""}${c.cls ? " " + c.cls : ""}" ${c.sort ? `data-sort="${key}:${c.k}"` : ""}>${c.label}</th>`).join("");
  const body = slice.map((r) => `<tr>${cols.map((c) => `<td class="${c.cls || ""}">${c.cell(r)}</td>`).join("")}</tr>`).join("");
  return `<div class="tablecard"><div class="tablescroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    ${n ? "" : emptyHtml}
    <div class="pager"><span>Rows per page</span><select data-size="${key}" aria-label="Rows per page">${[10, 20, 50, 100].map((s) => `<option ${s === st.size ? "selected" : ""}>${s}</option>`).join("")}</select>
      <span>Showing ${n ? (st.page - 1) * st.size + 1 : 0} - ${Math.min(st.page * st.size, n)} of ${n}</span><span class="grow"></span>
      <span class="pg"><input type="number" min="1" max="${pages}" value="${st.page}" data-page="${key}" aria-label="Page"> of ${plural(pages, "page")}
      <button class="iconbtn" data-act="pageStep" data-key="${key}" data-n="-1" aria-label="Previous page" ${st.page <= 1 ? "disabled" : ""}>${icon("left")}</button>
      <button class="iconbtn" data-act="pageStep" data-key="${key}" data-n="1" aria-label="Next page" ${st.page >= pages ? "disabled" : ""}>${icon("chev")}</button></span></div></div>`;
}
const whoCell = (e, href) => `<div class="who"><span class="avatar">${initials(e.name)}</span><div><b>${href ? `<a href="${href}">${esc(e.name)}</a>` : esc(e.name)}</b><small>${esc(sub(e)) || "&nbsp;"}</small></div></div>`;
const actionsBtn = (menu, data) => `<button class="btn small outline" data-act="rowMenu" data-menu="${menu}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ")}>Actions ▾</button>`;
const searchBox = (key, ph) => `<label class="search">${icon("search")}<input type="search" data-q="${key}" value="${esc(ui(key).q)}" placeholder="${ph}" aria-label="${ph}"></label>`;
const band = (title, right = "", crumb = "") => `<div class="band"><h1>${crumb ? `<a class="crumb" href="${crumb[0]}">${crumb[1]}</a>` : ""}${esc(title)}</h1>${right}</div>`;

/* ---------- pages ---------- */
const PAGES = {};

PAGES.home = () => {
  const h = new Date().getHours(), first = (me()?.name || "").split(" ")[0];
  const emps = empList(), T = today(), total = emps.length;
  const c = { ontime: 0, late: 0, absent: 0, off: 0, none: 0 };
  emps.forEach((e) => { const { f } = dayInfo(T, e); if (f.ontime) c.ontime++; else if (f.late) c.late++; else if (f.absent) c.absent++; else if (f.timeoff || f.dayoff) c.off++; else c.none++; });
  const parts = [["ontime", "On time", "var(--ok)"], ["late", "Late", "var(--warn)"], ["absent", "Absent", "var(--bad)"], ["off", "Off / day off", "var(--off)"], ["none", "Not clocked in", "var(--line-strong)"]];
  let on = 0, late = 0;
  for (let i = 0; i < 30; i++) { const d = shift(T, -i); emps.forEach((e) => { const { f } = dayInfo(d, e); if (f.ontime) on++; if (f.late) late++; }); }
  const punct = on + late ? Math.round((on / (on + late)) * 100) : null;
  const days = Array.from({ length: 7 }, (_, i) => shift(T, i - 6));
  const counts = days.map((d) => emps.filter((e) => rec(d, e.id)?.in).length);
  const maxY = Math.max(total, 1), W = 260, H = 160, L = 24, B = 24, bw = (W - L - 4) / 7, y = (v) => H - B - (v / maxY) * (H - B - 12);
  const ticks = [...new Set([0, Math.ceil(maxY / 2), maxY])];
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Employees who clocked in, last 7 days">
    ${ticks.map((t) => `<line x1="${L}" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 7}" y="${y(t) + 3}" text-anchor="end">${t}</text>`).join("")}
    ${counts.map((v, i) => `<rect x="${L + 6 + i * bw}" y="${y(v)}" width="${bw - 12}" height="${Math.max(0, H - B - y(v))}" fill="${days[i] === T ? "var(--primary)" : "#9aa8ee"}"><title>${fmt(days[i])}: ${v} clocked in</title></rect>
      <text x="${L + i * bw + bw / 2 + 2}" y="${H - 7}" text-anchor="middle">${parse(days[i]).toLocaleDateString("en-GB", { weekday: "short" })}</text>`).join("")}</svg>`;
  const byStatus = {}; emps.forEach((e) => (byStatus[e.status] = (byStatus[e.status] || 0) + 1));
  const pal = ["var(--primary)", "var(--off)", "var(--warn)"];
  const pend = S.leave.filter((l) => l.status === "pending");
  const off = emps.map((e) => ({ e, i: dayInfo(T, e) })).filter((x) => x.i.f.timeoff);
  const widget = (title, body, foot) => `<div class="card widget"><div class="wbody"><h2>${title}</h2>${body}</div><div class="wfoot">${foot}</div></div>`;
  return `<div class="content"><div class="homegrid">
    <div class="card hello"><h1>${h < 11 ? "Good morning" : h < 15 ? "Good afternoon" : h < 19 ? "Good evening" : "Good night"}${first ? ", " + esc(first) : ""}!</h1>
      <p>It's ${parse(T).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>
      <p class="label">Shortcut</p><div class="chips"><a class="chip" href="#/live-attendance">Live attendance</a><a class="chip" href="#/time-off/create">Request time off</a><a class="chip" href="#/attendance/data">Attendance data</a><a class="chip" href="#/employees/create">Add employee</a></div></div>
    <div class="grid4">
      ${widget("Today's attendance", `<div class="stack">${parts.map(([k, , col]) => (c[k] ? `<i style="width:${(c[k] / Math.max(total, 1)) * 100}%;background:${col}"></i>` : "")).join("")}</div><div class="scale"><span>0%</span><span>100%</span></div>
        <div class="kv"><div class="tot"><span>Total</span><span class="n">${total}</span></div>${parts.map(([k, l, col]) => `<div><i class="dot" style="background:${col}"></i><span>${l}</span><span class="n">${c[k]}</span><span class="p">${pct(c[k], total)}%</span></div>`).join("")}</div>`, `<a href="#/attendance/data">View attendance data</a>`)}
      ${widget("Clock-ins, last 7 days", `<div class="chart">${svg}</div>`, "Employees who clocked in each day")}
      ${widget("Punctuality", `<div class="donut" style="background:${punct == null ? "var(--line)" : `conic-gradient(var(--ok) 0 ${punct}%, var(--warn) ${punct}% 100%)`}"><span>${punct == null ? "-" : punct + "%"}</span></div>
        <div class="kv"><div><i class="dot" style="background:var(--ok)"></i><span>On time</span><span class="n">${on}</span><span class="p">${pct(on, on + late)}%</span></div><div><i class="dot" style="background:var(--warn)"></i><span>Late clock in</span><span class="n">${late}</span><span class="p">${pct(late, on + late)}%</span></div></div>`, "Last 30 days")}
      ${widget("Employment status", `<div class="stack">${Object.values(byStatus).map((n, i) => `<i style="width:${(n / Math.max(total, 1)) * 100}%;background:${pal[i % 3]}"></i>`).join("")}</div><div class="scale"><span>0%</span><span>100%</span></div>
        <div class="kv"><div class="tot"><span>Total</span><span class="n">${total}</span></div>${Object.entries(byStatus).map(([k, n], i) => `<div><i class="dot" style="background:${pal[i % 3]}"></i><span>${esc(k)}</span><span class="n">${n}</span><span class="p">${pct(n, total)}%</span></div>`).join("")}</div>`, `<a href="#/employees/list">View employees</a>`)}
    </div>
    <div class="grid3">
      <div class="card quick"><h2>Quick links</h2><a href="#/employees/list">${icon("profile")}Employee directory</a><a href="#/employees/create">${icon("plus")}Add employee</a><a href="#/attendance/activity">${icon("clock")}Attendance activity</a><a href="#/attendance/report">${icon("doc")}Attendance report</a><a href="#/time-off/balance">${icon("calendar")}Time off balance</a><a href="#/settings">${icon("building")}Company settings</a></div>
      <div class="card"><h2>Time off requests<span class="side">Waiting for approval</span></h2>${pend.length ? `<div class="list">${pend.slice(0, 6).map((l) => `<div class="li"><span class="avatar" style="background:var(--line);color:var(--muted)">${initials(l.empName)}</span><div class="meta"><b>${esc(l.empName)}</b><small>${LV[l.type].label} · ${fmt(l.from)}${l.to !== l.from ? " – " + fmt(l.to) : ""}</small></div><button class="btn small" data-act="decide" data-id="${l.id}" data-status="rejected">Reject</button><button class="btn small primary" data-act="decide" data-id="${l.id}" data-status="approved">Approve</button></div>`).join("")}</div>` : `<div class="empty" style="padding:24px">No requests waiting for approval</div>`}</div>
      <div class="card"><h2>Who's off<span class="side">Today</span></h2>${off.length ? `<div class="list">${off.map(({ e, i }) => `<div class="li"><span class="avatar" style="background:var(--off-soft);color:var(--off)">${initials(e.name)}</span><div class="meta"><b>${esc(e.name)}</b><small>${i.lv ? `${LV[i.lv.type].label} · until ${fmt(i.lv.to, { day: "numeric", month: "short" })}` : "Time off"}</small></div></div>`).join("")}</div>` : `<div class="empty" style="padding:24px">No employee off today</div>`}</div>
    </div></div></div>`;
};

PAGES["live-attendance"] = {
  static: true,
  html: () => {
    const emps = empList(), m = me();
    return band("Live Attendance") + `<div class="content"><div class="live">
      <div id="geoNote"></div>
      <div class="clockcard">
        <div class="as">${emps.length ? `<span>Clocking in as</span><select id="liveMe" aria-label="Employee">${m ? "" : `<option value="">Choose your name</option>`}${emps.map((e) => `<option value="${e.id}" ${m && m.id === e.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select>` : `<a href="#/employees/create">Add an employee first</a>`}</div>
        <div class="big" id="liveClock">--:--:--</div><div class="date">${parse(today()).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
        <div class="sched" id="liveSched"></div>
        <textarea id="liveNote" maxlength="200" placeholder="Notes (optional)" aria-label="Notes"></textarea>
        <div class="btns"><button class="btn primary" data-act="clock" data-kind="in" id="btnIn">Clock In</button><button class="btn primary" data-act="clock" data-kind="out" id="btnOut">Clock Out</button></div>
        <div class="muted" id="liveState" style="font-size:13px;margin-top:6px"></div>
      </div>
      <div class="card"><h2>Attendance log</h2><div id="liveLog"></div></div>
    </div></div>`;
  },
  mount: () => { tick(); locate(); refreshMyLog(); },
  refresh: () => {
    const m = me(), T = today();
    const sched = isWorkday(T) ? `<small>Schedule, ${fmt(T)}</small><b>${S.co.workStart} - ${S.co.workEnd}</b>` : `<small>Schedule, ${fmt(T)}</small><b class="red">No working hours</b>`;
    $("#liveSched").innerHTML = sched;
    const r = m ? rec(T, m.id) || {} : {};
    $("#btnIn").disabled = !m || !!r.in || S.mode !== "ok";
    $("#btnOut").disabled = !m || !r.in || !!r.out || S.mode !== "ok";
    $("#liveState").textContent = !m ? "Choose your name to clock in." : r.out ? `Clocked in ${r.in} · clocked out ${r.out}` : r.in ? `Clocked in at ${r.in}${mins(r.in) > mins(S.co.workStart) + S.co.grace ? " (late)" : ""}` : "You haven't clocked in today.";
    const g = S.geo;
    $("#geoNote").innerHTML = g.state === "fail" ? `<div class="notice">${icon("warn")}<div><b>Location detection failed</b>${esc(g.msg)} Clock-ins are saved without a location.</div></div>` : "";
    $("#liveLog").innerHTML = !m ? emptyState("No attendance log today", "Your Clock In/Out activity will show up here.") : S.myLog.length
      ? `<div class="list">${S.myLog.map((ev) => `<div class="logitem"><span class="t">${esc(ev.time)}</span><div class="meta" style="flex:1"><b>${KIND[ev.kind]}</b><small class="muted">${fmt(ev.date)}${ev.lat ? ` · ${mapLink(ev)}` : ""}${ev.detail ? " · " + esc(ev.detail) : ""}</small></div></div>`).join("")}</div>`
      : emptyState("No attendance log today", "Your Clock In/Out activity will show up here.");
  },
};
const KIND = { clock_in: "Clock in", clock_out: "Clock out", edit: "Edited", delete: "Deleted" };
const mapLink = (ev) => `<a href="https://www.google.com/maps?q=${ev.lat},${ev.lng}" target="_blank" rel="noopener">${Number(ev.lat).toFixed(5)}, ${Number(ev.lng).toFixed(5)}</a>`;
function tick() { const el = $("#liveClock"); if (el) el.textContent = new Date().toLocaleTimeString("en-GB"); }
setInterval(tick, 1000);
function locate() {
  if (!window.isSecureContext || !navigator.geolocation) {
    S.geo = { state: "fail", msg: " This address isn't secure (https), so the browser won't share a location." };
    return PAGES["live-attendance"].refresh();
  }
  S.geo = { state: "busy" };
  navigator.geolocation.getCurrentPosition(
    (p) => { S.geo = { state: "ok", lat: p.coords.latitude, lng: p.coords.longitude }; if (S.route === "live-attendance") PAGES["live-attendance"].refresh(); },
    () => { S.geo = { state: "fail", msg: " Allow location for this site in the browser's address bar, then reload the page." }; if (S.route === "live-attendance") PAGES["live-attendance"].refresh(); },
    { timeout: 8000, maximumAge: 60000 });
}
async function refreshMyLog() {
  const m = me();
  S.myLog = [];
  if (m) { try { S.myLog = (await api(null, { action: "history", empId: m.id, date: today() })).events; } catch (_) {} }
  if (S.route === "live-attendance") PAGES["live-attendance"].refresh();
}

PAGES["attendance/data"] = () => {
  const st = ui("att", { date: null, filter: "" }); st.date = st.date || today();
  const emps = empList().filter((e) => matches(e, st.q));
  const infos = emps.map((e) => ({ e, i: dayInfo(st.date, e) }));
  const count = Object.fromEntries(FLAGS.map(([k]) => [k, infos.filter((x) => x.i.f[k]).length]));
  const rows = st.filter ? infos.filter((x) => x.i.f[st.filter]) : infos;
  const sched = isWorkday(st.date);
  const cols = [
    { k: "name", label: "Employee name", sort: (x) => x.e.name, cell: (x) => whoCell(x.e, `#/employees/edit/${x.e.id}`) },
    { k: "date", label: "Date", cell: () => fmtDay(st.date) },
    { k: "shift", label: "Shift", cell: () => (sched ? "Office hour" : `<span class="red">No working hours</span>`) },
    { k: "sin", label: "Schedule in", cell: () => (sched ? S.co.workStart : "00:00") },
    { k: "sout", label: "Schedule out", cell: () => (sched ? S.co.workEnd : "00:00") },
    { k: "in", label: "Clock in", sort: (x) => x.i.r.in || "", cell: (x) => (x.i.r.in ? `<span class="${x.i.f.late ? "red" : ""}">${x.i.r.in}</span>` : "-") },
    { k: "out", label: "Clock out", sort: (x) => x.i.r.out || "", cell: (x) => (x.i.r.out ? `<span class="${x.i.f.early ? "red" : ""}">${x.i.r.out}</span>` : "-") },
    { k: "code", label: "Attendance code", cell: (x) => (x.i.attCode ? `<span class="code">${x.i.attCode}</span>` : "-") },
    { k: "to", label: "Time off code", cell: (x) => (x.i.toCode ? `<span class="code">${x.i.toCode}</span>` : "-") },
    { k: "status", label: "Status", cell: (x) => statusPill(x.i.f) },
    { k: "act", label: "", cls: "actions", cell: (x) => actionsBtn("att", { emp: x.e.id, date: st.date }) },
  ];
  return band("Attendance data", `<button class="btn" data-act="markAbsent">Mark no clock in as absent</button><a class="btn primary" href="#/live-attendance">Live attendance</a>`) + `<div class="content">
    <div class="toolbar"><input type="date" id="attDate" value="${st.date}" aria-label="Date"><select id="attFilter" aria-label="Status"><option value="">All status</option>${FLAGS.map(([k, l]) => `<option value="${k}" ${st.filter === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      ${st.filter || st.q ? `<button class="linkbtn" data-act="clearAtt">Clear filters</button>` : ""}<span class="grow"></span>
      <a class="iconbtn" href="api.php?action=export&month=${st.date.slice(0, 7)}" title="Export ${parse(st.date).toLocaleDateString("en-GB", { month: "long", year: "numeric" })} as CSV" aria-label="Export month as CSV">${icon("download")}</a>${searchBox("att", "Search employee name / ID")}</div>
    <div class="counters">${FLAGS.map(([k, l]) => `<button class="counter${st.filter === k ? " on" : ""}${k === "absent" ? " sep" : ""}" data-act="attCounter" data-k="${k}"><b>${count[k]}</b><span>${l}</span></button>`).join("")}</div>
    ${table("att", cols, rows, emps.length ? emptyState("No matching attendance", "Try another status or search.") : emptyState("No employees yet", "Add employees to start recording attendance."))}</div>`;
};
function statusPill(f) {
  if (f.absent) return `<span class="pill bad">Absent</span>`;
  if (f.timeoff) return `<span class="pill off">Time off</span>`;
  if (f.dayoff) return `<span class="pill grey">Day off</span>`;
  const tags = [];
  if (f.ontime) tags.push(`<span class="pill ok">On time</span>`);
  if (f.late) tags.push(`<span class="pill warn">Late clock in</span>`);
  if (f.early) tags.push(`<span class="pill warn">Early clock out</span>`);
  if (f.noout) tags.push(`<span class="pill bad">No clock out</span>`);
  if (f.noin) tags.push(`<span class="pill bad">No clock in</span>`);
  return tags.join(" ") || "-";
}

PAGES["attendance/activity"] = () => {
  const st = ui("act", { date: null, type: "" }); st.date = st.date || today();
  if (S.activity.date !== st.date) { fetchActivity(st.date); }
  const evs = S.activity.date === st.date ? S.activity.events : null;
  const rows = (evs || []).filter((ev) => (!st.type || ev.kind === st.type) && (!st.q || (ev.empName + " " + (ev.code || "")).toLowerCase().includes(st.q.toLowerCase())));
  const cols = [
    { k: "name", label: "Employee name", sort: (x) => x.empName, cell: (x) => `<b style="font-weight:500">${esc(x.empName)}</b>` },
    { k: "code", label: "Employee ID", sort: (x) => x.code || "", cell: (x) => esc(x.code || "-") },
    { k: "date", label: "Date", cell: (x) => fmt(x.date) },
    { k: "time", label: "Time", sort: (x) => x.time, cell: (x) => esc(x.time) },
    { k: "type", label: "Type", cell: (x) => `<span class="pill ${x.kind === "clock_in" ? "ok" : x.kind === "clock_out" ? "off" : x.kind === "delete" ? "bad" : "grey"}">${KIND[x.kind]}</span>` },
    { k: "pos", label: "Job position", cell: (x) => esc(x.position || "-") },
    { k: "src", label: "Source", cell: (x) => (x.source === "live" ? "Live attendance" : "Changed by admin") },
    { k: "loc", label: "Location", cell: (x) => (x.lat ? mapLink(x) : "-") },
    { k: "note", label: "Notes", cell: (x) => `<span style="white-space:normal">${esc(x.detail || "-")}</span>` },
  ];
  return band("Attendance activity", "", ["#/attendance/data", "Attendance"]) + `<div class="content">
    <div class="toolbar"><input type="date" id="actDate" value="${st.date}" aria-label="Date"><select id="actType" aria-label="Type"><option value="">All types</option>${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${st.type === k ? "selected" : ""}>${l}</option>`).join("")}</select><span class="grow"></span>${searchBox("act", "Search...")}</div>
    ${evs ? table("act", cols, rows, emptyState("No data yet", "Clock in/out activity and changes for this date will display here.")) : `<div class="tablecard">${emptyState("Loading activity…", "")}</div>`}</div>`;
};
async function fetchActivity(date) {
  S.activity = { date: "loading:" + date, events: [] };
  try { const r = await api(null, { action: "activity", date }); S.activity = { date, events: r.events }; }
  catch (e) { S.activity = { date, events: [] }; toast(e.message, true); }
  if (S.route === "attendance/activity") render(true);
}

PAGES["attendance/report"] = () => {
  const st = ui("rep", { month: null }); st.month = st.month || today().slice(0, 7);
  const [y, m] = st.month.split("-").map(Number), last = new Date(y, m, 0).getDate();
  const dates = Array.from({ length: last }, (_, i) => `${st.month}-${String(i + 1).padStart(2, "0")}`).filter((d) => d <= today());
  const rows = empList().filter((e) => matches(e, st.q)).map((e) => {
    const c = { work: 0, ontime: 0, late: 0, early: 0, noout: 0, noin: 0, absent: 0, timeoff: 0 };
    dates.forEach((d) => { const { f, scheduled } = dayInfo(d, e); if (scheduled) c.work++; for (const k in c) if (f[k]) c[k]++; });
    const present = c.ontime + c.late, base = c.work - c.timeoff;
    return { e, c, rate: base > 0 ? present / base : null };
  });
  const n = (k) => ({ k, label: FLAGS.find((f) => f[0] === k)?.[1] || k, sort: (x) => x.c[k], cls: "num", cell: (x) => x.c[k] });
  const cols = [
    { k: "name", label: "Employee name", sort: (x) => x.e.name, cell: (x) => whoCell(x.e) },
    { k: "org", label: "Organization", sort: (x) => x.e.org || "", cell: (x) => esc(x.e.org || "-") },
    { k: "work", label: "Working days", sort: (x) => x.c.work, cls: "num", cell: (x) => x.c.work },
    n("ontime"), n("late"), n("early"), n("noout"), n("noin"), n("absent"), n("timeoff"),
    { k: "rate", label: "Attendance rate", sort: (x) => x.rate ?? -1, cls: "num", cell: (x) => (x.rate == null ? "-" : `<span class="${x.rate < 0.9 ? "red" : ""}">${Math.round(Math.min(1, x.rate) * 100)}%</span>`) },
  ];
  return band("Attendance report", `<a class="btn" href="api.php?action=export&month=${st.month}">${icon("download")}Export CSV</a>`, ["#/attendance/data", "Attendance"]) + `<div class="content">
    <div class="toolbar"><input type="month" id="repMonth" value="${st.month}" aria-label="Month"><span class="muted">Counted up to ${fmt(dates[dates.length - 1] || today())}. Rate = days present out of working days, not counting time off.</span><span class="grow"></span>${searchBox("rep", "Search employee name / ID")}</div>
    ${table("rep", cols, rows, emptyState("No employees yet", "Add employees to see their monthly attendance."))}</div>`;
};

PAGES["time-off/requests"] = () => {
  const st = ui("to", { year: null, status: "" }); st.year = st.year || today().slice(0, 4);
  const years = [...new Set([today().slice(0, 4), ...S.leave.map((l) => l.from.slice(0, 4))])].sort().reverse();
  const rows = S.leave.filter((l) => l.from.slice(0, 4) === st.year && (!st.status || l.status === st.status) && (!st.q || (l.empName + " " + (l.code || "") + " " + reqId(l.id)).toLowerCase().includes(st.q.toLowerCase())));
  const cols = [
    { k: "name", label: "Employee name", sort: (x) => x.empName, cell: (x) => whoCell(emp(x.empId) || { name: x.empName, code: x.code }) },
    { k: "id", label: "Request ID", sort: (x) => Number(x.id), cell: (x) => reqId(x.id) },
    { k: "req", label: "Requested date", sort: (x) => x.requested, cell: (x) => fmt(x.requested) },
    { k: "policy", label: "Policy", sort: (x) => x.type, cell: (x) => LV[x.type].label },
    { k: "date", label: "Time off date", sort: (x) => x.from, cell: (x) => `${fmt(x.from)}${x.to !== x.from ? " – " + fmt(x.to) : ""}<small class="muted" style="display:block">${REQ[x.requestType]} · ${plural(leaveDays(x), "day")}</small>` },
    { k: "status", label: "Status", sort: (x) => x.status, cell: (x) => `<span class="pill ${x.status === "approved" ? "ok" : x.status === "rejected" ? "bad" : "warn"}">${x.status[0].toUpperCase() + x.status.slice(1)}</span>` },
    { k: "act", label: "", cls: "actions", cell: (x) => actionsBtn("to", { id: x.id }) },
  ];
  return band("Time off requests", `<a class="btn primary" href="#/time-off/create">Request time off</a>`) + `<div class="content">
    <div class="toolbar"><select id="toYear" aria-label="Year">${years.map((y) => `<option ${y === st.year ? "selected" : ""}>${y}</option>`).join("")}</select>
      <select id="toStatus" aria-label="Status"><option value="">All status</option><option value="pending" ${st.status === "pending" ? "selected" : ""}>Pending</option><option value="approved" ${st.status === "approved" ? "selected" : ""}>Approved</option><option value="rejected" ${st.status === "rejected" ? "selected" : ""}>Rejected</option></select>
      <span class="grow"></span>${searchBox("to", "Search by employee name / request ID")}</div>
    ${table("to", cols, rows, emptyState("Request time off", "Your requested time off will appear here."))}</div>`;
};

PAGES["time-off/create"] = {
  static: true,
  html: () => {
    const emps = empList(), pre = me()?.id || "";
    return band("Request time off", "", ["#/time-off/requests", "Time off requests"]) + `<div class="content"><form class="form" id="toForm" novalidate>
      <label class="field"><span>Employee name <i>*</i></span><select id="toEmp" required><option value="">Select employee</option>${emps.map((e) => `<option value="${e.id}" ${e.id === pre ? "selected" : ""}>${esc(e.name)}${e.code ? " (" + esc(e.code) + ")" : ""}</option>`).join("")}</select></label>
      <label class="field"><span>Time off policy <i>*</i></span><select id="toPolicy" required ${pre ? "" : "disabled"}><option value="">Select time off policy</option>${Object.entries(LV).map(([k, v]) => `<option value="${k}">${v.label} (${v.code})</option>`).join("")}</select><small id="toBalance"></small></label>
      <div class="row2"><label class="field"><span>Start date <i>*</i></span><input type="date" id="toFrom" required value="${today()}"></label><label class="field"><span>End date <i>*</i></span><input type="date" id="toTo" required value="${today()}"></label></div>
      <label class="field"><span>Request type <i>*</i></span><select id="toType" required><option value="">Select request type</option>${Object.entries(REQ).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label class="field"><span>Reason <i>*</i></span><textarea id="toReason" maxlength="200" required placeholder="Family event in Bandung"></textarea><span class="count" id="toCount">0 / 200</span></label>
      <div class="err" id="toErr" role="alert"></div>
      <div class="formfoot"><a class="btn ghost" href="#/time-off/requests">Cancel</a><button class="btn outline" type="submit" data-again="1">Save &amp; create another</button><button class="btn primary" type="submit">Save</button></div>
    </form></div>`;
  },
  mount: () => toBalance(),
};
function toBalance() {
  const id = $("#toEmp")?.value, el = $("#toBalance");
  if (!el) return;
  $("#toPolicy").disabled = !id;
  if (!id || $("#toPolicy").value !== "annual") { el.textContent = ""; return; }
  const b = balanceOf(id);
  el.textContent = `Annual leave balance: ${b.remaining} of ${S.co.leaveQuota} days left this year${b.pending ? ` (${b.pending} pending)` : ""}.`;
}
function balanceOf(id, year = today().slice(0, 4)) {
  const mine = S.leave.filter((l) => l.empId === String(id) && l.type === "annual" && l.from.slice(0, 4) === year);
  const used = mine.filter((l) => l.status === "approved").reduce((s, l) => s + leaveDays(l), 0);
  const pending = mine.filter((l) => l.status === "pending").reduce((s, l) => s + leaveDays(l), 0);
  return { used, pending, remaining: S.co.leaveQuota - used };
}

PAGES["time-off/balance"] = () => {
  const st = ui("bal");
  const rows = empList().filter((e) => matches(e, st.q)).map((e) => ({ e, b: balanceOf(e.id), sick: S.leave.filter((l) => l.empId === e.id && l.type === "sick" && l.status === "approved" && l.from.slice(0, 4) === today().slice(0, 4)).reduce((s, l) => s + leaveDays(l), 0) }));
  const cols = [
    { k: "name", label: "Employee name", sort: (x) => x.e.name, cell: (x) => whoCell(x.e) },
    { k: "quota", label: "Annual leave quota", cls: "num", cell: () => S.co.leaveQuota },
    { k: "used", label: "Used", sort: (x) => x.b.used, cls: "num", cell: (x) => x.b.used },
    { k: "pending", label: "Pending", sort: (x) => x.b.pending, cls: "num", cell: (x) => x.b.pending },
    { k: "remaining", label: "Remaining", sort: (x) => x.b.remaining, cls: "num", cell: (x) => `<b class="${x.b.remaining <= 0 ? "red" : ""}">${x.b.remaining}</b>` },
    { k: "sick", label: "Sick leave taken", sort: (x) => x.sick, cls: "num", cell: (x) => x.sick },
  ];
  return band(`Balance ${today().slice(0, 4)}`, `<a class="btn primary" href="#/time-off/create">Request time off</a>`, ["#/time-off/requests", "Time off"]) + `<div class="content">
    <div class="toolbar"><span class="muted">Approved working days only. Change the yearly quota in Settings.</span><span class="grow"></span>${searchBox("bal", "Search employee name / ID")}</div>
    ${table("bal", cols, rows, emptyState("No employees yet", "Add employees to track their leave balance."))}</div>`;
};

PAGES["employees/list"] = () => {
  const st = ui("emp"), all = empList(), month = today().slice(0, 7);
  const rows = all.filter((e) => matches(e, st.q));
  const cols = [
    { k: "name", label: "Employee name", sort: (x) => x.name, cell: (x) => `<div class="who"><span class="avatar">${initials(x.name)}</span><b><a href="#/employees/edit/${x.id}">${esc(x.name)}</a></b></div>` },
    { k: "code", label: "Employee ID", sort: (x) => x.code || "", cell: (x) => esc(x.code || "-") },
    { k: "branch", label: "Branch", sort: (x) => x.branch || "", cell: (x) => esc(x.branch || "-") },
    { k: "org", label: "Organization", sort: (x) => x.org || "", cell: (x) => esc(x.org || "-") },
    { k: "pos", label: "Job position", sort: (x) => x.position || "", cell: (x) => esc(x.position || "-") },
    { k: "level", label: "Job level", sort: (x) => x.level || "", cell: (x) => esc(x.level || "-") },
    { k: "status", label: "Employment status", sort: (x) => x.status, cell: (x) => esc(x.status) },
    { k: "join", label: "Join date", sort: (x) => x.joinDate || "", cell: (x) => fmt(x.joinDate) },
    { k: "act", label: "", cls: "actions", cell: (x) => actionsBtn("emp", { id: x.id }) },
  ];
  return band("Employee list", `<a class="btn primary" href="#/employees/create">Add employee</a>`) + `<div class="content">
    <div class="summary"><div class="head">Employee data in ${parse(today()).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</div><div class="cells">
      <div><span>View company</span><b>${esc(S.co.name)}</b></div><div><span>Total employees</span><b>${all.length}</b></div>
      <div><span>New hires</span><b>${all.filter((e) => (e.joinDate || "").startsWith(month)).length}</b></div><div><span>Leaving</span><b>0</b></div></div></div>
    <div class="toolbar"><span class="grow"></span>${searchBox("emp", "Search...")}</div>
    ${table("emp", cols, rows, emptyState("No employees yet", "Add your first employee to start tracking attendance."))}</div>`;
};

const empForm = (e) => ({
  static: true,
  html: () => {
    const x = e ? emp(e) : null;
    if (e && !x) return band("Employee not found", "", ["#/employees/list", "Employee list"]) + `<div class="content">${emptyState("This employee doesn't exist", "They may have been removed.")}</div>`;
    const v = (k) => esc(x ? x[k] || "" : "");
    return band(x ? "Edit employee" : "Add employee", "", ["#/employees/list", "Employee list"]) + `<div class="content"><form class="form" id="empForm" novalidate data-id="${x ? x.id : ""}">
      <label class="field"><span>Full name <i>*</i></span><input type="text" id="eName" maxlength="120" required value="${v("name")}" placeholder="Siti Rahmawati"></label>
      <div class="row2"><label class="field"><span>Employee ID</span><input type="text" id="eCode" maxlength="20" value="${v("code")}" placeholder="Leave empty to create one"></label>
        <label class="field"><span>Join date</span><input type="date" id="eJoin" value="${v("joinDate")}"></label></div>
      <div class="row2"><label class="field"><span>Branch</span><input type="text" id="eBranch" maxlength="80" value="${v("branch")}" placeholder="Pusat"></label>
        <label class="field"><span>Organization</span><input type="text" id="eOrg" maxlength="80" value="${v("org")}" placeholder="Sales"></label></div>
      <div class="row2"><label class="field"><span>Job position</span><input type="text" id="ePos" maxlength="80" value="${v("position")}" placeholder="Sales"></label>
        <label class="field"><span>Job level</span><input type="text" id="eLevel" maxlength="40" value="${v("level")}" placeholder="Staff"></label></div>
      <label class="field"><span>Employment status <i>*</i></span><select id="eStatus">${["Permanent", "Contract", "Probation"].map((s) => `<option ${x && x.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <div class="err" id="eErr" role="alert"></div>
      <div class="formfoot"><a class="btn ghost" href="#/employees/list">Cancel</a>${x ? "" : `<button class="btn outline" type="submit" data-again="1">Save &amp; create another</button>`}<button class="btn primary" type="submit">Save</button></div>
    </form></div>`;
  },
});

PAGES.settings = {
  static: true,
  html: () => band("Settings") + `<div class="content"><form class="form" id="setForm" style="max-width:720px">
    <div class="section"><h2>Company</h2><label class="field"><span>Company name <i>*</i></span><input type="text" id="sName" maxlength="80" value="${esc(S.co.name)}"></label></div>
    <div class="section"><h2>Working schedule</h2><div class="row2"><label class="field"><span>Schedule in</span><input type="time" id="sStart" value="${S.co.workStart}"></label><label class="field"><span>Schedule out</span><input type="time" id="sEnd" value="${S.co.workEnd}"></label></div>
      <label class="field"><span>Late tolerance (minutes)</span><input type="number" id="sGrace" min="0" max="120" value="${S.co.grace}"><small>Clock-ins after schedule in plus this many minutes count as "Late clock in".</small></label>
      <div class="field"><span>Working days</span><div class="days">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label><input type="checkbox" name="sDay" value="${d}" ${S.co.workDays.includes(d) ? "checked" : ""}>${DAYNAMES[d].slice(0, 3)}</label>`).join("")}</div><small>Other days show as "Day off".</small></div></div>
    <div class="section"><h2>Time off</h2><label class="field"><span>Annual leave quota (days per year)</span><input type="number" id="sQuota" min="0" max="60" value="${S.co.leaveQuota}"></label></div>
    <div class="section"><h2>Database</h2><p class="muted" style="margin:0">Connected to MySQL at <b>${esc(S.dbLabel || "…")}</b>. Change it in <code>config.php</code>.</p></div>
    <div class="formfoot" style="max-width:720px"><button class="btn primary" type="submit">Save settings</button></div></form></div>`,
};

/* ---------- router + render ---------- */
let pending = false, lastRoute = null;
function resolve() {
  const h = location.hash.replace(/^#\/?/, "") || "home";
  const m = h.match(/^employees\/edit\/(\d+)$/);
  if (m) return { route: "employees/edit", page: empForm(m[1]) };
  if (h === "employees/create") return { route: h, page: empForm(null) };
  if (h === "employees") return { route: "employees/list", page: PAGES["employees/list"] };
  if (h === "attendance") return { route: "attendance/data", page: PAGES["attendance/data"] };
  if (h === "time-off") return { route: "time-off/requests", page: PAGES["time-off/requests"] };
  return PAGES[h] ? { route: h, page: PAGES[h] } : { route: "home", page: PAGES.home };
}
function busy() {
  if (!$("#modal").hidden) return true;
  const a = document.activeElement;
  return !!(a && a.closest && a.closest("#view") && /INPUT|SELECT|TEXTAREA/.test(a.tagName) && a.type !== "search");
}
function render(force) {
  const { route, page } = resolve(), key = location.hash || "#/home", changed = key !== lastRoute;
  S.route = route;
  renderChrome();
  const view = $("#view");
  const banner = S.mode !== "error" ? "" : S.loadedAt
    ? `<div class="banner">Couldn't refresh from the database, showing data from ${S.loadedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. Retrying every 30 seconds. ${esc(S.error)}</div>`
    : `<div class="banner">Can't reach the attendance database. ${esc(S.error)}</div>`;
  const loading = S.mode === "loading";
  if (typeof page === "object") {
    if (changed || loading || !view.dataset.ready || (force && !busy())) {
      view.innerHTML = banner + (loading ? `<div class="content">${emptyState("Loading…", "")}</div>` : page.html());
      view.dataset.ready = loading ? "" : "1";
      if (!loading && page.mount) page.mount();
    }
    if (page.refresh && !loading) page.refresh();
  } else {
    if (!changed && !force && busy()) { pending = true; return; }
    const searchFocus = document.activeElement?.dataset?.q;
    view.innerHTML = banner + (loading ? `<div class="content">${emptyState("Loading…", "")}</div>` : page());
    view.dataset.ready = "";
    if (searchFocus) { const i = $(`[data-q="${searchFocus}"]`); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }
  if (changed) { lastRoute = key; window.scrollTo(0, 0); document.body.classList.remove("drawer"); $("#scrim").hidden = true; }
}
window.addEventListener("hashchange", () => { closePop(); $("#flyout").hidden = true; render(); });
document.addEventListener("focusout", () => setTimeout(() => { if (pending && !busy()) { pending = false; render(); } }, 0));

/* ---------- actions ---------- */
const ACTS = {
  toggleRail: () => { railWide = !(railWide ?? S.route === "home"); try { localStorage.setItem("wau-rail", railWide ? "1" : "0"); } catch (_) {} renderRail(); },
  pageStep: (b) => { ui(b.dataset.key).page += Number(b.dataset.n); render(true); },
  attCounter: (b) => { const st = ui("att"); st.filter = st.filter === b.dataset.k ? "" : b.dataset.k; st.page = 1; render(true); },
  clearAtt: () => { const st = ui("att"); st.filter = ""; st.q = ""; render(true); },
  markAbsent: () => {
    const d = ui("att").date || today();
    openModal("Mark as absent", `<p style="margin:0">Everyone with no clock-in and no time off on <b>${fmtDay(d)}</b> will be marked <b>Absent</b>.</p>`,
      `<button class="btn" data-close>Cancel</button><button class="btn danger" data-act="markAbsentGo" data-date="${d}">Mark absent</button>`);
  },
  markAbsentGo: async (b) => { closeModal(); await act({ action: "records.absent", date: b.dataset.date }, (r) => (r.count ? `Marked ${plural(r.count, "employee")} as absent.` : "Nobody needed marking.")); },
  rowMenu: (b) => {
    const d = b.dataset, x = d.menu;
    let html = "";
    if (x === "att") html = `<button data-act="editAtt" data-emp="${d.emp}" data-date="${d.date}">Edit</button><button data-act="historyAtt" data-emp="${d.emp}" data-date="${d.date}">View history log</button><button class="danger" data-act="deleteAtt" data-emp="${d.emp}" data-date="${d.date}">Delete</button>`;
    if (x === "to") { const l = S.leave.find((v) => v.id === d.id); html = `<button data-act="viewTo" data-id="${d.id}">View detail</button>` + (l && l.status === "pending" ? `<button data-act="decide" data-id="${d.id}" data-status="approved">Approve</button><button class="danger" data-act="decide" data-id="${d.id}" data-status="rejected">Reject</button>` : ""); }
    if (x === "emp") html = `<a href="#/employees/edit/${d.id}">Edit</a><a href="#/attendance/report">View attendance</a><button class="danger" data-act="deleteEmp" data-id="${d.id}">Delete</button>`;
    openPop(b, html);
  },
  editAtt: (b) => {
    closePop();
    const e = emp(b.dataset.emp), d = b.dataset.date, r = rec(d, e.id) || {};
    const manual = ["absent", "sick", "leave"].includes(r.status) ? r.status : "";
    openModal("Edit attendance", `<div class="who"><span class="avatar">${initials(e.name)}</span><div><b style="color:var(--ink)">${esc(e.name)}</b><small>${fmtDay(d)} · ${isWorkday(d) ? `Office hour ${S.co.workStart} - ${S.co.workEnd}` : "No working hours"}</small></div></div>
      <div class="row2"><label class="field"><span>Clock in</span><input type="time" id="mIn" value="${r.in || ""}"></label><label class="field"><span>Clock out</span><input type="time" id="mOut" value="${r.out || ""}"></label></div>
      <label class="field"><span>Attendance status</span><select id="mStatus"><option value="">From clock in (on time or late)</option><option value="absent" ${manual === "absent" ? "selected" : ""}>Absent</option><option value="sick" ${manual === "sick" ? "selected" : ""}>Sick</option><option value="leave" ${manual === "leave" ? "selected" : ""}>On leave</option></select></label>`,
      `<button class="btn" data-close>Cancel</button><button class="btn primary" data-act="saveAtt" data-emp="${e.id}" data-date="${d}">Save</button>`);
  },
  saveAtt: async (b) => {
    const inV = $("#mIn").value, outV = $("#mOut").value, s = $("#mStatus").value;
    if (inV && outV && outV < inV) return toast("Clock out is before clock in.", true);
    closeModal();
    await act({ action: "record.set", empId: Number(b.dataset.emp), date: b.dataset.date, in: inV || null, out: outV || null, status: s || (inV ? "present" : null) }, "Attendance updated.");
  },
  historyAtt: async (b) => {
    closePop();
    const e = emp(b.dataset.emp);
    openModal("History log", emptyState("Loading…", ""), `<button class="btn" data-close>Close</button>`);
    try {
      const { events } = await api(null, { action: "history", empId: b.dataset.emp, date: b.dataset.date });
      $("#modalBody").innerHTML = `<div class="muted">${esc(e.name)} · ${fmtDay(b.dataset.date)}</div>` + (events.length ? `<div class="list">${events.map((ev) => `<div class="logitem"><span class="t">${esc(ev.time)}</span><div style="flex:1"><b>${KIND[ev.kind]}</b> <span class="muted">· ${ev.source === "live" ? "Live attendance" : "Changed by admin"}</span>${ev.detail ? `<div class="muted" style="font-size:12px">${esc(ev.detail)}</div>` : ""}${ev.lat ? `<div style="font-size:12px">${mapLink(ev)}</div>` : ""}</div></div>`).join("")}</div>` : emptyState("No history yet", "Clock-ins and edits for this day will appear here."));
    } catch (err) { $("#modalBody").innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  },
  deleteAtt: (b) => {
    closePop();
    const e = emp(b.dataset.emp);
    openModal("Delete attendance", `<p style="margin:0">Delete the attendance record for <b>${esc(e.name)}</b> on <b>${fmtDay(b.dataset.date)}</b>? Clock in, clock out and status are cleared. The history log keeps a note of the deletion.</p>`,
      `<button class="btn" data-close>Cancel</button><button class="btn danger" data-act="deleteAttGo" data-emp="${e.id}" data-date="${b.dataset.date}">Delete</button>`);
  },
  deleteAttGo: async (b) => { closeModal(); await act({ action: "record.delete", empId: Number(b.dataset.emp), date: b.dataset.date }, "Attendance deleted."); },
  viewTo: (b) => {
    closePop();
    const l = S.leave.find((v) => v.id === b.dataset.id);
    openModal(reqId(l.id), `<div class="kv" style="gap:10px">${[["Employee", esc(l.empName)], ["Policy", LV[l.type].label], ["Request type", REQ[l.requestType]], ["Time off date", `${fmt(l.from)}${l.to !== l.from ? " – " + fmt(l.to) : ""} (${plural(leaveDays(l), "day")})`], ["Requested", fmt(l.requested)], ["Status", l.status[0].toUpperCase() + l.status.slice(1)], ["Reason", esc(l.reason || "-")]].map(([k, v]) => `<div style="grid-template-columns:130px 1fr"><span class="muted">${k}</span><span style="white-space:normal">${v}</span></div>`).join("")}</div>`,
      l.status === "pending" ? `<button class="btn" data-act="decide" data-id="${l.id}" data-status="rejected">Reject</button><button class="btn primary" data-act="decide" data-id="${l.id}" data-status="approved">Approve</button>` : `<button class="btn" data-close>Close</button>`);
  },
  decide: async (b) => { closePop(); closeModal(); await act({ action: "leave.set", id: Number(b.dataset.id), status: b.dataset.status }, b.dataset.status === "approved" ? "Request approved." : "Request rejected."); },
  deleteEmp: (b) => {
    closePop();
    const e = emp(b.dataset.id);
    openModal("Delete employee", `<p style="margin:0">Remove <b>${esc(e.name)}</b> from the employee list? Their past attendance and time off stay in reports and exports.</p>`,
      `<button class="btn" data-close>Cancel</button><button class="btn danger" data-act="deleteEmpGo" data-id="${e.id}">Delete</button>`);
  },
  deleteEmpGo: async (b) => { closeModal(); if (S.meId === b.dataset.id) setMe(null); await act({ action: "employee.remove", id: Number(b.dataset.id) }, "Employee removed."); },
  clock: async (b) => {
    const m = me(); if (!m) return;
    b.disabled = true;
    const g = S.geo.state === "ok" ? { lat: S.geo.lat, lng: S.geo.lng } : {};
    const r = await act({ action: "clock", kind: b.dataset.kind, empId: Number(m.id), note: $("#liveNote").value.trim(), ...g },
      (x) => (b.dataset.kind === "in" ? `Clocked in at ${x.time}${x.status === "late" ? " (late)" : ""}.` : `Clocked out at ${x.time}.`));
    if (r) $("#liveNote").value = "";
    refreshMyLog();
  },
  pickMe: () => { const v = $("#popMe").value; setMe(v || null); closePop(); render(true); if (S.route === "live-attendance") refreshMyLog(); },
};

document.addEventListener("click", (ev) => {
  const t = ev.target;
  if (t.closest("[data-close]") || t === $("#modal")) { closeModal(); return; }
  if (!t.closest("#menuPop") && !t.closest("[data-act='rowMenu']") && !t.closest("#plusBtn, #bellBtn, #userBtn")) closePop();
  if (!t.closest(".searchwrap")) $("#searchPop").hidden = true;
  const fly = t.closest("[data-fly]");
  if (fly) {
    if (innerWidth <= 860) { location.hash = MENU.find((m) => m.key === fly.dataset.fly).items[0][0]; return; }
    const f = $("#flyout"); if (!f.hidden && f.dataset.for === fly.dataset.fly) f.hidden = true; else { showFly(fly); f.dataset.for = fly.dataset.fly; }
    return;
  }
  if (!t.closest("#flyout")) $("#flyout").hidden = true;
  const th = t.closest("th[data-sort]");
  if (th) { const [k, c] = th.dataset.sort.split(":"), st = ui(k); st.dir = st.sort === c && st.dir === "asc" ? "desc" : "asc"; st.sort = c; render(true); return; }
  const b = t.closest("[data-act]");
  if (b && !b.disabled && ACTS[b.dataset.act]) { ev.preventDefault(); ACTS[b.dataset.act](b, ev); }
});
document.addEventListener("mouseover", (ev) => {
  if (innerWidth <= 860) return;
  const fly = ev.target.closest("[data-fly]");
  if (fly) { clearTimeout(flyT); showFly(fly); $("#flyout").dataset.for = fly.dataset.fly; }
  else if (ev.target.closest("#flyout")) clearTimeout(flyT);
  else if (!$("#flyout").hidden) hideFlySoon();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") { closePop(); closeModal(); $("#flyout").hidden = true; $("#searchPop").hidden = true; }
  if (ev.key === "Enter" && ev.target.dataset && ev.target.dataset.page) ev.target.blur();
});
let qT;
document.addEventListener("input", (ev) => {
  const el = ev.target;
  if (el.dataset.q) { clearTimeout(qT); qT = setTimeout(() => { const st = ui(el.dataset.q); st.q = el.value; st.page = 1; render(true); }, 200); }
  if (el.id === "toReason") $("#toCount").textContent = `${el.value.length} / 200`;
  if (el.id === "searchInput") renderSearch(el.value);
});
document.addEventListener("change", (ev) => {
  const el = ev.target, id = el.id;
  if (el.dataset.size) { const st = ui(el.dataset.size); st.size = Number(el.value); st.page = 1; el.blur(); render(true); return; }
  if (el.dataset.page) { ui(el.dataset.page).page = Number(el.value) || 1; el.blur(); render(true); return; }
  const set = (k, f, v) => { ui(k)[f] = v; ui(k).page = 1; el.blur(); render(true); };
  if (id === "attDate" && el.value) return set("att", "date", el.value);
  if (id === "attFilter") return set("att", "filter", el.value);
  if (id === "actDate" && el.value) return set("act", "date", el.value);
  if (id === "actType") return set("act", "type", el.value);
  if (id === "repMonth" && el.value) return set("rep", "month", el.value);
  if (id === "toYear") return set("to", "year", el.value);
  if (id === "toStatus") return set("to", "status", el.value);
  if (id === "toEmp" || id === "toPolicy") return toBalance();
  if (id === "toFrom" && $("#toTo").value < el.value) $("#toTo").value = el.value;
  if (id === "liveMe") { setMe(el.value || null); renderChrome(); refreshMyLog(); PAGES["live-attendance"].refresh(); }
});
document.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target, again = ev.submitter && ev.submitter.dataset.again;
  if (f.id === "toForm") {
    const body = { action: "leave.add", empId: Number($("#toEmp").value), type: $("#toPolicy").value, from: $("#toFrom").value, to: $("#toTo").value, requestType: $("#toType").value, reason: $("#toReason").value.trim() };
    const miss = [!body.empId && "employee", !body.type && "time off policy", !body.from && "start date", !body.to && "end date", !body.requestType && "request type", !body.reason && "reason"].filter(Boolean);
    if (miss.length) return ($("#toErr").textContent = "Fill in the " + miss.join(", ") + ".");
    if (body.to < body.from) return ($("#toErr").textContent = "The end date is before the start date.");
    $("#toErr").textContent = "";
    document.activeElement.blur();
    const r = await act(body, "Time off request submitted.");
    if (!r) return;
    if (again) render(true); else location.hash = "#/time-off/requests";
  }
  if (f.id === "empForm") {
    const id = f.dataset.id;
    const body = { action: id ? "employee.update" : "employee.add", id: id ? Number(id) : undefined, name: $("#eName").value.trim(), code: $("#eCode").value.trim(), joinDate: $("#eJoin").value, branch: $("#eBranch").value.trim(), org: $("#eOrg").value.trim(), position: $("#ePos").value.trim(), level: $("#eLevel").value.trim(), status: $("#eStatus").value };
    if (!body.name) return ($("#eErr").textContent = "Fill in the full name.");
    $("#eErr").textContent = "";
    document.activeElement.blur();
    const r = await act(body, (x) => `${body.name} saved as ${x.code}.`);
    if (!r) return;
    if (again) { render(true); $("#eName").focus(); } else location.hash = "#/employees/list";
  }
  if (f.id === "setForm") {
    const days = $$('input[name="sDay"]:checked').map((c) => Number(c.value));
    if (!days.length) return toast("Choose at least one working day.", true);
    document.activeElement.blur();
    await act({ action: "company.save", name: $("#sName").value.trim() || S.co.name, workStart: $("#sStart").value, workEnd: $("#sEnd").value, grace: Number($("#sGrace").value) || 0, workDays: days, leaveQuota: Number($("#sQuota").value) || 0 }, "Settings saved.");
    render(true);
  }
});

/* ---------- top bar ---------- */
$("#plusBtn").addEventListener("click", (ev) => openPop(ev.currentTarget, `<div class="label">Create</div><a href="#/live-attendance">Clock in / out</a><a href="#/time-off/create">Request time off</a><a href="#/employees/create">Add employee</a>`));
$("#bellBtn").addEventListener("click", (ev) => {
  const pend = S.leave.filter((l) => l.status === "pending");
  openPop(ev.currentTarget, `<div class="label">Notifications</div>` + (pend.length ? pend.slice(0, 8).map((l) => `<button data-act="viewTo" data-id="${l.id}"><b>${esc(l.empName)}</b> requested ${LV[l.type].label.toLowerCase()}<br><small class="muted">${fmt(l.from)}${l.to !== l.from ? " – " + fmt(l.to) : ""}</small></button>`).join("") + `<a href="#/time-off/requests">See all requests</a>` : `<div class="pad muted">You're all caught up.</div>`));
});
$("#userBtn").addEventListener("click", (ev) => {
  const emps = empList();
  openPop(ev.currentTarget, `<div class="label">This device</div><div class="pad"><span class="muted" style="font-size:12px">Who uses this computer for Live attendance?</span><select id="popMe"><option value="">Nobody chosen</option>${emps.map((e) => `<option value="${e.id}" ${S.meId === e.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select><button class="btn primary small" data-act="pickMe">Save</button></div><a href="#/settings">Company settings</a>`);
});
$("#searchBtn").addEventListener("click", () => { const p = $("#searchPop"); p.hidden = !p.hidden; if (!p.hidden) { $("#searchInput").value = ""; renderSearch(""); $("#searchInput").focus(); } });
function renderSearch(q) {
  const res = empList().filter((e) => matches(e, q)).slice(0, 8);
  $("#searchResults").innerHTML = res.length ? res.map((e) => `<a class="result" href="#/employees/edit/${e.id}"><span class="avatar" style="width:28px;height:28px;font-size:11px;background:var(--line);color:var(--muted)">${initials(e.name)}</span><span><b style="color:var(--ink);font-weight:500">${esc(e.name)}</b><br><small class="muted">${esc(sub(e))}</small></span></a>`).join("") : `<div class="muted" style="padding:8px">No employee matches "${esc(q)}"</div>`;
}
$("#searchResults").addEventListener("click", (ev) => { if (ev.target.closest("a")) $("#searchPop").hidden = true; });
$("#drawerBtn").addEventListener("click", () => { const open = !document.body.classList.contains("drawer"); document.body.classList.toggle("drawer", open); $("#scrim").hidden = !open; });
$("#scrim").addEventListener("click", () => { document.body.classList.remove("drawer"); $("#scrim").hidden = true; });

/* ---------- start ---------- */
try { S.meId = localStorage.getItem("wau-me"); } catch (_) {}
render(true);
load();
setInterval(() => { if (!document.hidden) load(); }, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
