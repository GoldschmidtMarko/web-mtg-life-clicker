// Admin usage dashboard. Requires Google sign-in; the backend callable
// (getUsageStats) enforces the admin allow-list, so a non-admin just gets a
// permission-denied which we render as "access denied". Client gating here is
// only UX — the real gate is server-side. Uses the compat Firebase SDK (the
// same one index.html loads).
import { firebaseConfig } from './util/firebaseConfig.js';

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const functions = firebase.app().functions('europe-west3');
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    functions.useEmulator('localhost', 5001);
    auth.useEmulator('http://localhost:9099');
}
const getUsageStats = functions.httpsCallable('getUsageStats');

const gateSignin = document.getElementById('gate-signin');
const gateDenied = document.getElementById('gate-denied');
const gateLoading = document.getElementById('gate-loading');
const gateError = document.getElementById('gate-error');
const dashboard = document.getElementById('dashboard');

function show(el) {
    [gateSignin, gateDenied, gateLoading, gateError, dashboard].forEach((n) => {
        if (n) n.classList.toggle('hidden', n !== el);
    });
}

// Summary counters we surface, in display order. Each has *_total / *_authed /
// *_anon keys on usage/summary.
const SUMMARY_METRICS = [
    { key: 'logins', label: 'Logins' },
    { key: 'lobbiesCreated', label: 'Lobbies created' },
    { key: 'lobbiesJoined', label: 'Lobbies joined' },
    { key: 'gamesStarted', label: 'Games started' },
    { key: 'feedback', label: 'Feedback submitted' },
];

function num(n) { return (n == null ? 0 : n).toLocaleString(); }

function fmtDate(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
        ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function renderSummary(summary) {
    document.getElementById('summary-cards').innerHTML = SUMMARY_METRICS.map((m) => {
        const total = summary[`${m.key}_total`] || 0;
        const authed = summary[`${m.key}_authed`] || 0;
        const anon = summary[`${m.key}_anon`] || 0;
        return `
            <div class="stat">
                <div class="stat__label">${escapeHtml(m.label)}</div>
                <div class="stat__value">${num(total)}</div>
                <div class="stat__split">
                    <span title="Signed-in">👤 ${num(authed)}</span>
                    <span title="Anonymous">🕶 ${num(anon)}</span>
                </div>
            </div>`;
    }).join('');
}

function renderUsers(users) {
    document.getElementById('users-total').textContent = num(users.total);
    const el = document.getElementById('users-table');
    if (!users.top || !users.top.length) {
        el.innerHTML = '<div class="usage-empty">No users yet.</div>';
        return;
    }
    const body = users.top.map((u, i) => `
        <tr>
            <td class="rank">${i + 1}</td>
            <td class="name">${escapeHtml(u.name || '—')}<span class="sub">${escapeHtml(u.email)}</span></td>
            <td class="n">${num(u.loginCount)}</td>
            <td class="when">${fmtDate(u.lastLogin)}</td>
            <td class="when">${fmtDate(u.registrationDate)}</td>
        </tr>`).join('');
    el.innerHTML = `
        <table class="usage-table">
            <thead><tr>
                <th>#</th><th>User</th><th class="n">Logins</th><th>Last login</th><th>Registered</th>
            </tr></thead>
            <tbody>${body}</tbody>
        </table>`;
}

function renderLobbyEvents(items) {
    const el = document.getElementById('lobby-events-table');
    if (!items || !items.length) {
        el.innerHTML = '<div class="usage-empty">No lobby activity yet.</div>';
        return;
    }
    const body = items.map((e) => `
        <tr>
            <td class="name">${e.type === 'created' ? '➕ Created' : '🚪 Joined'}</td>
            <td class="name">${escapeHtml(e.lobbyId || '—')}</td>
            <td class="name">${escapeHtml(e.playerName || '—')}</td>
            <td>${e.authed ? '👤 Signed-in' : '🕶 Anonymous'}</td>
            <td class="when">${fmtDate(e.createdAt)}</td>
        </tr>`).join('');
    el.innerHTML = `
        <table class="usage-table">
            <thead><tr>
                <th>Action</th><th>Lobby</th><th>Player</th><th>Account</th><th>Timestamp</th>
            </tr></thead>
            <tbody>${body}</tbody>
        </table>`;
}

function renderFeedback(items) {
    const el = document.getElementById('feedback-list');
    if (!items || !items.length) {
        el.innerHTML = '<div class="usage-empty">No feedback yet.</div>';
        return;
    }
    el.innerHTML = items.map((f) => `
        <div class="fb">
            <div class="fb__msg">${escapeHtml(f.message)}</div>
            <div class="fb__meta">${escapeHtml(f.userName || 'Anonymous')} · ${fmtDate(f.createdAt)}</div>
        </div>`).join('');
}

// --- Usage-over-time bar chart (SVG) ---------------------------------------
const TL_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function tlFmt(key) { const p = key.split('-'); return TL_MON[(+p[1]) - 1] + ' ' + (+p[2]); }
function tlNiceCeil(v) {
    if (v <= 5) return 5;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p, step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * p;
}

function renderTimeline(daily) {
    const el = document.getElementById('usage-timeline');
    const DAYS = 30;
    const byDate = new Map((daily || []).map(d => [d.date, d]));
    const now = new Date();
    const days = [];
    for (let i = DAYS - 1; i >= 0; i--) {
        const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
        const key = dt.toISOString().slice(0, 10);
        const r = byDate.get(key);
        days.push({ key, count: r ? (r.count || 0) : 0, authed: r ? (r.count_authed || 0) : 0, anon: r ? (r.count_anon || 0) : 0 });
    }
    if (days.reduce((s, d) => s + d.count, 0) === 0) {
        el.innerHTML = '<div class="tl-empty">No usage recorded yet — the timeline fills as the site is used.</div>';
        return;
    }
    const maxV = tlNiceCeil(Math.max(1, ...days.map(d => d.count)));

    const W = 900, H = 210, padL = 30, padR = 10, padT = 10, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const slot = plotW / DAYS, barW = Math.max(3, slot * 0.68);
    const x0 = i => padL + i * slot + (slot - barW) / 2;
    const y = v => padT + plotH - (v / maxV) * plotH;
    const baseline = padT + plotH;

    let grid = '', ticks = '';
    [0, 0.5, 1].forEach(f => {
        const gy = baseline - f * plotH;
        grid += `<line class="tl-grid" x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}"/>`;
        ticks += `<text class="tl-axis" x="${padL - 6}" y="${gy + 3}" text-anchor="end">${Math.round(maxV * f)}</text>`;
    });

    let bars = '', xlabels = '', hits = '';
    days.forEach((d, i) => {
        const bx = x0(i), yAnon = y(d.anon), yTop = y(d.count);
        if (d.anon > 0) bars += `<rect class="tl-bar tl-bar-anon" x="${bx}" y="${yAnon}" width="${barW}" height="${baseline - yAnon}" rx="1.5"/>`;
        if (d.authed > 0) bars += `<rect class="tl-bar tl-bar-authed" x="${bx}" y="${yTop}" width="${barW}" height="${yAnon - yTop}" rx="1.5"/>`;
        if (i % 6 === 0 || i === DAYS - 1) xlabels += `<text class="tl-axis" x="${bx + barW / 2}" y="${H - 8}" text-anchor="middle">${tlFmt(d.key)}</text>`;
        const tip = `${tlFmt(d.key)}: ${d.count} action${d.count === 1 ? '' : 's'} (signed-in ${d.authed} · anon ${d.anon})`;
        hits += `<rect class="tl-hit" x="${padL + i * slot}" y="${padT}" width="${slot}" height="${plotH}" data-tip="${tip.replace(/"/g, '&quot;')}"/>`;
    });

    const legend = '<div class="tl-legend"><span><i style="background:var(--accent)"></i>Signed-in</span><span><i style="background:var(--border-strong)"></i>Anonymous</span></div>';
    el.innerHTML = legend +
        `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet" role="img" aria-label="Usage over time">` +
        grid + bars + ticks + xlabels + hits + '</svg>' +
        '<div class="tl-tooltip hidden"></div>';

    const svg = el.querySelector('svg'), tip = el.querySelector('.tl-tooltip'), wrap = el.parentElement;
    svg.addEventListener('mousemove', e => {
        const h = e.target.closest('[data-tip]');
        if (!h) { tip.classList.add('hidden'); return; }
        tip.textContent = h.getAttribute('data-tip');
        tip.classList.remove('hidden');
        const r = wrap.getBoundingClientRect();
        tip.style.left = (e.clientX - r.left) + 'px';
        tip.style.top = (e.clientY - r.top) + 'px';
    });
    svg.addEventListener('mouseleave', () => tip.classList.add('hidden'));
}

function render(data) {
    renderSummary(data.summary || {});
    renderTimeline(data.daily || []);
    renderUsers(data.users || { total: 0, top: [] });
    renderLobbyEvents(data.lobbyEvents || []);
    renderFeedback(data.feedback || []);
    show(dashboard);
}

let loading = false;
async function load() {
    if (loading) return;
    loading = true;
    show(gateLoading);
    try {
        const res = await getUsageStats();
        render(res.data);
    } catch (err) {
        if (String(err && err.code).includes('permission-denied')) {
            show(gateDenied);
        } else {
            console.error('Failed to load usage stats:', err);
            const el = document.getElementById('gate-error-msg');
            if (el) el.textContent = (err && err.message) || String(err);
            show(gateError);
        }
    } finally {
        loading = false;
    }
}

const refreshBtn = document.getElementById('refresh-btn');
if (refreshBtn) refreshBtn.addEventListener('click', load);

auth.onAuthStateChanged((user) => {
    if (user) load();
    else show(gateSignin);
});
