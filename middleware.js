// Vercel Routing Middleware: cijela stranica (i API) iza lozinke.
// Lozinka se postavlja u Vercelu kao environment varijabla SITE_PASSWORD.
// Nakon prijave preglednik dobije kolačić koji vrijedi godinu dana.
// Promjena lozinke odjavljuje sve uređaje.

export const config = {
    matcher: '/:path*'
};

const COOKIE_NAME = 'horvati_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

async function tokenFor(password) {
    const bytes = new TextEncoder().encode('horvati-vocnjak:' + password);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(request, name) {
    const header = request.headers.get('cookie') || '';
    const parts = header.split(';');
    for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
    }
    return null;
}

function safeNext(value) {
    const next = String(value || '/');
    if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/__login')) return '/';
    return next;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loginPage(next, showError) {
    const html = `<!DOCTYPE html>
<html lang="hr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Prijava - Inventar Stabala</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #eef3ea; color: #1f2a1c; }
  form { background: #fff; padding: 28px 24px; border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.12);
         width: min(340px, calc(100vw - 32px)); box-sizing: border-box; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  label { display: block; font-size: 14px; margin-bottom: 6px; }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 16px; border: 1px solid #b9c6b2; border-radius: 8px; }
  button { margin-top: 14px; width: 100%; padding: 10px 12px; font-size: 16px; border: 0; border-radius: 8px;
           background: #3f7a32; color: #fff; cursor: pointer; }
  .error { color: #b3261e; font-size: 14px; margin: 10px 0 0; }
  @media (prefers-color-scheme: dark) {
    body { background: #151b13; color: #e4ecdf; }
    form { background: #222b1f; box-shadow: none; }
    input { background: #151b13; color: #e4ecdf; border-color: #46553f; }
  }
</style>
</head>
<body>
<form method="POST" action="/__login">
  <h1>Horvati voćnjak</h1>
  <label for="password">Lozinka</label>
  <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <button type="submit">Prijava</button>
  ${showError ? '<p class="error">Pogrešna lozinka.</p>' : ''}
</form>
</body>
</html>`;
    return new Response(html, {
        status: 401,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    });
}

export default async function middleware(request) {
    const password = process.env.SITE_PASSWORD;
    if (!password) {
        return new Response('SITE_PASSWORD nije postavljen u Vercel postavkama.', { status: 500 });
    }

    const url = new URL(request.url);
    const expected = await tokenFor(password);

    if (url.pathname === '/__login' && request.method === 'POST') {
        const form = await request.formData();
        const given = String(form.get('password') || '');
        const next = safeNext(form.get('next'));
        if (given !== password) return loginPage(next, true);

        return new Response(null, {
            status: 303,
            headers: {
                Location: next,
                'Set-Cookie': `${COOKIE_NAME}=${expected}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
                'Cache-Control': 'no-store'
            }
        });
    }

    if (url.pathname === '/__logout') {
        return new Response(null, {
            status: 303,
            headers: {
                Location: '/',
                'Set-Cookie': `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
            }
        });
    }

    if (readCookie(request, COOKIE_NAME) === expected) {
        return; // prijavljen - nastavi normalno
    }

    if (url.pathname.startsWith('/api/')) {
        return new Response(JSON.stringify({ error: 'Nisi prijavljen' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
        });
    }

    return loginPage(url.pathname + url.search, false);
}
