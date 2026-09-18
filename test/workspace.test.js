const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { openDatabase } = require('../src/db');
const { createMarketplaceRepository } = require('../src/marketplace-repository');
const { createAdminEvents } = require('../src/admin-events');
const { mountWorkspaceApi, validateListing } = require('../src/workspace-api');

const entry = { side: 'SELL', name: 'Test participant', phone: '+919000000001', commodity: 'Tomato', quantityKg: 500, location: 'Baroda', pricePerKg: 20 };
function fixture(t) {
  const db = openDatabase(':memory:'); t.after(()=>db.close());
  const market = createMarketplaceRepository(db);
  const app = express();
  mountWorkspaceApi(app, {db, marketplaceRepository:market, extractFarmerData:()=>({}), adminEvents:createAdminEvents()});
  function invoke(method,path,{body,params={},key='fixture-key-0001'}={}) {
    const handler=app._router.stack.find(layer=>layer.route?.path===path&&layer.route.methods[method]).route.stack[0].handle;
    let status=200, value;
    handler({body,params,get:()=>key},{status(code){status=code;return this;},json(data){value=data;return this;}});
    return {status,value};
  }
  return {db,market,invoke};
}
test('listing validation rejects invalid quantities, prices, identities and phone formats',()=>{
  for(const body of [{...entry,quantityKg:-5},{...entry,quantityKg:'Infinity'},{...entry,pricePerKg:-1},{...entry,name:''},{...entry,phone:'1234'},{...entry,side:'OTHER'}])assert.throws(()=>validateListing(body));
  assert.equal(validateListing(entry).location,'Vadodara');
});
test('admin listing creation persists real records and retries do not duplicate them',t=>{
  const {db,market,invoke}=fixture(t);
  const created=invoke('post','/api/admin/listings',{body:entry});
  assert.equal(created.status,201);
  assert.equal(created.value.listing.verified,0);
  assert.equal(created.value.listing.demo_seed_key,null);
  assert.equal(invoke('post','/api/admin/listings',{body:entry}).value.duplicate,true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM trade_listings').get().n,1);
  assert.equal(market.getEligibleListings('SELL','Tomato').length,1);
  invoke('patch','/api/admin/listings/:id',{body:{active:false},params:{id:created.value.listing.id}});
  assert.equal(market.getEligibleListings('SELL','Tomato').length,0);
  invoke('patch','/api/admin/listings/:id',{body:{active:true},params:{id:created.value.listing.id}});
  assert.equal(market.getEligibleListings('SELL','Tomato').length,1);
});
test('historical sample marketplace records are excluded from production matching and admin listings',t=>{
  const {market,invoke}=fixture(t);market.seedDemoMarketplace();
  assert.deepEqual(market.getEligibleListings('BUY','Tomato'),[]);
  assert.deepEqual(invoke('get','/api/admin/workspace').value.listings,[]);
  assert.equal(invoke('get','/api/admin/workspace').value.sampleListingsExcluded,20);
});
test('new real buyer and seller listings match in both directions; paused listings do not match',t=>{
  const {invoke}=fixture(t);
  const seller=invoke('post','/api/admin/listings',{body:entry});
  const buyer=invoke('post','/api/admin/listings',{body:{...entry,side:'BUY',phone:'+919000000002'},key:'fixture-key-0002'});
  const matches=id=>invoke('get','/api/admin/listings/:id/matches',{params:{id:String(id)}}).value.matches;
  assert.equal(matches(seller.value.listing.id).length,1);
  assert.equal(matches(buyer.value.listing.id).length,1);
  invoke('patch','/api/admin/listings/:id',{body:{active:false},params:{id:buyer.value.listing.id}});
  assert.equal(matches(seller.value.listing.id).length,0);
  assert.equal(matches(buyer.value.listing.id).length,0);
});
