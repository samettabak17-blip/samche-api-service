import test from 'node:test';
import assert from 'node:assert/strict';
import {
  updateSessionBrowsingState,
  buildContextualIntelligencePromptSection,
  formatVisitorContextForHandoff,
} from '../services/contextual-intelligence-service.js';

test('Real Estate stress test: Project A -> Project B -> investment comparison', () => {
  let sessionState = null;

  // Step 1: Visitor browses to Project A page
  sessionState = updateSessionBrowsingState({
    currentState: sessionState,
    rawPageContext: {
      url: 'https://example.com/projects/creek-vista',
      path: '/projects/creek-vista',
      title: 'Creek Vista Residences - Ready Luxury Apartments',
      entity_type: 'PROJECT',
      entity_id: 'proj_creek_vista',
      entity_name: 'Creek Vista Residences',
      summary: 'Waterfront residential tower with completed luxury apartments.',
      attributes: {
        location: 'Dubai Creek Harbour',
        starting_price: '1,800,000 AED',
        bedrooms: '1-3 Bedrooms',
        status: 'Ready to Move',
        handover: 'Completed (2024)',
        amenities: ['Private Marina', 'Infinity Pool'],
      },
    },
  });

  assert.equal(sessionState.currentEntity.entity_name, 'Creek Vista Residences');
  assert.equal(sessionState.previousEntities.length, 0);

  // Step 2: Visitor navigates to Project B page
  sessionState = updateSessionBrowsingState({
    currentState: sessionState,
    rawPageContext: {
      url: 'https://example.com/projects/palm-azure',
      path: '/projects/palm-azure',
      title: 'Palm Azure Tower - Off-plan Beachfront Investment',
      entity_type: 'PROJECT',
      entity_id: 'proj_palm_azure',
      entity_name: 'Palm Azure Tower',
      summary: 'High-yield beachfront off-plan development with post-handover payment.',
      attributes: {
        location: 'Palm Jumeirah',
        starting_price: '2,900,000 AED',
        bedrooms: '2-4 Bedrooms',
        status: 'Off-Plan',
        handover: 'Q4 2027',
        amenities: ['Private Beach Access', 'Sky Lounge'],
      },
    },
  });

  assert.equal(sessionState.currentEntity.entity_name, 'Palm Azure Tower');
  assert.equal(sessionState.previousEntities.length, 1);
  assert.equal(sessionState.previousEntities[0].entity_name, 'Creek Vista Residences');

  // Step 3: Visitor asks: "Hangisi yatırım için daha mantıklı?" (Which is better for investment?)
  const promptSection = buildContextualIntelligencePromptSection({
    currentEntity: sessionState.currentEntity,
    previousEntities: sessionState.previousEntities,
    locale: 'tr',
    channelType: 'WEB_CHAT',
  });

  assert.match(promptSection, /Palm Azure Tower/);
  assert.match(promptSection, /Creek Vista Residences/);
  assert.match(promptSection, /\[CURRENT VISITOR PAGE \/ ACTIVE ENTITY\]/);
  assert.match(promptSection, /\[PREVIOUSLY VIEWED ENTITIES IN THIS SESSION \(ORDERED BY RECENCY\)\]/);
  assert.match(promptSection, /Palm Jumeirah/);
  assert.match(promptSection, /Dubai Creek Harbour/);
  assert.match(promptSection, /2,900,000 AED/);
  assert.match(promptSection, /1,800,000 AED/);
  assert.match(promptSection, /Off-Plan/);
  assert.match(promptSection, /Ready to Move/);
  assert.match(promptSection, /NEVER invent or hallucinate missing facts/);
  assert.match(promptSection, /FACT vs RECOMMENDATION/);
  assert.match(promptSection, /MULTI-ENTITY COMPARISON/);
  assert.match(promptSection, /viewing request or live customer representative connection/);

  // Step 4: Human handoff context preservation
  const handoffSummary = formatVisitorContextForHandoff(sessionState);
  assert.equal(handoffSummary.current_entity.name, 'Palm Azure Tower');
  assert.equal(handoffSummary.previous_entities.length, 1);
  assert.equal(handoffSummary.previous_entities[0].name, 'Creek Vista Residences');
  assert.match(handoffSummary.summary_text, /Visitor was viewing Palm Azure Tower/);
  assert.match(handoffSummary.summary_text, /Previously viewed: Creek Vista Residences/);
});

test('Real Estate session isolation: two different visitors browsing different projects do not leak state', () => {
  let visitor1State = null;
  let visitor2State = null;

  visitor1State = updateSessionBrowsingState({
    currentState: visitor1State,
    rawPageContext: {
      url: '/projects/project-x',
      entity_id: 'proj_x',
      entity_name: 'Project X',
      entity_type: 'PROJECT',
      attributes: { location: 'Downtown' },
    },
  });

  visitor2State = updateSessionBrowsingState({
    currentState: visitor2State,
    rawPageContext: {
      url: '/projects/project-y',
      entity_id: 'proj_y',
      entity_name: 'Project Y',
      entity_type: 'PROJECT',
      attributes: { location: 'Marina' },
    },
  });

  assert.equal(visitor1State.currentEntity.entity_name, 'Project X');
  assert.equal(visitor2State.currentEntity.entity_name, 'Project Y');

  const prompt1 = buildContextualIntelligencePromptSection({
    currentEntity: visitor1State.currentEntity,
    previousEntities: visitor1State.previousEntities,
  });
  const prompt2 = buildContextualIntelligencePromptSection({
    currentEntity: visitor2State.currentEntity,
    previousEntities: visitor2State.previousEntities,
  });

  assert.match(prompt1, /Project X/);
  assert.doesNotMatch(prompt1, /Project Y/);

  assert.match(prompt2, /Project Y/);
  assert.doesNotMatch(prompt2, /Project X/);
});
