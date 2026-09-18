const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createCallRepository } = require('../src/call-repository');
const { createMarketplaceRepository } = require('../src/marketplace-repository');
const { createVoiceMarketplaceService } = require('../src/voice-marketplace');
const { rankMatches } = require('../src/matching');
const { registrationMessage } = require('../src/i18n/registration-messages');

function fixture(t) {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const calls = createCallRepository(db), marketplace = createMarketplaceRepository(db);
  const events=[];
  const register = createVoiceMarketplaceService({calls,marketplace,resolveCallerNumber:async()=>null,publish:e=>events.push(e)});
  let next = 0;
  function call(fields={}) {
    const sid=`voice-test-${++next}`;
    calls.createCall({callSid:sid,callerNumber:'+919000000001'});
    calls.updateCall(sid,{intent:'BUY',commodity:'Tomato',quantityKg:20,location:'Vadodara',...fields});
    return sid;
  }
  return {db,calls,marketplace,register,call,events};
}
test('a buyer request with no sellers is saved and discoverable by a later seller',async t=>{
  const f=fixture(t);const buyer=f.call();
  const result=await f.register(buyer);
  assert.equal(result.status,'CREATED');
  assert.equal(f.marketplace.getEligibleListings('SELL','Tomato').length,0);
  const seller=f.call({intent:'SELL',callerNumber:'+919000000002'});await f.register(seller);
  const matches=rankMatches({intent:'SELL',commodity:'Tomato',quantityKg:20,location:'Vadodara',callerNumber:'+919000000002'},f.marketplace.getEligibleListings('BUY','Tomato'));
  assert.equal(matches.length,1);assert.equal(matches[0].phone,'+919000000001');
  assert.equal(matches[0].quantityKg,20);assert.equal(matches[0].name,'');assert.equal(matches[0].pricePerKg,null);assert.equal(matches[0].verified,false);
  assert.equal(f.calls.getCallDetail(f.calls.getCallBySid(buyer).id).marketplace_listing.id,result.listingId);
  assert.equal(f.events.length,2);
});
test('seller-first calls also register supply for later buyer discovery',async t=>{
  const f=fixture(t);await f.register(f.call({intent:'SELL'}));
  const matches=rankMatches({intent:'BUY',commodity:'Tomato',quantityKg:20,location:'Vadodara',callerNumber:'+919000000002'},f.marketplace.getEligibleListings('SELL','Tomato'));
  assert.equal(matches.length,1);
});
test('same call is idempotent; repeated calls update quantity without duplicating listings or participants',async t=>{
  const f=fixture(t);const sid=f.call();const first=await f.register(sid);assert.equal((await f.register(sid)).status,'EXISTING');
  const next=await f.register(f.call({quantityKg:50,callerNumber:'09000000001',location:'Baroda'}));
  assert.equal(next.listingId,first.listingId);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM trade_listings').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM market_participants').get().n,1);
  assert.equal(f.marketplace.getEligibleListings('BUY','Tomato')[0].quantity_kg,50);
});
test('same caller cannot match themselves across phone formats and trade sides',async t=>{
  const f=fixture(t);await f.register(f.call());
  assert.deepEqual(rankMatches({intent:'SELL',commodity:'Tomato',quantityKg:20,location:'Vadodara',callerNumber:'9000000001'},f.marketplace.getEligibleListings('BUY','Tomato')),[]);
});
test('missing caller uses Exotel CallSid lookup, never a marketplace participant phone',async t=>{
  const f=fixture(t);const sid=f.call({callerNumber:null});let lookedUp;
  const register=createVoiceMarketplaceService({...f,resolveCallerNumber:async id=>{lookedUp=id;return '9000000003';}});
  assert.equal((await register(sid)).status,'CREATED');assert.equal(lookedUp,sid);
  assert.equal(f.calls.getCallBySid(sid).caller_number,'+919000000003');
});
test('unresolved caller and incomplete or invalid slots do not create listings',async t=>{
  const f=fixture(t);
  for(const fields of [{callerNumber:null},{location:null},{commodity:null},{quantityKg:0},{quantityKg:-1},{quantityKg:100000001},{intent:'OTHER'}]) {
    assert.equal((await f.register(f.call(fields))).status,'SKIPPED');
  }
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM trade_listings').get().n,0);
});
test('late lookup after disconnect cannot publish a listing',async t=>{
  const f=fixture(t);const sid=f.call({callerNumber:null});
  const register=createVoiceMarketplaceService({...f,resolveCallerNumber:async()=>'+919000000003'});
  assert.equal((await register(sid,{isActive:()=>false})).reason,'CALL_ENDED');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM trade_listings').get().n,0);
});
test('admin deactivation and known name/price survive repeat calls',async t=>{
  const f=fixture(t);const first=await f.register(f.call());
  f.db.prepare('UPDATE trade_listings SET active=0,price_per_kg=25 WHERE id=?').run(first.listingId);
  f.db.prepare("UPDATE market_participants SET name='Existing name',verified=1").run();
  await f.register(f.call({quantityKg:40}));
  const listing=f.db.prepare('SELECT * FROM trade_listings WHERE id=?').get(first.listingId);
  assert.equal(listing.active,0);assert.equal(listing.price_per_kg,25);assert.equal(listing.quantity_kg,40);
  assert.equal(f.db.prepare('SELECT name FROM market_participants').get().name,'Existing name');
});
test('an older call processed late cannot overwrite a newer quantity',async t=>{
  const f=fixture(t);const old=f.call({quantityKg:10});const recent=f.call({quantityKg:50});
  await f.register(recent);await f.register(old);
  assert.equal(f.marketplace.getEligibleListings('BUY','Tomato')[0].quantity_kg,50);
});
test('registration database failure is isolated and never announces success',async t=>{
  const f=fixture(t);const register=createVoiceMarketplaceService({...f,marketplace:{registerVoiceCall(){throw Error('failure');}},resolveCallerNumber:async()=>null});
  const result=await register(f.call());assert.equal(result.status,'FAILED');assert.equal(registrationMessage(result,'en-IN'),'');
});
test('successful registration has a notice in all 11 call languages',()=>{
  const notices=['hi-IN','gu-IN','en-IN','mr-IN','pa-IN','bn-IN','ta-IN','te-IN','kn-IN','ml-IN','od-IN'].map(code=>registrationMessage({status:'CREATED'},code));
  assert.equal(new Set(notices).size,11);assert.ok(notices.every(Boolean));
});
