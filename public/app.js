const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const paths = {
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/><circle cx="9" cy="7" r="4"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pin: '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  drop: '<path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M4 12h16m-5-5 5 5-5 5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M9 5h12M9 12h12M9 19h12M3 5h.01M3 12h.01M3 19h.01"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
function hydrateIcons() { $$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const initials = name => name.split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase();
const dateLabel = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not recorded';
const statusBadge = d => `<span class="status ${d.available ? '' : 'unavailable'}"><i></i>${d.available ? 'Available' : 'Unavailable'}</span>`;
let all = [], filtered = [], page = 1, view = 'directory', layout = 'grid', position = null, generation = 0, currentProfile = null, deleteId = null, toastTimer, searchTimer;
const PAGE_SIZE = 9;
async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Unable to complete this request.');
  return body;
}
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function showError(error) { $('#load-error').textContent = error.message || 'Unable to load donors.'; $('#error-banner').hidden = false; }
function cityOptions() {
  const selected = $('#city-filter').value;
  const cities = [...new Set(all.map(d => d.city))].sort();
  $('#city-filter').innerHTML = '<option value="">All locations</option>' + cities.map(city => `<option value="${escape(city)}">${escape(city)}</option>`).join('');
  if (cities.includes(selected)) $('#city-filter').value = selected;
}
function stats() {
  $('#stat-total').textContent = all.length;
  $('#stat-available').textContent = all.filter(d => d.available).length;
  $('#stat-groups').innerHTML = `${new Set(all.map(d => d.bloodGroup)).size}<em>/ 8</em>`;
  $('#stat-cities').textContent = new Set(all.map(d => d.city.toLowerCase())).size;
  $('#hero-count').textContent = all.length;
  $('#network-count').textContent = all.length;
  $('#nav-count').textContent = all.length;
}
function params() {
  const p = new URLSearchParams();
  const values = { q: $('#search').value.trim(), group: $('#group-filter').value, city: $('#city-filter').value, available: view === 'available' ? 'true' : $('#availability-filter').value };
  Object.entries(values).forEach(([key, value]) => { if (value) p.set(key, value); });
  if (position) { p.set('lat', position.latitude); p.set('lng', position.longitude); p.set('radius', $('#radius').value); }
  return p;
}
async function search(resetPage = true) {
  const id = ++generation;
  if (resetPage) page = 1;
  $('#donor-grid').setAttribute('aria-busy', 'true');
  $('#error-banner').hidden = true;
  try {
    const data = await api(`/donors?${params()}`);
    if (id !== generation) return;
    filtered = data.donors;
    render();
  } catch (error) { if (id === generation) showError(error); }
  finally { if (id === generation) $('#donor-grid').setAttribute('aria-busy', 'false'); }
}
async function refresh() {
  try { const data = await api('/donors'); all = data.donors; stats(); cityOptions(); await search(false); if (view === 'activity') await loadActivity(); }
  catch (error) { showError(error); $('#donor-grid').setAttribute('aria-busy', 'false'); }
}
function render() {
  const total = filtered.length, pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.min(page, pages);
  const start = (page - 1) * PAGE_SIZE, items = filtered.slice(start, start + PAGE_SIZE);
  $('#donor-grid').classList.toggle('list-mode', layout === 'list');
  $('#donor-grid').innerHTML = items.map((d, i) => `<article class="donor-card"><div class="card-top"><span class="donor-avatar avatar-${i % 4}">${escape(initials(d.name))}</span><span class="blood-badge">${escape(d.bloodGroup)}</span></div><div class="donor-person"><h3>${escape(d.name)}${d.isDemo ? '<span class="demo-tag">DEMO</span>' : ''}</h3><div class="donor-location">${icon('pin')}<span>${escape(d.area ? `${d.area}, ${d.city}` : d.city)}</span></div></div><div class="donor-details">${statusBadge(d)}${d.distance !== undefined ? `<span class="distance">${d.locationPrecision === 'city' ? '≈ ' : ''}${d.distance.toFixed(1)} km away</span>` : '<span class="distance">Self-reported</span>'}</div><div class="card-footer"><button class="text-button" data-profile="${d.id}">View profile <span aria-hidden="true">↗</span></button><button class="text-button" data-edit="${d.id}">Edit details</button></div></article>`).join('');
  $('#empty-state').hidden = total !== 0;
  $('#results-label').innerHTML = total ? `Showing <strong>${start + 1}–${Math.min(start + PAGE_SIZE, total)}</strong> of <strong>${total}</strong> ${view === 'available' ? 'available ' : ''}donors` : '0 matching donors';
  $('#pagination').innerHTML = total > PAGE_SIZE ? `<span>Page ${page} of ${pages}</span><div class="pagination-actions"><button data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">←</button>${Array.from({ length: pages }, (_, i) => i + 1).filter(n => n === 1 || n === pages || Math.abs(n - page) < 2).map(n => `<button data-page="${n}" class="${n === page ? 'current' : ''}" ${n === page ? 'aria-current="page"' : ''}>${n}</button>`).join('')}<button data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">→</button></div>` : '';
  $('#clear-filters').hidden = !($('#search').value || $('#group-filter').value || $('#city-filter').value || $('#availability-filter').value || position);
  $$('[data-group]').forEach(b => { b.classList.toggle('selected', b.dataset.group === $('#group-filter').value); b.setAttribute('aria-pressed', String(b.dataset.group === $('#group-filter').value)); });
}
function resetSearch() {
  $('#search-form').reset(); position = null; $('#location-message').hidden = true; $('#near-me').innerHTML = `${icon('locate')}Near me`;
  if (view === 'available') $('#availability-filter').value = 'true';
  search();
}
async function setView(next) {
  view = next;
  const title = { directory: 'Donor directory', available: 'Available donors', activity: 'Recent activity' }[view];
  $('#page-title').innerHTML = `${title}<span>.</span>`; $('#breadcrumb-current').textContent = title;
  $('#page-subtitle').textContent = { directory: 'Find the right donor. Make a life-changing connection.', available: 'Connect with donors who have marked themselves available.', activity: 'Follow the latest changes in your donor community.' }[view];
  $$('.nav-item').forEach(b => { b.classList.toggle('active', b.dataset.view === view); b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'); });
  $('#directory-section').hidden = view === 'activity'; $('#activity-section').hidden = view !== 'activity';
  $('#availability-filter').disabled = view === 'available';
  if (view === 'available') $('#availability-filter').value = 'true';
  else if (view === 'directory') $('#availability-filter').value = '';
  if (view === 'activity') { try { await loadActivity(); } catch (error) { toast(error.message); } } else search();
}
async function loadActivity() {
  const { activity } = await api('/activity');
  $('#activity-list').innerHTML = activity.length ? activity.map(item => `<div class="activity-row"><span>${icon(item.action === 'registered' ? 'plus' : 'activity')}</span><div><p><strong>${escape(item.name)}</strong> · Profile ${escape(item.action)}</p><small>${escape(new Date(item.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))}</small></div></div>`).join('') : '<div class="activity-row"><p>No activity yet. Register your first donor to get started.</p></div>';
}
function openForm(id) {
  const form = $('#donor-form'); form.reset(); $('#form-error').hidden = true;
  const donor = id ? all.find(d => d.id === id) : null;
  $('#form-title').textContent = donor ? 'Edit donor profile' : 'Register a donor';
  form.elements.id.value = donor?.id || '';
  if (donor) {
    for (const field of ['name', 'phone', 'email', 'city', 'area', 'bloodGroup', 'lastDonation', 'notes']) form.elements[field].value = donor[field] || '';
    form.elements.available.value = String(donor.available);
    if (donor.locationPrecision === 'exact') { form.elements.lat.value = donor.lat; form.elements.lng.value = donor.lng; }
  }
  form.querySelector('details').open = false;
  form.elements.lastDonation.max = new Date().toISOString().slice(0, 10);
  if ($('#profile-dialog').open) $('#profile-dialog').close();
  $('#donor-dialog').showModal();
}
async function openProfile(id) {
  try {
    const { donor: d } = await api(`/donors/${id}`); currentProfile = d;
    $('#profile-content').innerHTML = `<div class="dialog-heading"><span class="eyebrow">DONOR PROFILE</span><button class="icon-button" data-close="profile-dialog" aria-label="Close profile">×</button></div><div class="profile-identity"><span class="donor-avatar">${escape(initials(d.name))}</span><div><h2 id="profile-title">${escape(d.name)}</h2><p>${escape(d.area ? `${d.area}, ${d.city}` : d.city)}</p></div><span class="blood-badge">${escape(d.bloodGroup)}</span></div><div class="profile-status">${statusBadge(d)}<button class="text-button" id="toggle-availability">Mark ${d.available ? 'unavailable' : 'available'}</button></div><dl class="profile-fields"><div><dt>Phone number</dt><dd>${d.isDemo ? 'Sample contact' : `<a href="tel:${escape(d.phone)}">${escape(d.phone)}</a>`}</dd></div><div><dt>Email address</dt><dd>${d.isDemo ? 'Sample contact' : d.email ? `<a href="mailto:${escape(d.email)}">${escape(d.email)}</a>` : 'Not provided'}</dd></div><div><dt>Last donation</dt><dd>${dateLabel(d.lastDonation)}</dd></div><div><dt>Location precision</dt><dd>${{ city: 'City centre (approximate)', exact: 'Coordinates provided', unknown: 'City only · no coordinates' }[d.locationPrecision]}</dd></div><div><dt>Member since</dt><dd>${dateLabel(d.createdAt.slice(0, 10))}</dd></div><div><dt>Availability</dt><dd>Self-reported by coordinator</dd></div></dl>${d.notes ? `<p class="profile-notes">${escape(d.notes)}</p>` : ''}${d.isDemo ? '<p class="profile-demo">This is a fictional sample profile. Contact actions are disabled.</p>' : ''}<p class="dialog-intro">Availability is a contact preference. Donation eligibility must be assessed by a qualified blood centre.</p><div class="dialog-footer"><button class="danger-button" id="remove-donor">Remove donor</button><button class="button secondary" data-close="profile-dialog">Close</button><button class="button primary" id="edit-profile">Edit profile</button></div>`;
    if (!$('#profile-dialog').open) $('#profile-dialog').showModal();
  } catch (error) { toast(error.message); }
}
function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Your browser does not support location. Search by city instead.'));
    navigator.geolocation.getCurrentPosition(p => resolve(p.coords), e => reject(new Error(e.code === 1 ? 'Location permission was denied. Choose a city or allow location in your browser.' : 'Could not determine your location. Please search by city.')), { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
  });
}
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.close) $(`#${button.dataset.close}`).close();
  if (button.dataset.profile) openProfile(button.dataset.profile);
  if (button.dataset.edit) openForm(button.dataset.edit);
  if (button.dataset.view) setView(button.dataset.view);
  if (button.dataset.group !== undefined) { $('#group-filter').value = button.dataset.group; search(); }
  if (button.dataset.page) { page = Number(button.dataset.page); render(); $('#directory-section').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});
$('#add-donor').addEventListener('click', () => openForm()); $('#sidebar-add').addEventListener('click', () => openForm());
$('#search-form').addEventListener('submit', event => { event.preventDefault(); clearTimeout(searchTimer); search(); });
$('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => search(), 250); });
for (const field of ['group-filter', 'city-filter', 'availability-filter', 'radius']) $(`#${field}`).addEventListener('change', () => search());
$('#clear-filters').addEventListener('click', resetSearch); $('#empty-clear').addEventListener('click', resetSearch); $('#retry-load').addEventListener('click', refresh);
for (const mode of ['grid', 'list']) $(`#${mode}-view`).addEventListener('click', () => { layout = mode; for (const other of ['grid', 'list']) { $(`#${other}-view`).classList.toggle('selected', other === mode); $(`#${other}-view`).setAttribute('aria-pressed', String(other === mode)); } render(); });
$('#near-me').addEventListener('click', async () => {
  if (position) { position = null; $('#location-message').hidden = true; $('#near-me').innerHTML = `${icon('locate')}Near me`; return search(); }
  $('#near-me').disabled = true; $('#near-me').textContent = 'Locating…';
  try { position = await locate(); $('#city-filter').value = ''; $('#location-message').textContent = 'Searching near your current location. Distances marked ≈ use a city centre; donors without coordinates are excluded. Click “Location on” to turn off.'; $('#location-message').hidden = false; await search(); }
  catch (error) { toast(error.message); }
  finally { $('#near-me').disabled = false; $('#near-me').innerHTML = `${icon('locate')}${position ? 'Location on' : 'Near me'}`; }
});
$('#use-form-location').addEventListener('click', async () => {
  const button = $('#use-form-location'); button.disabled = true;
  try { const p = await locate(); $('#donor-form').elements.lat.value = p.latitude.toFixed(6); $('#donor-form').elements.lng.value = p.longitude.toFixed(6); }
  catch (error) { $('#form-error').textContent = error.message; $('#form-error').hidden = false; }
  finally { button.disabled = false; }
});
$('#donor-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#save-donor'); button.disabled = true; button.textContent = 'Saving…'; $('#form-error').hidden = true;
  const input = Object.fromEntries(new FormData(event.target)); const id = input.id; delete input.id; input.available = input.available === 'true';
  try { await api(id ? `/donors/${id}` : '/donors', { method: id ? 'PUT' : 'POST', body: JSON.stringify(input) }); $('#donor-dialog').close(); toast(id ? 'Donor profile updated.' : 'Welcome to the network. Donor registered.'); await refresh(); }
  catch (error) { $('#form-error').textContent = error.message; $('#form-error').hidden = false; }
  finally { button.disabled = false; button.textContent = 'Save donor'; }
});
$('#profile-content').addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button || !currentProfile) return;
  if (button.id === 'edit-profile') openForm(currentProfile.id);
  if (button.id === 'remove-donor') { deleteId = currentProfile.id; $('#confirm-text').textContent = `${currentProfile.name} will be permanently removed from the donor directory. This cannot be undone.`; $('#confirm-dialog').showModal(); }
  if (button.id === 'toggle-availability') {
    button.disabled = true;
    const donor = { ...currentProfile, available: !currentProfile.available };
    if (donor.locationPrecision !== 'exact') { donor.lat = null; donor.lng = null; }
    try { await api(`/donors/${donor.id}`, { method: 'PUT', body: JSON.stringify(donor) }); await refresh(); await openProfile(donor.id); toast('Availability updated.'); }
    catch (error) { toast(error.message); button.disabled = false; }
  }
});
$('#confirm-delete').addEventListener('click', async () => {
  const button = $('#confirm-delete'); button.disabled = true;
  try { await api(`/donors/${deleteId}`, { method: 'DELETE' }); $('#confirm-dialog').close(); $('#profile-dialog').close(); currentProfile = null; deleteId = null; await refresh(); toast('Donor removed from the directory.'); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
hydrateIcons();
async function init() {
  try {
    const meta = await api('/meta');
    const options = meta.groups.map(group => `<option value="${group}">${group}</option>`).join('');
    $('#group-filter').insertAdjacentHTML('beforeend', options); $('#form-group').insertAdjacentHTML('beforeend', options);
    $('#group-chips').innerHTML = meta.groups.map(group => `<button class="group-chip" data-group="${group}" aria-pressed="false">${group}</button>`).join('');
    $('#city-options').innerHTML = meta.cities.map(c => `<option value="${c.name}"></option>`).join('');
    await refresh();
  } catch (error) { showError(error); $('#donor-grid').setAttribute('aria-busy', 'false'); }
}
init();
