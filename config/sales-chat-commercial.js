// Server-owned Sales Chat facts. Keep these values in parity with the public
// SamChe website; clients may never provide or override them.
export const salesChatCommercialFacts = {
  plans: [
    { slug: 'starter', name: 'STARTER', monthly: 1790, setup: 2500, interactions: '5,000', yearly: 18258, features: ['Up to 2 Languages', '1 Web Chatbot (1 site)', 'Knowledge Intelligence', 'Page-aware Context', 'Basic Lead Capture', 'Human Handover', 'Standard Support'] },
    { slug: 'growth', name: 'GROWTH', monthly: 3990, setup: 5000, interactions: '20,000', yearly: 40698, features: ['Up to 3 Languages', 'Web Chatbot + WhatsApp AI', 'Advanced Knowledge Intelligence', '1 CRM OR Booking Integration', 'SamChe Shared Inbox', 'Lead Qualification & Routing', 'Up to 5 Team Users'] },
    { slug: 'business', name: 'BUSINESS', monthly: 7990, setup: 9500, interactions: '50,000', yearly: 81498, features: ['Up to 5 Languages', 'Web + WA + AI Guide Channels', 'Entity-aware Intelligence', 'Up to 3 External Integrations', 'AI Lead Scoring', 'API Access & Custom Workflows', 'Up to 10 Team Users'] },
    { slug: 'enterprise', name: 'ENTERPRISE', monthly: 12500, setup: 20000, interactions: '100,000+', yearly: 127500, from: true, features: ['Custom AI Interactions limit', 'Multiple Brands/Sites', 'Extended Multilingual Support', 'ERP & Payment Integrations', 'Advanced Enterprise Controls', 'Dedicated Enterprise Support', 'Custom Data Retention'] },
  ],
  products: [
    { name: 'Web Chatbot', status: 'Available' },
    { name: 'WhatsApp AI', status: 'Available' },
    { name: 'Dashboard & Tenant Analytics', status: 'Available' },
    { name: 'AI Assistants', status: 'Available' },
    { name: 'Knowledge Intelligence', status: 'Available' },
    { name: 'Live Inbox', status: 'Available' },
    { name: 'CRM & Pipeline', status: 'Available' },
    { name: 'AI Guide', status: 'Available' },
    { name: 'Automation / Agentic AI', status: 'Roadmap / Upcoming' },
  ],
};
