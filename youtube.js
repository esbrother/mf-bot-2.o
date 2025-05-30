// youtube.js - Módulo para manejar YouTube usando tu API personalizada

var ee = Object.defineProperty;
var Bt = Object.getOwnPropertyDescriptor;
var Yt = Object.getOwnPropertyNames;
var Wt = Object.prototype.hasOwnProperty;
var a = (i, e) => ee(i, "name", { value: e, configurable: !0 });
var Jt = (i, e) => {
  for (var t in e) ee(i, t, { get: e[t], enumerable: !0 });
},
Vt = (i, e, t, r) => {
  if (e && typeof e == "object" || typeof e == "function")
    for (let s of Yt(e))
      !Wt.call(i, s) && s !== t && ee(i, s, { get: () => e[s], enumerable: !(r = Bt(e, s)) || r.enumerable });
  return i;
};
var Ft = i => Vt(ee({}, "__esModule", { value: !0 }), i);

// Configuración para usar tu API de YouTube
const YOUTUBE_API_URL = process.env.YOUTUBE_API_URL || 'https://tu-api-de-youtube.com';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'tu-api-key';

var He = require("https"),
    Qe = require("url"),
    F = require("zlib");
var V = require("fs"),
    k;

// Verificar y cargar datos de YouTube si existen
(0, V.existsSync)(".data/youtube.data") && (k = JSON.parse((0, V.readFileSync)(".data/youtube.data", "utf-8")), k.file = !0);

// Función para obtener cookies
function Ve() {
  let i = "";
  if (!!k?.cookie) {
    for (let [e, t] of Object.entries(k.cookie)) i += `${e}=${t};`;
    return i;
  }
}
a(Ve, "getCookies");

// Función para establecer cookies
function jt(i, e) {
  return k?.cookie ? (i = i.trim(), e = e.trim(), Object.assign(k.cookie, { [i]: e }), !0 : !1;
}
a(jt, "setCookie");

// Función para guardar cookies
function Kt() {
  k.cookie && k.file && (0, V.writeFileSync)(".data/youtube.data", JSON.stringify(k, void 0, 4));
}
a(Kt, "uploadCookie");

// Función para establecer token de cookies
function Fe(i) {
  let e = i.cookie,
      t = {};
  e.split(";").forEach(r => {
    let s = r.split("=");
    if (s.length <= 1) return;
    let n = s.shift()?.trim(),
        o = s.join("=").trim();
    Object.assign(t, { [n]: o });
  }), k = { cookie: t }, k.file = !1;
}
a(Fe, "setCookieToken");

// Función para manejar headers de cookies
function je(i) {
  !k?.cookie || (i.forEach(e => {
    e.split(";").forEach(t => {
      let r = t.split("=");
      if (r.length <= 1) return;
      let s = r.shift()?.trim(),
          n = r.join("=").trim();
      jt(s, n);
    });
  }), Kt());
}
a(je, "cookieHeaders");

// User-Agents para las peticiones
var te = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.64 Safari/537.36",
  // ... (otros user agents)
];

function Ke(i) {
  te.push(...i);
}
a(Ke, "setUserAgent");

function Ht(i, e) {
  return i = Math.ceil(i), e = Math.floor(e), Math.floor(Math.random() * (e - i + 1)) + i;
}
a(Ht, "getRandomInt");

function Ge() {
  let i = Ht(0, te.length - 1);
  return te[i];
}
a(Ge, "getRandomUserAgent");

// Funciones para hacer peticiones HTTP
async function _(i, e = { method: "GET" }) {
  return new Promise(async (t, r) => {
    let s = await re(i, e).catch(n => n);
    if (s instanceof Error) {
      r(s);
      return;
    }
    Number(s.statusCode) >= 300 && Number(s.statusCode) < 400 && (s = await _(s.headers.location, e)), t(s);
  });
}
a(_, "request_stream");

async function Ze(i, e = { method: "GET" }) {
  return new Promise(async (t, r) => {
    let s = await re(i, e).catch(n => n);
    if (s instanceof Error) {
      r(s);
      return;
    }
    if (Number(s.statusCode) >= 300 && Number(s.statusCode) < 400) s = await Ze(s.headers.location, e);
    else if (Number(s.statusCode) > 400) {
      r(new Error(`Got ${s.statusCode} from the request`));
      return;
    }
    t(s);
  });
}
a(Ze, "internalRequest");

async function h(i, e = { method: "GET" }) {
  return new Promise(async (t, r) => {
    let s = !1;
    if (e.cookies) {
      let u = Ve();
      typeof u == "string" && e.headers && (Object.assign(e.headers, { cookie: u }), s = !0;
    }
    if (e.cookieJar) {
      let u = [];
      for (let m of Object.entries(e.cookieJar)) u.push(m.join("="));
      if (u.length !== 0) {
        e.headers || (e.headers = {});
        let m = s ? `; ${e.headers.cookie}` : "";
        Object.assign(e.headers, { cookie: `${u.join("; ")}${m}` });
      }
    }
    e.headers && (e.headers = { ...e.headers,
      "accept-encoding": "gzip, deflate, br",
      "user-agent": Ge()
    });
    let n = await Ze(i, e).catch(u => u);
    if (n instanceof Error) {
      r(n);
      return;
    }
    if (n.headers && n.headers["set-cookie"]) {
      if (e.cookieJar) for (let u of n.headers["set-cookie"]) {
        let m = u.split(";")[0].trim().split("=");
        e.cookieJar[m.shift()] = m.join("=");
      }
      s && je(n.headers["set-cookie"]);
    }
    let o = [],
        l,
        c = n.headers["content-encoding"];
    c === "gzip" ? l = (0, F.createGunzip)() : c === "br" ? l = (0, F.createBrotliDecompress)() : c === "deflate" && (l = (0, F.createDeflate)()), l ? (n.pipe(l), l.setEncoding("utf-8"), l.on("data", u => o.push(u)), l.on("end", () => t(o.join("")))) : (n.setEncoding("utf-8"), n.on("data", u => o.push(u)), n.on("end", () => t(o.join(""))));
  });
}
a(h, "request");

async function ie(i) {
  return new Promise(async (e, t) => {
    let r = await re(i, { method: "HEAD" }).catch(n => n);
    if (r instanceof Error) {
      t(r);
      return;
    }
    let s = Number(r.statusCode);
    if (s < 300) e(i);
    else if (s < 400) {
      let n = await ie(r.headers.location).catch(o => o);
      if (n instanceof Error) {
        t(n);
        return;
      }
      e(n);
    } else t(new Error(`${r.statusCode}: ${r.statusMessage}, ${i}`));
  });
}
a(ie, "request_resolve_redirect");

async function Te(i) {
  return new Promise(async (e, t) => {
    let r = await re(i, { method: "HEAD" }).catch(n => n);
    if (r instanceof Error) {
      t(r);
      return;
    }
    let s = Number(r.statusCode);
    if (s < 300) e(Number(r.headers["content-length"]));
    else if (s < 400) {
      let n = await ie(r.headers.location).catch(l => l);
      if (n instanceof Error) {
        t(n);
        return;
      }
      let o = await Te(n).catch(l => l);
      if (o instanceof Error) {
        t(o);
        return;
      }
      e(o);
    } else t(new Error(`Failed to get content length with error: ${r.statusCode}, ${r.statusMessage}, ${i}`));
  });
}
a(Te, "request_content_length");

function re(i, e = {}) {
  return new Promise((t, r) => {
    let s = new Qe.URL(i);
    e.method ??= "GET";
    let n = {
        host: s.hostname,
        path: s.pathname + s.search,
        headers: e.headers ?? {},
        method: e.method
      },
      o = (0, He.request)(n, t);
    o.on("error", l => {
      r(l);
    }), e.method === "POST" && o.write(e.body), o.end();
  });
}
a(re, "https_getter");

// Nueva función para usar tu API de YouTube
async function searchYouTube(query, options = {}) {
  try {
    const url = `${YOUTUBE_API_URL}/search?q=${encodeURIComponent(query)}&key=${YOUTUBE_API_KEY}`;
    const response = await h(url, {
      headers: {
        'Accept': 'application/json'
      }
    });
    
    const data = JSON.parse(response);
    
    // Procesar resultados
    return data.items.map(item => {
      return {
        type: 'youtube',
        id: item.id.videoId,
        title: item.snippet.title,
        url: `https://youtube.com/watch?v=${item.id.videoId}`,
        thumbnail: item.snippet.thumbnails.default.url,
        duration: item.duration || 'N/A',
        platform: 'YouTube',
        icon: '▶️' // Emoji para YouTube
      };
    });
  } catch (error) {
    console.error('Error searching YouTube:', error);
    return [];
  }
}

// Modificar la función de búsqueda para usar múltiples plataformas
async function $t(query, options = {}) {
  // Solo buscamos en YouTube ya que es la única plataforma disponible
  const results = await searchYouTube(query, options);
  
  return {
    youtube: results,
    // Dejamos estos arrays vacíos ya que no tenemos otras plataformas
    spotify: [],
    soundcloud: [],
    deezer: []
  };
}

// Funciones de validación
var oe = /^[a-zA-Z\d_-]{11,12}$/,
    hi = /^(PL|UU|LL|RD|OL)[a-zA-Z\d_-]{10,}$/,
    at = /^((?:https?:)?\/\/)?(?:(?:www|m|music)\.)?((?:youtube\.com|youtu.be))(\/(?:[\w\-]+\?v=|shorts\/|embed\/|live\/|v\/)?)([\w\-]+)(\S+)?$/,
    di = /^((?:https?:)?\/\/)?(?:(?:www|m|music)\.)?((?:youtube\.com|youtu.be))\/(?:(playlist|watch))?(.*)?((\?|\&)list=)(PL|UU|LL|RD|OL)[a-zA-Z\d_-]{10,}(&.*)?$/;

function Y(i) {
  let e = i.trim();
  if (e.startsWith("https")) {
    if (e.match(at)) {
      let t;
      if (e.includes("youtu.be/")) t = e.split("youtu.be/")[1].split(/(\?|\/|&)/)[0];
      else if (e.includes("youtube.com/embed/")) t = e.split("youtube.com/embed/")[1].split(/(\?|\/|&)/)[0];
      else if (e.includes("youtube.com/shorts/")) t = e.split("youtube.com/shorts/")[1].split(/(\?|\/|&)/)[0];
      else t = e.split("watch?v=")[1]?.split(/(\?|\/|&)/)[0];
      
      return t?.match(oe) ? "video" : !1;
    }
    return !1;
  }
  return e.match(oe) ? "video" : e.match(hi) ? "playlist" : "search";
}
a(Y, "yt_validate");

function De(i) {
  if (i.startsWith("https://") && i.match(at)) {
    let e;
    if (i.includes("youtu.be/")) e = i.split("youtu.be/")[1].split(/(\?|\/|&)/)[0];
    else if (i.includes("youtube.com/embed/")) e = i.split("youtube.com/embed/")[1].split(/(\?|\/|&)/)[0];
    else if (i.includes("youtube.com/shorts/")) e = i.split("youtube.com/shorts/")[1].split(/(\?|\/|&)/)[0];
    else if (i.includes("youtube.com/live/")) e = i.split("youtube.com/live/")[1].split(/(\?|\/|&)/)[0];
    else e = (i.split("watch?v=")[1] ?? i.split("&v=")[1]).split(/(\?|\/|&)/)[0];
    
    if (e.match(oe)) return e;
  } else if (i.match(oe)) return i;
  return !1;
}
a(De, "extractVideoId");

function ue(i) {
  let e = Y(i);
  if (!e || e === "search") throw new Error("This is not a YouTube url or videoId or PlaylistID");
  let t = i.trim();
  if (t.startsWith("https")) {
    if (t.indexOf("list=") === -1) {
      let r = De(t);
      if (!r) throw new Error("This is not a YouTube url or videoId or PlaylistID");
      return r;
    } else return t.split("list=")[1].split("&")[0];
  } else return t;
}
a(ue, "extractID");

// [Resto de las clases y funciones de YouTube se mantienen igual...]

// Exportar las funciones necesarias
var Ei = {};
Jt(Ei, {
  YouTubeVideo: () => S,
  YouTubePlayList: () => D,
  YouTubeChannel: () => v,
  video_basic_info: () => H,
  yt_validate: () => Y,
  extractID: () => ue,
  search: () => $t
});

module.exports = Ft(Ei);