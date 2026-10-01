import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveInstagramLeadQualification,
  extractMeetingTimePreference,
} from '../services/high-intent-lead-service.js';
import {
  buildStructuredMemoryInstruction,
  generateContextualConversationalFallback,
} from '../services/instagram-ai-orchestrator.js';
import { createSharedAiRuntime } from '../services/shared-ai-provider-resilience.js';

const CONTACT_PHONE = '+971501234567';

const PHYSICAL_MEETING_REQUEST = 'Samet bey merhaba YouTube videolarınızı izledim sizinle görüşebilir miyiz müsait zamanınızda?';

test('physical meeting request asks for purpose first and never invents a slot', () => {
  const qualification = deriveInstagramLeadQualification({
    customerMessages: [PHYSICAL_MEETING_REQUEST],
  });
  const response = generateContextualConversationalFallback({
    text: PHYSICAL_MEETING_REQUEST,
    memory: { appointmentState: qualification },
  });
  const instruction = buildStructuredMemoryInstruction({ appointmentState: qualification });

  assert.equal(qualification.hasHighIntent, true);
  assert.equal(qualification.purposeKnown, false);
  assert.equal(qualification.preferredDate, null);
  assert.equal(qualification.preferredTime, null);
  assert.equal(qualification.calendarAvailabilityVerified, false);
  assert.match(response, /konu|amaç/i);
  assert.doesNotMatch(response, /(?:bugün|yarın|18[:.]00|14[:.]00|saat\s+\d{1,2}|uygun.*saat)/i);
  assert.match(instruction, /preferred_date=UNKNOWN/);
  assert.match(instruction, /preferred_time=UNKNOWN/);
  assert.match(instruction, /calendarAvailabilityVerified=false/);
  assert.match(instruction, /never propose|never invent/i);
});

test('known purpose without time asks for user availability without proposing a slot', () => {
  const qualification = deriveInstagramLeadQualification({
    customerMessages: ['Şirket kuruluşu hakkında görüşmek istiyorum.'],
  });
  const response = generateContextualConversationalFallback({
    text: 'Şirket kuruluşu hakkında görüşmek istiyorum.',
    memory: { appointmentState: qualification },
  });

  assert.equal(qualification.purposeKnown, true);
  assert.equal(qualification.preferredDate, null);
  assert.equal(qualification.preferredTime, null);
  assert.match(response, /gün|saat|zaman|uygun/i);
  assert.doesNotMatch(response, /(?:bugün|yarın|18[:.]00|14[:.]00|saat\s+\d{1,2})/i);
});

test('new explicit meeting request does not inherit stale appointment preference', () => {
  const historical = [
    'Şirket kuruluşu hakkında görüşmek istiyorum. Yarın 18:00 uygunum.',
    PHYSICAL_MEETING_REQUEST,
  ];
  const qualification = deriveInstagramLeadQualification({
    customerMessages: historical,
    currentMessage: PHYSICAL_MEETING_REQUEST,
  });

  assert.equal(qualification.purposeKnown, false);
  assert.equal(qualification.requestedTime, null);
  assert.equal(qualification.preferredDate, null);
  assert.equal(qualification.preferredTime, null);
});

test('current user time overrides an older appointment preference', () => {
  const qualification = deriveInstagramLeadQualification({
    customerMessages: [
      'Şirket kuruluşu hakkında görüşmek istiyorum. Yarın 18:00 uygunum.',
      'yarın 14 gibi uygun olur',
    ],
    currentMessage: 'yarın 14 gibi uygun olur',
  });

  assert.equal(qualification.requestedTime, 'yarın 14 gibi');
  assert.equal(qualification.preferredDate, 'yarın');
  assert.equal(qualification.preferredTime, '14 gibi');
  assert.equal(qualification.timePrecision, 'APPROXIMATE');
});

test('appointment purpose can come from the active conversation topic without re-asking', () => {
  const qualification = deriveInstagramLeadQualification({
    customerMessages: ['Mainland şirket kurmak istiyorum, 2 vizem olacak.', 'Samet Bey ile görüşebilir miyim?'],
    currentMessage: 'Samet Bey ile görüşebilir miyim?',
    activeConversationTopic: 'Mainland şirket kuruluşu / 2 vize',
  });
  const instruction = buildStructuredMemoryInstruction({ appointmentState: qualification });

  assert.equal(qualification.purposeKnown, true);
  assert.equal(qualification.purposeSource, 'ACTIVE_CONVERSATION_TOPIC');
  assert.equal(qualification.meetingReason, 'Mainland şirket kuruluşu / 2 vize');
  assert.doesNotMatch(instruction, /meeting_reason.*Unknown/i);
});

test('current user topic overrides an older active conversation topic', () => {
  const qualification = deriveInstagramLeadQualification({
    customerMessages: ['Samet Bey ile görüşebilir miyim?'],
    currentMessage: 'Aslında şirket kuruluşu hakkında görüşmek istiyorum.',
    activeConversationTopic: 'Sponsorlu oturum',
  });

  assert.equal(qualification.purposeKnown, true);
  assert.equal(qualification.purposeSource, 'CURRENT_USER_MESSAGE');
  assert.match(qualification.meetingReason, /şirket kuruluşu/i);
  assert.doesNotMatch(qualification.meetingReason, /sponsorlu oturum/i);
});

test('does not complete an Instagram appointment when the meeting purpose is unknown', () => {
  const qualification = deriveInstagramLeadQualification({
    contactPhone: CONTACT_PHONE,
    customerMessages: [
      'samed bey merhba..youtube videolarinizi izledim sizinle gorusebilir miyiz musait zamaninizda?',
      'yarin 14 gibi uygun olur',
    ],
  });

  assert.equal(qualification.hasHighIntent, true);
  assert.equal(qualification.purposeKnown, false);
  assert.equal(qualification.serviceInterest, null);
  assert.equal(qualification.preferredDate, 'yarın');
  assert.equal(qualification.preferredTime, '14 gibi');
  assert.equal(qualification.timePrecision, 'APPROXIMATE');
  assert.deepEqual(qualification.missing, ['MEETING_PURPOSE']);
  assert.equal(qualification.complete, false);
});

test('preserves approximate and exact appointment time semantics without calendar confirmation', () => {
  assert.equal(extractMeetingTimePreference('yarın 14 gibi'), 'yarın 14 gibi');
  assert.equal(extractMeetingTimePreference('yarın tam 14:00'), 'yarın tam 14:00');

  const exact = deriveInstagramLeadQualification({
    contactPhone: CONTACT_PHONE,
    customerMessages: ['Şirket kuruluşu hakkında görüşmek istiyorum. Yarın tam 14:00 uygunum.'],
  });

  assert.equal(exact.purposeKnown, true);
  assert.equal(exact.timePrecision, 'EXACT_PREFERENCE');
  assert.equal(exact.complete, true);
  assert.equal(exact.calendarConfirmed, false);
});

test('publishes canonical known and missing appointment fields to the provider-neutral prompt context', () => {
  const qualification = deriveInstagramLeadQualification({
    contactPhone: CONTACT_PHONE,
    customerMessages: [
      'samed bey merhba..youtube videolarinizi izledim sizinle gorusebilir miyiz musait zamaninizda?',
      'yarin 14 gibi uygun olur',
    ],
  });
  const instruction = buildStructuredMemoryInstruction({
    requestedTime: qualification.requestedTime,
    appointmentState: qualification,
  });

  assert.match(instruction, /APPOINTMENT QUALIFICATION STATE/);
  assert.match(instruction, /Appointment intent: TRUE/);
  assert.match(instruction, /Known fields: preferred_date=yarın, preferred_time=14 gibi/);
  assert.match(instruction, /Missing required fields: meeting_reason/);
  assert.match(instruction, /Qualification status: COLLECTING/);
  assert.match(instruction, /Qualification is incomplete while any required field is missing/);
  assert.match(instruction, /Service \/ Consultation Topic: Unknown/);
  assert.doesNotMatch(instruction, /Service \/ Consultation Topic: General Consultancy/);
  assert.doesNotMatch(instruction, /confirmed appointment/i);
});

test('fallback asks only for the missing meeting purpose and preserves approximate time', () => {
  const qualification = deriveInstagramLeadQualification({
    contactPhone: CONTACT_PHONE,
    customerMessages: [
      'samed bey merhba..youtube videolarinizi izledim sizinle gorusebilir miyiz musait zamaninizda?',
      'yarin 14 gibi uygun olur',
    ],
  });
  const response = generateContextualConversationalFallback({
    text: 'yarin 14 gibi uygun olur',
    memory: { requestedTime: qualification.requestedTime, appointmentState: qualification },
  });

  assert.match(response, /hangi konu|görüşmenin konusu|amacı/i);
  assert.match(response, /14:00 civarı|14 gibi|yaklaşık 14:00/i);
  assert.doesNotMatch(response, /onaylandı|kesinleştirdim|takvime ekledim/i);
});

test('Vertex timeout failover sends the same appointment context to OpenAI', async () => {
  const calls = [];
  const circuitBreaker = {
    getState: () => 'CLOSED',
    recordFailure: () => {},
    recordSuccess: () => {},
  };
  const systemInstruction = [
    'APPOINTMENT STATE: intent=true; missing=meeting_reason',
    'preferred_date=UNKNOWN; preferred_time=UNKNOWN; calendarAvailabilityVerified=false',
    'When date/time are UNKNOWN, never propose or invent a slot.',
  ].join('\n');
  const conversationHistory = [{ role: 'user', content: 'yarin 14 gibi uygun olur' }];
  const geminiProvider = {
    generateContent: async (request) => {
      calls.push({ provider: 'vertex', request });
      throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    },
  };
  const openaiClient = {
    chat: {
      completions: {
        create: async (request) => {
          calls.push({ provider: 'openai', request });
          return { choices: [{ message: { content: 'Hangi konu hakkında görüşmek istediğinizi paylaşabilir misiniz?' } }] };
        },
      },
    },
  };

  const result = await createSharedAiRuntime({
    geminiProvider,
    openaiClient,
    circuitBreaker,
    logger: { warn: () => {}, info: () => {}, error: () => {} },
  }).generateAiResponse({
    systemInstruction,
    text: 'yarin 14 gibi uygun olur',
    conversationHistory,
    channel: 'INSTAGRAM',
  });

  assert.equal(result.provider, 'openai');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].request.systemInstruction.parts[0].text, systemInstruction);
  assert.equal(calls[1].request.messages[0].content, systemInstruction);
  assert.match(JSON.stringify(calls[0].request), /yarin 14 gibi uygun olur/);
  assert.match(JSON.stringify(calls[1].request), /yarin 14 gibi uygun olur/);
  assert.match(JSON.stringify(calls[1].request), /calendarAvailabilityVerified=false/);
  assert.match(JSON.stringify(calls[1].request), /never propose or invent a slot/i);
});
