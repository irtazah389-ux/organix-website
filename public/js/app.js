// Shared frontend helpers for Organix Global Export

const API_BASE = '/api';

function getToken(){ return localStorage.getItem('og_token'); }
function setToken(t){ localStorage.setItem('og_token', t); }
function clearToken(){ localStorage.removeItem('og_token'); localStorage.removeItem('og_user'); }
function getUser(){ try{ return JSON.parse(localStorage.getItem('og_user')); }catch(e){ return null; } }
function setUser(u){ localStorage.setItem('og_user', JSON.stringify(u)); }

async function api(method, path, body){
  const headers = {'Content-Type':'application/json'};
  const t = getToken();
  if (t) headers['Authorization'] = 'Bearer ' + t;
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch(e) {}
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function money(n){
  return '$' + Number(n).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
}

function fmtDate(s){
  if (!s) return '—';
  return new Date(s.replace(' ','T')+'Z').toLocaleDateString(undefined, {year:'numeric', month:'short', day:'numeric'});
}

function badgeForVerification(status){
  if (status === 'verified') return `<span class="badge badge-verified">✓ Verified</span>`;
  if (status === 'rejected') return `<span class="badge badge-rejected">Rejected</span>`;
  if (status === 'pending') return `<span class="badge badge-pending">Pending review</span>`;
  return '';
}

function badgeForOrderStatus(status){
  const map = {
    pending: 'badge-pending',
    in_progress: 'badge-status',
    completed: 'badge-verified',
    cancelled: 'badge-rejected'
  };
  const label = {pending:'Pending', in_progress:'In progress', completed:'Completed', cancelled:'Cancelled'}[status] || status;
  return `<span class="badge ${map[status]||''}">${label}</span>`;
}

// Renders the top nav, adapting to logged-in role. Call on every page.
function renderNav(activePath){
  const user = getUser();
  const el = document.getElementById('site-nav');
  if (!el) return;

  let rightSide = '';
  if (user){
    const dashLink = user.role === 'vendor' ? '/vendor-dashboard.html'
                    : user.role === 'buyer' ? '/buyer-dashboard.html'
                    : '/admin-dashboard.html';
    rightSide = `
      <div class="nav-cta">
        <a href="${dashLink}" class="btn btn-outline btn-sm">${user.name || user.business_name || 'Dashboard'}</a>
        <button onclick="doLogout()" class="btn btn-outline btn-sm">Log out</button>
      </div>`;
  } else {
    rightSide = `
      <div class="nav-cta">
        <a href="/login.html" class="btn btn-outline btn-sm">Log in</a>
        <a href="/signup.html" class="btn btn-primary btn-sm">Become a vendor</a>
      </div>`;
  }

  el.innerHTML = `
    <div class="nav-inner">
      <a href="/" class="brand">Organix<span class="dot">•</span>Global</a>
      <div class="nav-links">
        <a href="/marketplace.html" class="${activePath==='marketplace'?'active':''}">Marketplace</a>
        <a href="/how-it-works.html" class="${activePath==='how'?'active':''}">How it works</a>
        <a href="/pricing.html" class="${activePath==='pricing'?'active':''}">Pricing</a>
        <a href="/about.html" class="${activePath==='about'?'active':''}">About</a>
        <a href="/contact.html" class="${activePath==='contact'?'active':''}">Contact</a>
      </div>
      ${rightSide}
    </div>`;
}

async function doLogout(){
  try { await api('POST', '/logout'); } catch(e){}
  clearToken();
  window.location.href = '/';
}

function renderFooter(){
  const el = document.getElementById('site-footer');
  if (!el) return;
  el.innerHTML = `
    <div class="container">
      <div>
        <div class="brand" style="color:white; margin-bottom:8px;">Organix<span class="dot">•</span>Global</div>
        <p style="color:rgba(255,255,255,0.5); max-width:280px;">Connecting Pakistani manufacturers and artisans to buyers worldwide.</p>
      </div>
      <div>
        <div style="font-weight:700; color:white; margin-bottom:10px;">Platform</div>
        <a href="/marketplace.html" style="display:block; margin-bottom:8px;">Marketplace</a>
        <a href="/how-it-works.html" style="display:block; margin-bottom:8px;">How it works</a>
        <a href="/pricing.html" style="display:block;">Commission & pricing</a>
      </div>
      <div>
        <div style="font-weight:700; color:white; margin-bottom:10px;">Company</div>
        <a href="/about.html" style="display:block; margin-bottom:8px;">About us</a>
        <a href="/contact.html" style="display:block;">Contact</a>
      </div>
    </div>
    <div class="container"><small>© 2026 Organix Global Export. All rights reserved.</small></div>`;
}

// Guard: redirect to login if not authenticated as the required role.
async function requireAuth(role){
  const token = getToken();
  if (!token){ window.location.href = '/login.html'; return null; }
  try {
    const { user } = await api('GET', '/me');
    setUser(user);
    if (role && user.role !== role){
      window.location.href = '/login.html';
      return null;
    }
    return user;
  } catch(e){
    clearToken();
    window.location.href = '/login.html';
    return null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderFooter();
});
