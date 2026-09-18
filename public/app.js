
const $ = id => document.getElementById(id);
let parsed = null;

function toast(msg){
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  setTimeout(()=>$("toast").classList.remove("show"),2200);
}

function setMode(mode){
  $("mode").value = mode;
  $("intentBadge").textContent = mode;
  $("priceLabel").textContent = mode === "SELL" ? "Expected price ₹/kg" : "Maximum price ₹/kg";
  $("confirm").textContent = mode === "SELL" ? "✓ Confirm & Create Listing" : "✓ Confirm & Find Farmers";
}
$("mode").addEventListener("change", e => setMode(e.target.value));

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
if(SpeechRecognition){
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "hi-IN";
  recognition.onstart = ()=>{ $("mic").classList.add("listening"); $("listenState").textContent="Listening…"; };
  recognition.onend = ()=>{ $("mic").classList.remove("listening"); $("listenState").textContent="Tap to speak"; };
  recognition.onerror = e => toast("Mic error: " + e.error);
  recognition.onresult = e => {
    let finalText = "";
    for(let i=e.resultIndex;i<e.results.length;i++) finalText += e.results[i][0].transcript;
    $("transcript").value = finalText;
  };
}
$("mic").onclick = ()=>{
  if(!recognition) return toast("Use Chrome for microphone speech recognition.");
  recognition.start();
};

$("process").onclick = async ()=>{
  const text = $("transcript").value.trim();
  if(!text) return toast("Speak or type a sentence first.");
  const r = await fetch("/api/parse",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text})});
  parsed = await r.json();
  if($("mode").value !== parsed.intent && (/\bchahiye|kharid|buy\b/i.test(text))) setMode("BUY");
  else if($("mode").value !== parsed.intent && (/\bbech|sell\b/i.test(text))) setMode("SELL");

  $("commodity").value = parsed.commodity || "";
  $("quantity").value = parsed.quantityKg || "";
  $("location").value = parsed.location || "";
  $("price").value = parsed.pricePerKg || "";
  updateConfirmSentence();
  $("confirm").disabled = false;
  toast("Voice converted into structured market data");
};

["commodity","quantity","location","price"].forEach(id => $(id).addEventListener("input",updateConfirmSentence));

function updateConfirmSentence(){
  const mode = $("mode").value;
  const c = $("commodity").value || "commodity";
  const q = $("quantity").value || "?";
  const l = $("location").value || "unknown location";
  const p = $("price").value;
  if(mode==="SELL"){
    $("confirmSentence").textContent = `Confirmation: You want to sell ${q} kg ${c} from ${l}${p ? ` at ₹${p}/kg`:""}.`;
  }else{
    $("confirmSentence").textContent = `Confirmation: You want to buy ${q} kg ${c} near ${l}${p ? ` up to ₹${p}/kg`:""}.`;
  }
}

$("confirm").onclick = async ()=>{
  const mode = $("mode").value;
  const body = {
    commodity:$("commodity").value,
    quantityKg:$("quantity").value,
    location:$("location").value
  };
  if(!body.commodity || !body.quantityKg || !body.location) return toast("Commodity, quantity and location are required.");

  if(mode==="SELL"){
    body.pricePerKg = $("price").value || null;
    const r = await fetch("/api/farmers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const data = await r.json();
    toast("✓ Farmer listing created");
    loadListings();
  }else{
    body.maxPrice = $("price").value || null;
    const r = await fetch("/api/buyers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const data = await r.json();
    renderMatches(data.matches || []);
    toast(`${data.matches?.length || 0} matching farmers found`);
  }
};

function renderMatches(matches){
  $("matchSection").classList.remove("hidden");
  $("matchCount").textContent = `${matches.length} MATCHES`;
  $("matches").innerHTML = matches.length ? matches.map(m=>`
    <div class="match">
      <div class="score">${m.matchScore}%</div>
      <small>MATCH SCORE</small>
      <h3>${m.name}</h3>
      <p>
        ${capitalize(m.commodity)} • ${m.quantityKg} kg available<br>
        ${m.location}<br>
        ${m.pricePerKg ? `Expected ₹${m.pricePerKg}/kg<br>`:""}
        Contact: ${m.phone}
      </p>
    </div>`).join("") : `<div class="muted">No compatible farmer currently found. The buyer requirement has still been stored.</div>`;
  $("matchSection").scrollIntoView({behavior:"smooth"});
}

function capitalize(s){return (s||"").charAt(0).toUpperCase()+(s||"").slice(1)}

async function loadListings(){
  const r = await fetch("/api/listings");
  const db = await r.json();
  const f = db.farmers || [];
  $("listingTable").innerHTML = `
  <table>
    <thead><tr><th>Farmer</th><th>Commodity</th><th>Quantity</th><th>Location</th><th>Price</th><th>Status</th></tr></thead>
    <tbody>${f.map(x=>`<tr>
      <td>${x.name}</td><td>${capitalize(x.commodity)}</td><td>${x.quantityKg} kg</td>
      <td>${x.location}</td><td>${x.pricePerKg ? "₹"+x.pricePerKg+"/kg":"—"}</td><td><span class="pill">ACTIVE</span></td>
    </tr>`).join("")}</tbody>
  </table>`;
}
$("refresh").onclick = loadListings;
setMode("SELL");
loadListings();
