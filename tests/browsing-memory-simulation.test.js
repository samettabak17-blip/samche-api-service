import test from 'node:test';
import assert from 'node:assert/strict';
import {
  updateSessionBrowsingState,
  buildContextualIntelligencePromptSection,
} from '../services/contextual-intelligence-service.js';

test('Simulate navigation A -> B -> C and check browsing memory and multi-entity recency', () => {
  const contextA = {
    url: 'https://samche-api-staging.onrender.com/task8-demo/#/urun/titan-akilli-saat-pro',
    path: '/task8-demo/#/urun/titan-akilli-saat-pro',
    title: 'SamChe Titan Akıllı Saat Pro - SamChe Teknoloji',
    entity_type: 'Product',
    entity_name: 'SamChe Titan Akıllı Saat Pro',
    entity_id: 'prod-smartwatch-titan',
    summary: '1.43 inç AMOLED ekran, safir cam, titanyum kasa. 14 gün pil ömrü, 5 ATM su geçirmezlik.',
    attributes: {
      price: 2499,
      currency: 'TRY',
      category: 'Giyilebilir Teknoloji',
      battery_days: 14,
      waterproof_atm: 5,
    },
  };

  const contextB = {
    url: 'https://samche-api-staging.onrender.com/task8-demo/#/urun/ultra-guc-bankasi-20000mah',
    path: '/task8-demo/#/urun/ultra-guc-bankasi-20000mah',
    title: 'Ultra Güç Bankası 20.000 mAh - SamChe Teknoloji',
    entity_type: 'Product',
    entity_name: 'Ultra Güç Bankası 20.000 mAh',
    entity_id: 'prod-powerbank-20k',
    summary: '20.000 mAh yüksek kapasite, 65W Power Delivery Type-C. Kablosuz şarj KESİNLİKLE BULUNMAMAKTADIR.',
    attributes: {
      price: 899,
      currency: 'TRY',
      category: 'Şarj Cihazları',
      wireless_charging: false,
      capacity_mah: 20000,
    },
  };

  const contextC = {
    url: 'https://samche-api-staging.onrender.com/task8-demo/#/urun/ses-pro-kablosuz-kulaklik-anc',
    path: '/task8-demo/#/urun/ses-pro-kablosuz-kulaklik-anc',
    title: 'SamChe Ses Pro Kablosuz Kulaklık ANC - SamChe Teknoloji',
    entity_type: 'Product',
    entity_name: 'SamChe Ses Pro Kablosuz Kulaklık ANC',
    entity_id: 'prod-anc-earbuds',
    summary: 'Hibrit Aktif Gürültü Engelleme (ANC), 40 saat toplam çalma süresi.',
    attributes: {
      price: 1799,
      currency: 'TRY',
      category: 'Ses Sistemleri',
      anc_db: 40,
    },
  };

  // 1. Visit A
  let state = updateSessionBrowsingState({ currentState: null, rawPageContext: contextA });
  assert.equal(state.currentEntity.entity_name, 'SamChe Titan Akıllı Saat Pro');
  assert.equal(state.previousEntities.length, 0);

  // 2. Visit B
  state = updateSessionBrowsingState({ currentState: state, rawPageContext: contextB });
  assert.equal(state.currentEntity.entity_name, 'Ultra Güç Bankası 20.000 mAh');
  assert.equal(state.previousEntities.length, 1);
  assert.equal(state.previousEntities[0].entity_name, 'SamChe Titan Akıllı Saat Pro');

  // Check section when on B
  const sectionB = buildContextualIntelligencePromptSection({
    currentEntity: state.currentEntity,
    previousEntities: state.previousEntities,
    channelType: 'WEB_CHAT',
  });
  assert.ok(sectionB.includes('CURRENT VISITOR PAGE / ACTIVE ENTITY'));
  assert.ok(sectionB.includes('Ultra Güç Bankası 20.000 mAh'));
  assert.ok(sectionB.includes('PREVIOUSLY VIEWED ENTITIES IN THIS SESSION'));
  assert.ok(sectionB.includes('SamChe Titan Akıllı Saat Pro'));
  assert.ok(sectionB.includes('price: 899'));
  assert.ok(sectionB.includes('price: 2499'));

  // 3. Visit C
  state = updateSessionBrowsingState({ currentState: state, rawPageContext: contextC });
  assert.equal(state.currentEntity.entity_name, 'SamChe Ses Pro Kablosuz Kulaklık ANC');
  assert.equal(state.previousEntities.length, 2);
  assert.equal(state.previousEntities[0].entity_name, 'Ultra Güç Bankası 20.000 mAh');
  assert.equal(state.previousEntities[1].entity_name, 'SamChe Titan Akıllı Saat Pro');

  // Check section when on C
  const sectionC = buildContextualIntelligencePromptSection({
    currentEntity: state.currentEntity,
    previousEntities: state.previousEntities,
    channelType: 'WEB_CHAT',
  });
  assert.ok(sectionC.includes('SamChe Ses Pro Kablosuz Kulaklık ANC'));
  assert.ok(sectionC.includes('1. Ultra Güç Bankası 20.000 mAh'));
  assert.ok(sectionC.includes('2. SamChe Titan Akıllı Saat Pro'));
});
