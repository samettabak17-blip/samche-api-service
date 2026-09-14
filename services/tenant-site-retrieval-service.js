/**
 * services/tenant-site-retrieval-service.js
 * Tenant-scoped query-time retrieval of relevant site-wide intelligence.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REVIEW_QUERY_PATTERN = /(?:reviews?|ratings?|feedback|testimonials?|what\s+do\s+(?:customers|shoppers|people|users)\s+say|what\s+are\s+the\s+user\s+reviews|customer\s+comments|yorum|değerlendirme|musteri|kullanıcı\s+yorumlar[ıi]|ne\s+diyor)/i;

const POLICY_QUERY_PATTERN = /(?:returns?|refunds?|warranty|guarantee|shipping\s+(?:policy|cutoff|time)|delivery\s+(?:cutoff|time)|same-day\s+(?:dispatch|delivery)|cutoff|iade|kargo|garanti|teslimat|değişim)/i;

const CONTACT_QUERY_PATTERN = /(?:contact|reach\s+us|phone|call|email|address|location|office|hub|fulfillment\s+hub|hours|operating\s+hours|helpdesk|iletişim|telefon|adres|merkez|saatler)/i;

const PRODUCT_QUERY_PATTERN = /(?:what\s+products|other\s+products|catalog|shop|do\s+you\s+sell|do\s+you\s+have|price|cost|specs|specification|earbuds|tv\s+box|charger|blender|watch|tracker|vacuum|scale|flask|purifier|ürünler|fiyat|özellik)/i;

function cleanQueryTokens(query) {
  if (typeof query !== 'string') return [];
  const stopWords = new Set(['what', 'is', 'the', 'for', 'on', 'in', 'at', 'to', 'a', 'an', 'and', 'or', 'of', 'are', 'you', 'your', 'we', 'our', 'this', 'that', 'with', 'from', 'bu', 've', 'ile', 'için', 'ne', 'bir']);
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stopWords.has(t))
    .slice(0, 10);
}

export async function retrieveRelevantTenantSiteContext({
  database,
  tenantId,
  query,
  currentPageUrl = null,
  limit = 4,
}) {
  if (!database?.query || !tenantId || !query) return [];
  if (!UUID_REGEX.test(String(tenantId))) return [];

  const userQuery = String(query).trim();
  if (!userQuery) return [];

  const isReviewQuery = REVIEW_QUERY_PATTERN.test(userQuery);
  const isPolicyQuery = POLICY_QUERY_PATTERN.test(userQuery);
  const isContactQuery = CONTACT_QUERY_PATTERN.test(userQuery);
  const isProductQuery = PRODUCT_QUERY_PATTERN.test(userQuery);
  const tokens = cleanQueryTokens(userQuery);

  let excludeUrl = null;
  if (currentPageUrl) {
    try {
      const p = new URL(currentPageUrl);
      p.hash = '';
      excludeUrl = p.toString();
      if (p.pathname !== '/' && excludeUrl.endsWith('/')) {
        excludeUrl = excludeUrl.slice(0, -1);
      }
    } catch {}
  }

  let sql = `
    SELECT id, tenant_id, url, canonical_url, hostname, title, page_type,
           entity_type, entity_name, summary, headings, products,
           reviews, policies, faqs, contact_info, attributes, content_text
      FROM tenant_site_pages
     WHERE tenant_id = $1
       AND crawl_status != 'RETIRED'
  `;
  const params = [tenantId];

  if (excludeUrl) {
    sql += ` AND url != $2 AND canonical_url != $2`;
    params.push(excludeUrl);
  }

  sql += ` ORDER BY updated_at DESC LIMIT 50`;

  let rows = [];
  try {
    const result = await database.query(sql, params);
    rows = result.rows;
  } catch (err) {
    console.warn('[SITE_RETRIEVAL_WARN] Query failed:', err?.message || err);
    return [];
  }

  if (rows.length === 0) return [];

  const scored = rows.map((page) => {
    let score = 0;
    const pageType = String(page.page_type || '').toUpperCase();
    const titleLower = String(page.title || '').toLowerCase();
    const entityLower = String(page.entity_name || '').toLowerCase();
    const summaryLower = String(page.summary || '').toLowerCase();
    const headingsArray = Array.isArray(page.headings) ? page.headings : [];
    const headingsLower = headingsArray.join(' ').toLowerCase();
    const reviewsArray = Array.isArray(page.reviews) ? page.reviews : [];
    const policiesArray = Array.isArray(page.policies) ? page.policies : [];
    const productsArray = Array.isArray(page.products) ? page.products : [];
    const contactObj = page.contact_info && typeof page.contact_info === 'object' ? page.contact_info : {};
    const contentLower = String(page.content_text || '').toLowerCase();

    if (isReviewQuery) {
      if (pageType === 'REVIEWS') score += 50;
      if (reviewsArray.length > 0) score += 30;
      if (titleLower.includes('review') || titleLower.includes('testimonial') || titleLower.includes('yorum')) score += 20;
      if (headingsLower.includes('what our shoppers say') || headingsLower.includes('customer reviews')) score += 15;
    }

    if (isPolicyQuery) {
      if (pageType === 'POLICY') score += 50;
      if (pageType === 'CONTACT') score += 25;
      if (policiesArray.length > 0) score += 30;
      if (titleLower.includes('policy') || titleLower.includes('return') || titleLower.includes('shipping') || titleLower.includes('warranty')) score += 20;
      if (headingsLower.includes('dispatch') || headingsLower.includes('returns') || headingsLower.includes('warranty')) score += 15;
    }

    if (isContactQuery) {
      if (pageType === 'CONTACT') score += 50;
      if (Object.keys(contactObj).length > 0) score += 20;
      if (titleLower.includes('contact') || titleLower.includes('support') || titleLower.includes('care')) score += 20;
    }

    if (isProductQuery) {
      if (pageType === 'PRODUCT' || pageType === 'PRODUCT_LIST') score += 20;
      if (productsArray.length > 0) score += 15;
    }

    for (const token of tokens) {
      if (titleLower.includes(token)) score += 10;
      if (entityLower.includes(token)) score += 10;
      if (headingsLower.includes(token)) score += 5;
      if (summaryLower.includes(token)) score += 3;
      if (contentLower.includes(token)) score += 2;
    }

    return { page, score };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.page);
}


export function formatTenantSiteIntelligencePromptSection(retrievedPages = []) {
  if (!Array.isArray(retrievedPages) || retrievedPages.length === 0) {
    return '';
  }

  const sections = [];
  sections.push('================================================================================');
  sections.push('RELEVANT TENANT SITE-WIDE PAGES & INTELLIGENCE (INDEXED FROM TENANT WEBSITE)');
  sections.push('================================================================================');
  sections.push('MANDATORY SITE-WIDE GROUNDING POLICY:');
  sections.push('1. CANONICAL TENANT SITE AUTHORITY: The information below was indexed directly from OTHER public pages of THIS TENANT\'S website. It represents verified tenant information available across the site.');
  sections.push('2. NO NAVIGATIONAL DEFLECTION: When the visitor asks about topics, reviews, policies, specifications, or products available in the indexed site context below, you MUST answer their question directly using these retrieved facts. NEVER tell the visitor "I do not have this information, please visit our other pages" or "Check the product pages" when the information is provided below.');
  sections.push('3. REVIEWS & TESTIMONIALS: If customer reviews or testimonials from the tenant\'s site are retrieved below, answer using those verified customer statements with proper attribution. Do NOT invent new reviews, and do NOT fabricate sentiments not present in the data.');
  sections.push('4. HONESTY ON ABSENT FACTS: If the requested information is absent from BOTH the current page AND the retrieved site intelligence (and approved knowledge), state clearly and politely that verified details on that specific topic are not available. Do NOT hallucinate.');
  sections.push('5. PROVENANCE: Every fact retrieved below carries [PROVENANCE: SITE_PAGE_FACT] or [PROVENANCE: SITE_STRUCTURED_DATA].');
  sections.push('--------------------------------------------------------------------------------');

  for (const page of retrievedPages) {
    const title = page.title || page.entity_name || 'Tenant Page';
    const url = page.url || page.canonical_url || '';
    const pageType = page.page_type || 'PAGE';
    const summary = page.summary || '';
    const reviews = Array.isArray(page.reviews) ? page.reviews : [];
    const policies = Array.isArray(page.policies) ? page.policies : [];
    const products = Array.isArray(page.products) ? page.products : [];
    const contact = page.contact_info && typeof page.contact_info === 'object' ? page.contact_info : {};
    const headings = Array.isArray(page.headings) ? page.headings.slice(0, 6) : [];

    sections.push(`[INDEXED TENANT PAGE: ${title}]`);
    sections.push(`URL: ${url} [PROVENANCE: SITE_PAGE_FACT]`);
    sections.push(`Page Type: ${pageType}`);

    if (summary) {
      sections.push(`Summary: ${summary}`);
    }

    if (headings.length > 0) {
      sections.push(`Key Sections: ${headings.join(' | ')}`);
    }

    if (reviews.length > 0) {
      sections.push('Customer Reviews & Shopper Feedback [PROVENANCE: SITE_PAGE_FACT]:');
      for (const rev of reviews.slice(0, 5)) {
        const author = rev.author || 'Verified Shopper';
        const loc = rev.location ? ` (${rev.location})` : '';
        const rating = rev.rating ? ` [Rating: ${rev.rating}]` : '';
        sections.push(`  • "${rev.text}" — ${author}${loc}${rating}`);
      }
    }

    if (policies.length > 0) {
      sections.push('Verified Policies [PROVENANCE: SITE_PAGE_FACT]:');
      for (const pol of policies) {
        sections.push(`  • ${pol.title}: ${pol.text}`);
      }
    }

    if (contact.email || contact.phone || contact.fulfillment_hub || contact.operating_hours) {
      sections.push('Contact & Support Channels [PROVENANCE: SITE_PAGE_FACT]:');
      if (contact.email) sections.push(`  • Email: ${contact.email}`);
      if (contact.phone) sections.push(`  • Phone: ${contact.phone}`);
      if (contact.fulfillment_hub) sections.push(`  • Fulfillment Hub: ${contact.fulfillment_hub}`);
      if (contact.operating_hours) sections.push(`  • Operating Hours: ${contact.operating_hours}`);
    }

    if (products.length > 0) {
      sections.push(`Products on this Page (${products.length} items) [PROVENANCE: SITE_STRUCTURED_DATA]:`);
      for (const prod of products.slice(0, 8)) {
        const pr = prod.price ? ` (${prod.price})` : '';
        const desc = prod.description ? ` - ${prod.description}` : '';
        sections.push(`  • ${prod.name}${pr}${desc}`);
      }
    }

    sections.push('--------------------------------------------------------------------------------');
  }

  return sections.join('\n');
}

