import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveInstagramLeadQualification,
  extractEmailFromText,
  extractCustomerNameFromText,
  extractMeetingTimePreference,
  extractPhoneNumberFromText,
} from '../services/high-intent-lead-service.js';
import {
  buildInstagramPersonalPersonaInstruction,
  buildInstagramPersonalAssistantPersonaInstruction,
  buildInstagramChannelRules,
  buildStructuredMemoryInstruction,
  sanitizeInstagramOutboundResponse,
  formatInstagramDmResponse,
} from '../services/instagram-ai-orchestrator.js';
import {
  SAMCHE_STAGING_BUSINESS_PROFILE,
  SAMCHE_STAGING_ASSISTANT_CONFIG,
} from '../services/samche-canonical-knowledge-data.js';

const SAMCHE_INSTAGRAM_CONFIG = SAMCHE_STAGING_ASSISTANT_CONFIG.channel_adaptations.instagram;

// ==================================================
// SECTION 22: EXACT PHYSICAL REGRESSION TEST
// ==================================================
test('PHYSICAL REGRESSION TURN 1 — "Dubai\'de şirket kurmak istiyorum Samed bey. Müsait zamanda görüşmemiz mümkün mü?"', () => {
  const turn1Text = "Dubai'de şirket kurmak istiyorum Samed bey. Müsait zamanda görüşmemiz mümkün mü?";
  const isFirstAssistantResponse = true;

  const personaInstruction = buildInstagramPersonalPersonaInstruction(SAMCHE_INSTAGRAM_CONFIG, { isFirstAssistantResponse });
  assert.ok(personaInstruction.includes("Samed Bey'in kişisel asistanı"), 'Must establish personal assistant role');
  assert.ok(personaInstruction.includes("Merhaba, ben Samed Bey'in kişisel asistanıyım."), 'First turn must introduce as personal assistant');
  assert.ok(personaInstruction.includes("FIRST RESPONSE IN NEW CONVERSATION"));

  const qualification = deriveInstagramLeadQualification({
    customerMessages: [turn1Text],
    currentMessage: turn1Text,
    fullIntake: true,
  });

  assert.equal(qualification.hasHighIntent, true, 'Meeting intent must be detected');
  assert.equal(qualification.purposeKnown, true, 'Company formation purpose must be recognized');
  assert.equal(qualification.serviceRequested, 'Şirket Kuruluşu');
  assert.equal(qualification.qualificationContextKnown, false, 'Activity/sector not yet specified');
  assert.equal(qualification.complete, false, 'Intake must NOT be complete yet');
  assert.equal(qualification.preferredDate, null, 'No date yet provided');
  assert.equal(qualification.preferredTime, null, 'No time yet provided');

  assert.ok(qualification.missing.includes('QUALIFICATION_CONTEXT'), 'Must require qualification context');
  assert.ok(qualification.missing.includes('CUSTOMER_PHONE'), 'Must require phone');
  assert.ok(qualification.missing.includes('CUSTOMER_EMAIL'), 'Must require email');

  const memoryInstruction = buildStructuredMemoryInstruction({
    serviceRequested: qualification.serviceRequested,
    appointmentState: qualification,
  });

  assert.ok(memoryInstruction.includes('QUALIFY BEFORE SCHEDULING'), 'Must instruct qualification before scheduling');
  assert.ok(memoryInstruction.includes('Şirket Kuruluşu'), 'Must recognize company formation');
  assert.doesNotMatch(memoryInstruction, /confirmed appointment/i);
});

test('PHYSICAL REGRESSION TURN 2 — "Yarın 12 gibi uygunum" preserves approximate time, requests missing context, no fake calendar check', () => {
  const turn1Text = "Dubai'de şirket kurmak istiyorum Samed bey. Müsait zamanda görüşmemiz mümkün mü?";
  const turn2Text = "Yarın 12 gibi uygunum";
  const isFirstAssistantResponse = false;

  const personaInstruction = buildInstagramPersonalPersonaInstruction(SAMCHE_INSTAGRAM_CONFIG, { isFirstAssistantResponse });
  assert.ok(personaInstruction.includes("DO NOT repeat your introduction"), 'Must forbid repeating introduction on subsequent turn');

  const qualification = deriveInstagramLeadQualification({
    customerMessages: [turn1Text, turn2Text],
    currentMessage: turn2Text,
    fullIntake: true,
  });

  assert.equal(qualification.hasHighIntent, true);
  assert.equal(qualification.purposeKnown, true);
  assert.equal(qualification.preferredDate, 'yarın');
  assert.equal(qualification.preferredTime, '12 gibi');
  assert.equal(qualification.timePrecision, 'APPROXIMATE');
  assert.equal(qualification.calendarConfirmed, false);
  assert.equal(qualification.calendarAvailabilityVerified, false);
  assert.equal(qualification.complete, false, 'Still incomplete because name, phone, email, and context are missing');

  assert.ok(qualification.missing.includes('CUSTOMER_NAME'));
  assert.ok(qualification.missing.includes('CUSTOMER_PHONE'));
  assert.ok(qualification.missing.includes('CUSTOMER_EMAIL'));

  const rawModelResponse = 'Yarın saat 12:00 civarı için takvim uygunluğumu kontrol ettim ve randevunuz onaylandı.';
  const sanitized = sanitizeInstagramOutboundResponse(rawModelResponse);
  assert.doesNotMatch(sanitized, /takvim uygunluğu|randevunuz onaylandı/i);
});

// ==================================================
// SECTION 23: REQUIRED APPOINTMENT TEST MATRIX
// ==================================================
test('MATRIX A — Unknown meeting purpose ("Görüşebilir miyiz?") identifies as personal assistant and requires purpose first', () => {
  const query = 'Görüşebilir miyiz?';
  const qualification = deriveInstagramLeadQualification({
    customerMessages: [query],
    currentMessage: query,
    fullIntake: true,
  });

  assert.equal(qualification.hasHighIntent, true);
  assert.equal(qualification.purposeKnown, false, 'Purpose must be unknown');
  assert.ok(qualification.missing.includes('MEETING_PURPOSE'), 'Must require MEETING_PURPOSE first');
  assert.equal(qualification.complete, false);
});

test('MATRIX B — Known purpose ("Dubai\'de şirket kurmak istiyorum. Görüşebilir miyiz?") recognizes subject and requires qualification context', () => {
  const query = "Dubai'de şirket kurmak istiyorum. Görüşebilir miyiz?";
  const qualification = deriveInstagramLeadQualification({
    customerMessages: [query],
    currentMessage: query,
    fullIntake: true,
  });

  assert.equal(qualification.purposeKnown, true);
  assert.equal(qualification.serviceRequested, 'Şirket Kuruluşu');
  assert.ok(qualification.missing.includes('QUALIFICATION_CONTEXT'));
  assert.equal(qualification.complete, false);
});

test('MATRIX C — Date supplied too early ("Yarın 12\'de görüşelim") stores preference and continues missing intake', () => {
  const query = "Yarın 12'de görüşelim.";
  const qualification = deriveInstagramLeadQualification({
    customerMessages: [query],
    currentMessage: query,
    fullIntake: true,
  });

  assert.equal(qualification.preferredDate, 'yarın');
  assert.equal(qualification.preferredTime, '12');
  assert.equal(qualification.complete, false);
  assert.ok(qualification.missing.includes('MEETING_PURPOSE'));
  assert.ok(qualification.missing.includes('CUSTOMER_PHONE'));
  assert.ok(qualification.missing.includes('CUSTOMER_EMAIL'));
});
test('MATRIX D — Contact info supplied first ("Ben Ali, 05551234567, ali@example.com Görüşmek istiyorum.") does not re-ask known contact fields', () => {
  const query = 'Ben Ali, 05551234567, ali@example.com Görüşmek istiyorum.';
  const qualification = deriveInstagramLeadQualification({
    customerMessages: [query],
    currentMessage: query,
    fullIntake: true,
  });

  assert.equal(qualification.customerName, 'Ali');
  assert.equal(qualification.phone, '05551234567');
  assert.equal(qualification.email, 'ali@example.com');
  assert.equal(qualification.missing.includes('CUSTOMER_NAME'), false, 'Name must not be missing');
  assert.equal(qualification.missing.includes('CUSTOMER_PHONE'), false, 'Phone must not be missing');
  assert.equal(qualification.missing.includes('CUSTOMER_EMAIL'), false, 'Email must not be missing');

  assert.ok(qualification.missing.includes('MEETING_PURPOSE'));
  assert.ok(qualification.missing.includes('PREFERRED_DATE'));
  assert.ok(qualification.missing.includes('PREFERRED_TIME'));
  assert.equal(qualification.complete, false);
});

test('MATRIX E — Complete intake: all required fields present produces complete intake state', () => {
  const messages = [
    "Dubai'de şirket kurmak istiyorum Samed bey. Müsait zamanda görüşmemiz mümkün mü?",
    "Yazılım ve teknoloji alanında faaliyet göstereceğiz, 2 ortağız.",
    "Adım Ali Kaya, telefonum 05559876543, e-postam ali.kaya@example.com, yarın saat 15:00 uygunum."
  ];

  const qualification = deriveInstagramLeadQualification({
    customerMessages: messages,
    currentMessage: messages[2],
    fullIntake: true,
  });

  assert.equal(qualification.hasHighIntent, true);
  assert.equal(qualification.purposeKnown, true);
  assert.equal(qualification.qualificationContextKnown, true);
  assert.equal(qualification.customerName, 'Ali Kaya');
  assert.equal(qualification.phone, '05559876543');
  assert.equal(qualification.email, 'ali.kaya@example.com');
  assert.equal(qualification.preferredDate, 'yarın');
  assert.match(qualification.preferredTime, /15:00/);
  assert.equal(qualification.missing.length, 0, 'No fields missing');
  assert.equal(qualification.complete, true, 'Intake is complete');
  assert.equal(qualification.status, 'READY_FOR_REQUEST');

  const summaryResponse = `Görüşme talebiniz:
• İsim: Ali Kaya
• Telefon: 05559876543
• E-posta: ali.kaya@example.com
• Konu: Şirket Kuruluşu
• İhtiyaç özeti: Yazılım ve teknoloji, 2 ortak
• Tercih edilen tarih: Yarın
• Tercih edilen saat: 15:00

Bilgilerinizi Samed Bey'e ileteceğim. Kendisi sizinle görüşmek üzere iletişime geçecek.`;

  const sanitized = sanitizeInstagramOutboundResponse(summaryResponse);
  assert.ok(sanitized.includes("Samed Bey'e ileteceğim. Kendisi sizinle görüşmek üzere iletişime geçecek."));
});

test('MATRIX F — Approximate time ("14 gibi") preserves approximately 14:00 and never converts to verified slot', () => {
  const time = extractMeetingTimePreference('yarın 14 gibi');
  assert.equal(time, 'yarın 14 gibi');

  const qualification = deriveInstagramLeadQualification({
    customerMessages: ['yarın 14 gibi uygun olur'],
    currentMessage: 'yarın 14 gibi uygun olur',
    fullIntake: true,
  });

  assert.equal(qualification.preferredDate, 'yarın');
  assert.equal(qualification.preferredTime, '14 gibi');
  assert.equal(qualification.timePrecision, 'APPROXIMATE');
  assert.equal(qualification.calendarConfirmed, false);
});

test('MATRIX G & H — No email or no phone leaves intake incomplete', () => {
  const noEmail = deriveInstagramLeadQualification({
    customerMessages: ['Ben Kemal, numaram 05551112233, yarın 11:00 yazılım şirketi için görüşebilir miyiz?'],
    currentMessage: 'Ben Kemal, numaram 05551112233, yarın 11:00 yazılım şirketi için görüşebilir miyiz?',
    fullIntake: true,
  });

  assert.equal(noEmail.customerName, 'Kemal');
  assert.equal(noEmail.phone, '05551112233');
  assert.equal(noEmail.email, null);
  assert.ok(noEmail.missing.includes('CUSTOMER_EMAIL'));
  assert.equal(noEmail.complete, false, 'Must not be complete without email');

  const noPhone = deriveInstagramLeadQualification({
    customerMessages: ['Ben Kemal, kemal@test.com, yarın 11:00 yazılım şirketi için görüşebilir miyiz?'],
    currentMessage: 'Ben Kemal, kemal@test.com, yarın 11:00 yazılım şirketi için görüşebilir miyiz?',
    fullIntake: true,
  });

  assert.equal(noPhone.email, 'kemal@test.com');
  assert.equal(noPhone.phone, null);
  assert.ok(noPhone.missing.includes('CUSTOMER_PHONE'));
  assert.equal(noPhone.complete, false, 'Must not be complete without phone');
});

test('MATRIX I — Appointment + living costs: appointment intake works and YouTube link appears exactly once', () => {
  const mixedInbound = "Dubai'de kiralar ve yaşam masrafları nasıl? Bir de şirket kurmak istiyorum, müsait zamanda görüşebilir miyiz?";
  const qualification = deriveInstagramLeadQualification({
    customerMessages: [mixedInbound],
    currentMessage: mixedInbound,
    fullIntake: true,
  });

  assert.equal(qualification.hasHighIntent, true, 'Meeting intent detected');

  const rawModelResponse = `Dubai'de yaşam masrafları yaşam tarzınıza ve tercih edeceğiniz bölgeye göre değişir. 1+1 daire kiraları yıllık ortalama 45.000 - 75.000 AED civarındadır.

Dubai'de yaşam giderleri ve kiralar hakkında daha fazla bilgi edinmek isterseniz YouTube sayfamı ziyaret edebilirsiniz, orada detaylı anlattım.

https://ytbe.app/u9j8qB2S

Şirket kuruluşuyla ilgili görüşme talebinizi Samed Bey'e iletebilmem için kurmayı düşündüğünüz şirketin faaliyet alanını paylaşabilir misiniz?`;

  const formatted = formatInstagramDmResponse(rawModelResponse, {
    customerIntent: mixedInbound,
    supplementaryResources: SAMCHE_INSTAGRAM_CONFIG.supplementary_resources,
  });

  const matches = formatted.match(/https:\/\/ytbe\.app\/u9j8qB2S/g);
  assert.equal(matches ? matches.length : 0, 1, 'YouTube URL must appear exactly once');
  assert.ok(formatted.includes('YouTube sayfamı ziyaret edebilirsiniz'));
  assert.ok(formatted.includes("Samed Bey'e iletebilmem için"));
});

test('MATRIX J — Appointment + Reel history: appointment qualification functions smoothly', () => {
  const reelMessage = {
    sender_type: 'CUSTOMER',
    content: '[attachment: reel_share]',
    resources: [{ metadata: { shared_content: { type: 'reel', caption: 'Dubai Free Zone Şirket Avantajları' } } }]
  };
  const meetingMessage = {
    sender_type: 'CUSTOMER',
    content: 'Bu konu hakkında Samed Bey ile görüşebilir miyiz?'
  };

  const qualification = deriveInstagramLeadQualification({
    customerMessages: [reelMessage, meetingMessage],
    currentMessage: meetingMessage.content,
    activeConversationTopic: 'Dubai Free Zone Şirket Avantajları',
    fullIntake: true,
  });

  assert.equal(qualification.hasHighIntent, true);
  assert.equal(qualification.purposeKnown, true);
  assert.equal(qualification.meetingReason, 'Dubai Free Zone Şirket Avantajları');
});

// ==================================================
// SECTION 24: PERSONAL ASSISTANT TESTS
// ==================================================
test('PERSONAL ASSISTANT — First natural response introduces as personal assistant', () => {
  const personaInstruction = buildInstagramPersonalPersonaInstruction(SAMCHE_INSTAGRAM_CONFIG, { isFirstAssistantResponse: true });
  assert.ok(personaInstruction.includes("Merhaba, ben Samed Bey'in kişisel asistanıyım."));
  assert.ok(personaInstruction.includes("FIRST RESPONSE IN NEW CONVERSATION"));
});

test('PERSONAL ASSISTANT — Second/third response does NOT repeat introduction', () => {
  const personaInstruction = buildInstagramPersonalPersonaInstruction(SAMCHE_INSTAGRAM_CONFIG, { isFirstAssistantResponse: false });
  assert.ok(personaInstruction.includes("DO NOT repeat your introduction"));
  assert.ok(personaInstruction.includes("ONGOING CONVERSATION"));
});

test('PERSONAL ASSISTANT — Explicit inquiry ("Samed Bey ile mi konuşuyorum?") forbids impersonation and clarifies assistant identity', () => {
  const personaInstruction = buildInstagramPersonalPersonaInstruction(SAMCHE_INSTAGRAM_CONFIG, { isFirstAssistantResponse: false });
  assert.ok(personaInstruction.includes('NEVER IMPERSONATE SAMED TABAK'));
  assert.ok(personaInstruction.includes('Hayır, ben Samed Bey\'in kişisel asistanıyım.'));
});

// ==================================================
// GENERIC ARCHITECTURE TEST: SECOND TENANT VERIFICATION
// ==================================================
test('GENERIC ARCHITECTURE — Second tenant with custom speaker and assistant persona works completely generically', () => {
  const tenantBConfig = {
    persona_type: 'PERSONAL_ASSISTANT',
    speaker_name: 'Dr. Ahmet Yılmaz',
    represented_person: 'Ahmet Bey',
    personal_assistant_title: "Ahmet Bey'in danışmanlık asistanı",
    initial_greeting_introduction: "Merhaba, ben Ahmet Bey'in danışmanlık asistanıyım.",
    meeting_handoff_wording: "Talebinizi aldıktan sonra Ahmet Bey'e sunacağım. Kendisi sizinle iletişime geçecek.",
  };

  const instructionFirstTurn = buildInstagramPersonalPersonaInstruction(tenantBConfig, { isFirstAssistantResponse: true });
  assert.ok(instructionFirstTurn.includes("Ahmet Bey'in danışmanlık asistanı"));
  assert.ok(instructionFirstTurn.includes("Merhaba, ben Ahmet Bey'in danışmanlık asistanıyım."));
  assert.ok(instructionFirstTurn.includes("Ahmet Bey'e sunacağım"));
  assert.doesNotMatch(instructionFirstTurn, /Samed Tabak/i);
  assert.doesNotMatch(instructionFirstTurn, /SamChe/i);

  const instructionOngoing = buildInstagramPersonalPersonaInstruction(tenantBConfig, { isFirstAssistantResponse: false });
  assert.ok(instructionOngoing.includes("DO NOT repeat your introduction"));
  assert.doesNotMatch(instructionOngoing, /Samed Tabak/i);
});

