const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number = value => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
let workspace = { listings: [] };
let submissionKey = crypto.randomUUID();
let toastTimeout;
function notify(message) { byId('toast').textContent = message; byId('toast').classList.add('show'); clearTimeout(toastTimeout); toastTimeout = setTimeout(() => byId('toast').classList.remove('show'), 4000); }
const pages = {
  overview: ['Overview', 'A clearer view of every connection.', 'Your voice marketplace, from first conversation to the next opportunity.'],
  calls: ['Call activity', 'Every conversation, in focus.', 'Monitor incoming calls and inspect transcripts, matches and delivery events.'],
  marketplace: ['Marketplace', 'Bring the right people together.', 'Manage real buyer requirements and farmer supply in one shared marketplace.'],
  mandi: ['Mandi prices', 'Market information you can trace.', 'Explore official reported prices, with dates and sources attached.'],
  services: ['Connections', 'Know what is ready to connect.', 'An honest view of the services behind your voice marketplace.']
};
function route() {
  const page = location.hash.slice(1) in pages ? location.hash.slice(1) : 'overview';
  document.querySelectorAll('[data-page]').forEach(node => node.classList.toggle('hidden', !node.dataset.page.split(' ').includes(page)));
  document.querySelectorAll('[data-nav]').forEach(node => { node.classList.toggle('active', node.dataset.nav === page); if (node.dataset.nav === page) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current'); });
  [byId('pageTitle').textContent, byId('pageHeading').textContent, byId('pageDescription').textContent] = pages[page];
  document.title = `KisanSetu | ${pages[page][0]}`;
}
window.addEventListener('hashchange', route); route();
byId('todayDate').textContent = new Date().toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => byId(button.dataset.close).close());
document.querySelectorAll('[data-open-listing]').forEach(button => button.onclick = () => byId('listingDialog').showModal());
function renderMarketplace() {
  const all = workspace.listings;
  const active = all.filter(l => l.active);
  byId('marketSummary').innerHTML = `<span><strong>${active.filter(l => l.side === 'SELL').length}</strong> active sellers</span><span><strong>${active.filter(l => l.side === 'BUY').length}</strong> active buyers</span><span><strong>${all.length}</strong> total listings</span>`;
  const query = byId('listingSearch').value.trim().toLowerCase();
  const filter = byId('listingFilter').value;
  const listings = all.filter(l => (filter === 'ALL' || (filter === 'INACTIVE' ? !l.active : l.side === filter && l.active)) && [l.name,l.commodity,l.location].some(v => String(v || '').toLowerCase().includes(query)));
  byId('marketplaceList').innerHTML = listings.length ? listings.map(l => `<article class="listing-card ${l.active ? '' : 'inactive'}"><div class="card-top"><span class="card-type ${l.side === 'BUY' ? 'buyer' : ''}">${l.side === 'BUY' ? 'BUYER' : 'SELLER'}</span><span class="subtle">${l.active ? 'Active' : 'Inactive'}${l.voice_call_count ? ' · Phone call' : ''}</span></div><h3>${escapeHtml(l.commodity)}</h3><p>${escapeHtml(l.name || 'Name not provided')} · ${escapeHtml(l.location)}</p><div class="quantity">${number(l.quantity_kg)} <small>kg ${l.side === 'BUY' ? 'required' : 'available'}</small></div><p>${l.price_per_kg == null ? 'Price not provided' : `₹${number(l.price_per_kg)} / kg`}<br>${escapeHtml(l.phone || 'Phone not provided')} · ${l.verified ? 'Verified' : 'Unverified'}</p><div class="card-actions"><button class="refresh" data-matches="${l.id}" ${l.active ? '' : 'disabled'}>View matches ↗</button><button class="refresh" data-toggle="${l.id}">${l.active ? 'Deactivate' : 'Reactivate'}</button></div></article>`).join('') : `<div class="empty-state empty-wide"><span class="empty-symbol">⇄</span><strong>${all.length ? 'No matching listings' : 'Your marketplace starts here.'}</strong><span>${all.length ? 'Try another search or filter.' : 'Add a real buyer or seller to start discovering compatible participants.'}</span></div>`;
  byId('marketplaceList').querySelectorAll('[data-toggle]').forEach(button => button.onclick = async () => {
    button.disabled = true;
    try { const listing = all.find(l => String(l.id) === button.dataset.toggle); await api(`/api/admin/listings/${listing.id}`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:!listing.active})}); await refreshWorkspace(); notify(listing.active ? 'Listing deactivated.' : 'Listing reactivated.'); } catch(error) { notify(error.message); button.disabled = false; }
  });
  byId('marketplaceList').querySelectorAll('[data-matches]').forEach(button => button.onclick = async () => {
    button.disabled = true;
    try { const {matches} = await api(`/api/admin/listings/${button.dataset.matches}/matches`); byId('workspaceMatches').innerHTML = matches.length ? matches.map(m => `<article class="listing-card"><span class="card-type">RANK ${m.rank} · ${number(m.score)}/100</span><h3>${escapeHtml(m.name || 'Name not provided')}</h3><p>${escapeHtml(m.location)} · ${escapeHtml(m.phone || 'Phone not provided')}</p><div class="quantity">${number(m.matchedQuantityKg)} <small>kg compatible</small></div><p>${escapeHtml(m.reason)}</p></article>`).join('') : '<div class="empty-state empty-wide"><span class="empty-symbol">⇄</span><strong>No compatible participants yet.</strong><span>Add an active listing on the other side of the market for this commodity.</span></div>'; byId('matchesDialog').showModal(); } catch(error) { notify(error.message); } finally { button.disabled = false; }
  });
}
byId('listingSearch').oninput = renderMarketplace; byId('listingFilter').onchange = renderMarketplace;
async function refreshWorkspace() {
  workspace = await api('/api/admin/workspace'); renderMarketplace();
  byId('historyNote').classList.toggle('hidden', !workspace.historicalSampleMatches);
  byId('historyNote').textContent = `Historical totals include ${workspace.historicalSampleMatches} matches to archived sample listings. New matches use real entries only.`;
  byId('serviceList').innerHTML = workspace.services.map(s => `<article class="service-card"><h3>${escapeHtml(s.name)}</h3><span class="service-state ${s.state}">${{ready:'Available',configured:'Configured · not live-verified',missing:'Setup required',local:'Local access'}[s.state]}</span><p>${escapeHtml(s.detail)}</p></article>`).join('');
  const istToday = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata', year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const days = Array.from({length:7}, (_,i) => { const date = new Date(`${istToday}T12:00:00Z`); date.setUTCDate(date.getUTCDate()-6+i); const key = date.toISOString().slice(0,10); return {date,count:workspace.activity.find(a=>a.day===key)?.count || 0}; });
  const max = Math.max(1,...days.map(d=>d.count));
  byId('activityChart').innerHTML = days.map(d=>`<div class="chart-column" aria-label="${d.date.toLocaleDateString('en-IN')}: ${d.count} calls"><strong>${d.count}</strong><div class="chart-bar" style="height:${Math.max(2,d.count/max*95)}px"></div><span>${d.date.toLocaleDateString('en-IN',{weekday:'short'})}</span></div>`).join('');
  const total = workspace.languages.reduce((sum,l)=>sum+l.count,0);
  byId('languageChart').innerHTML = total ? workspace.languages.map(l=>`<div class="language-row"><span>${escapeHtml(languageNames[l.language] || (l.language==='en-IN'?'English':l.language))}</span><div class="language-track"><div class="language-fill" style="width:${l.count/total*100}%"></div></div><strong>${l.count}</strong></div>`).join('') : '<div class="empty-state"><strong>Ready for the first voice.</strong><span>Detected call languages will appear here.</span></div>';
}
window.refreshWorkspace = refreshWorkspace;
byId('listingForm').onsubmit = async event => {
  event.preventDefault(); const button=byId('saveListing'); button.disabled=true; button.textContent='Saving listing…'; byId('listingError').textContent='';
  try { const data = Object.fromEntries(new FormData(event.target)); await api('/api/admin/listings',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':submissionKey},body:JSON.stringify(data)}); submissionKey=crypto.randomUUID(); event.target.reset(); byId('listingDialog').close(); location.hash='marketplace'; notify('Listing saved to the marketplace.'); await refreshWorkspace(); } catch(error) { byId('listingError').textContent=error.message; } finally {button.disabled=false;button.textContent='Confirm & save listing';}
};
byId('extractButton').onclick = async () => {
  const button=byId('extractButton'); button.disabled=true;
  try { const data=await api('/api/admin/parse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:byId('captureText').value})}); const form=byId('listingForm'); for (const key of ['commodity','quantityKg','location']) form.elements[key].value=data[key] || ''; if (['BUY','SELL'].includes(data.intent)) form.elements.side.value=data.intent; byId('captureHelp').textContent='Details extracted. Review each field and add the participant name before saving.'; } catch(error) {byId('captureHelp').textContent=error.message;} finally {button.disabled=false;}
};
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition, listening=false;
if (Speech) {
  recognition=new Speech(); recognition.interimResults=true;
  recognition.onstart=()=>{listening=true;byId('captureMic').textContent='■ Stop';byId('captureHelp').textContent='Listening… speak in the selected language.';};
  recognition.onend=()=>{listening=false;byId('captureMic').textContent='◉ Speak';};
  recognition.onresult=event=>{byId('captureText').value=Array.from(event.results).map(result=>result[0].transcript).join(' ');};
  recognition.onerror=event=>{byId('captureHelp').textContent=event.error==='not-allowed'?'Microphone permission was denied. Allow access or type your sentence.':`Speech recognition unavailable (${event.error}). You can type instead.`;};
  byId('captureMic').onclick=()=>{try{if(listening)recognition.stop();else{recognition.lang=byId('speechLanguage').value;recognition.start();}}catch{byId('captureHelp').textContent='Microphone is busy. Please try again.';}};
  byId('listingDialog').addEventListener('close',()=>recognition.abort());
} else {byId('captureMic').disabled=true;byId('captureHelp').textContent='Voice input is not supported in this browser. Type a sentence or enter details below.';}
byId('mandiForm').onsubmit=async event=>{
  event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;button.textContent='Finding prices…';byId('mandiResults').textContent='Checking official market data…';
  try {const data=await api('/api/admin/mandi?'+new URLSearchParams(new FormData(event.target)));byId('mandiResults').innerHTML=data.rates.length?`<p class="section-note">${escapeHtml(data.source)} · ${data.fromCache?'Cached official response':data.mode==='FALLBACK'?'Sample fallback data, not official prices':'Reported market prices'} · ₹ per quintal (100 kg)</p><table><thead><tr><th>Market</th><th>District</th><th>Min</th><th>Modal</th><th>Max</th><th>Reported date</th></tr></thead><tbody>${data.rates.map(r=>`<tr><td>${escapeHtml(r.mandi)}</td><td>${escapeHtml(r.district)}</td><td>${r.minPrice==null?'—':'₹'+number(r.minPrice)}</td><td class="modal-price">₹${number(r.modalPrice)}</td><td>${r.maxPrice==null?'—':'₹'+number(r.maxPrice)}</td><td>${escapeHtml(r.observedAt || 'Date unavailable')}</td></tr>`).join('')}</tbody></table>`:`<div class="empty-state"><span class="empty-symbol">▥</span><strong>${data.errorCode==='MISSING_DATA_GOV_IN_CONFIGURATION'?'Official price connection needs setup.':'No official prices available for this search.'}</strong><span>${data.errorCode==='MISSING_DATA_GOV_IN_CONFIGURATION'?'Add the data.gov.in API key to enable market lookups.':'Try another crop or district, or retry when the provider is available.'}</span></div>`;}catch(error){byId('mandiResults').textContent=error.message;}finally{button.disabled=false;button.textContent='Find prices ↗';}
};
