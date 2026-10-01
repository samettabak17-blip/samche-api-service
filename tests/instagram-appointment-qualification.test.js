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
  const systemInstruction = 'APPOINTMENT STATE: intent=true; missing=meeting_reason';
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
});
