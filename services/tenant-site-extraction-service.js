import crypto from 'node:crypto';

/**
 * services/tenant-site-extraction-service.js
 * Generic, deterministic page intelligence and entity extraction.
 * Operates across all standard websites, e-commerce stores, service sites,
 * real estate portals, blogs, and SPAs without site-specific code or selectors.
 */

const SCRIPT_STYLE_BLOCKS = /<\s*(?:script|style|iframe|object|embed|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*(?:script|style|iframe|object|embed|noscript)\s*>/gi;
const CONTROL_TOKEN_PATTERN = /<\|im_start\|>|<\|im_end\|>|\[INST\]|\[\/INST\]|<<SYS>>|<\/SYS>|<\|system\|>/gi;
const UNSAFE_HTML_TAGS = /<\s*\/?(?:script|style|iframe|object|embed|form|input|button|meta|link|base)[^>]*>/gi;
const HTML_TAGS_STRIP = /<[^>]+>/g;

export function sanitizeExtractionText(value, maxLength = 1000) {
  if (value === undefined || value === null) return '';
  const str = String(value)
    .replace(SCRIPT_STYLE_BLOCKS, ' ')
    .replace(CONTROL_TOKEN_PATTERN, '')
    .replace(UNSAFE_HTML_TAGS, ' ')
    .replace(HTML_TAGS_STRIP, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return str.slice(0, maxLength);
}

export function parseJsonLdBlocks(html) {
  const blocks = [];
  const scriptRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const rawJson = match[1]?.trim();
    if (rawJson) {
      try {
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed)) {
          blocks.push(...parsed);
        } else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed['@graph'])) {
            blocks.push(...parsed['@graph']);
          } else {
            blocks.push(parsed);
          }
        }
      } catch {
        // Safe skip on malformed embedded JSON
      }
    }
  }
  return blocks;
}

export function extractMetaTag(html, property) {
  if (typeof html !== 'string' || !property) return '';
  const escaped = property.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&');
  const regexes = [
    new RegExp(`<meta\\b[^>]*property=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta\\b[^>]*content=["']([^"']*)["'][^>]*property=["']${escaped}["']`, 'i'),
    new RegExp(`<meta\\b[^>]*name=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta\\b[^>]*content=["']([^"']*)["'][^>]*name=["']${escaped}["']`, 'i'),
  ];
  for (const regex of regexes) {
    const match = html.match(regex);
    if (match && match[1]) {
      return sanitizeExtractionText(match[1], 1000);
    }
  }
  return '';
}

export function extractTitle(html, pageUrl) {
  const ogTitle = extractMetaTag(html, 'og:title');
  if (ogTitle) return ogTitle;
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (match && match[1]) {
    const cleaned = sanitizeExtractionText(match[1], 300);
    if (cleaned) return cleaned;
  }
  const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match && h1Match[1]) {
    const cleanedH1 = sanitizeExtractionText(h1Match[1], 300);
    if (cleanedH1) return cleanedH1;
  }
  try {
    const pathname = new URL(pageUrl).pathname.replace(/\/+$/, '');
    const slug = pathname.split('/').pop() || '';
    if (slug) {
      return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
  } catch {}
  return 'Home';
}

export function extractSummary(html) {
  const ogDesc = extractMetaTag(html, 'og:description');
  if (ogDesc) return ogDesc;
  const metaDesc = extractMetaTag(html, 'description');
  if (metaDesc) return metaDesc;
  const pMatch = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  if (pMatch && pMatch[1]) {
    const pText = sanitizeExtractionText(pMatch[1], 600);
    if (pText.length > 20) return pText;
  }
  return '';
}

export function extractHeadings(html) {
  const headings = [];
  const headingRegex = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match;
  while ((match = headingRegex.exec(html)) !== null) {
    const clean = sanitizeExtractionText(match[2], 200);
    if (clean && clean.length > 2 && !headings.includes(clean)) {
      headings.push(clean);
      if (headings.length >= 25) break;
    }
  }
  return headings;
}


export function extractInternalLinks(html, baseUrl) {
  if (typeof html !== 'string') return [];
  let baseHostname = '';
  let baseOrigin = '';
  try {
    const parsedBase = new URL(baseUrl);
    baseHostname = parsedBase.hostname.toLowerCase();
    baseOrigin = parsedBase.origin;
  } catch {
    return [];
  }

  const links = new Set();
  const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const rawHref = match[1]?.trim();
    if (!rawHref) continue;
    if (/^(?:javascript|mailto|tel|data|sms|whatsapp):/i.test(rawHref)) continue;

    try {
      const resolved = new URL(rawHref, baseOrigin);
      if (!['http:', 'https:'].includes(resolved.protocol)) continue;
      if (resolved.hostname.toLowerCase() !== baseHostname) continue;

      if (/\.(?:jpe?g|png|gif|webp|svg|ico|css|js|woff2?|ttf|eot|pdf|zip|mp4|webm)$/i.test(resolved.pathname)) {
        continue;
      }

      resolved.hash = '';
      const paramsToStrip = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'fbclid', 'gclid'];
      for (const p of paramsToStrip) {
        resolved.searchParams.delete(p);
      }

      let cleanUrl = resolved.toString();
      if (resolved.pathname !== '/' && cleanUrl.endsWith('/')) {
        cleanUrl = cleanUrl.slice(0, -1);
      }

      links.add(cleanUrl);
      if (links.size >= 100) break;
    } catch {}
  }

  return Array.from(links);
}

export function extractProducts(html, schemaBlocks = [], baseUrl = '') {
  const products = [];
  const seenNames = new Set();

  for (const block of schemaBlocks) {
    const typeStr = Array.isArray(block?.['@type']) ? block['@type'].join(' ') : String(block?.['@type'] || '');
    if (/Product|IndividualProduct|ProductModel/i.test(typeStr) && block.name) {
      const name = sanitizeExtractionText(block.name, 200);
      if (name && !seenNames.has(name.toLowerCase())) {
        seenNames.add(name.toLowerCase());
        const offers = Array.isArray(block.offers) ? block.offers[0] : block.offers;
        let price = '';
        if (offers && offers.price !== undefined) {
          const cur = offers.priceCurrency ? ` ${offers.priceCurrency}` : '';
          price = `${offers.price}${cur}`.trim();
        }
        products.push({
          name,
          price: price || undefined,
          description: block.description ? sanitizeExtractionText(block.description, 400) : undefined,
          sku: block.sku ? sanitizeExtractionText(String(block.sku), 64) : undefined,
          category: block.category ? sanitizeExtractionText(String(block.category), 100) : undefined,
          url: block.url ? String(block.url) : undefined,
        });
      }
    }
  }

  const priceRegex = /(?:AED|USD|\$|EUR|€|GBP|£|TRY|TL)\s*[\d,]+(?:\.\d{2})?|[\d,]+(?:\.\d{2})?\s*(?:AED|USD|\$|EUR|€|GBP|£|TRY|TL)/g;
  const productContainerRegex = /<div\b[^>]*class=["'][^"']*(?:product|item|card|listing|deal)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let pMatch;
  while ((pMatch = productContainerRegex.exec(html)) !== null) {
    const blockHtml = pMatch[1];
    const prices = blockHtml.match(priceRegex);
    if (!prices || prices.length === 0) continue;

    const titleMatch = blockHtml.match(/<h[2-5]\b[^>]*>([\s\S]*?)<\/h[2-5]>/i)
      || blockHtml.match(/<a\b[^>]*class=["'][^"']*(?:title|name|header)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    if (titleMatch && titleMatch[1]) {
      const name = sanitizeExtractionText(titleMatch[1], 200);
      if (name && name.length > 3 && !seenNames.has(name.toLowerCase()) && !/cart|menu|checkout|login|search/i.test(name)) {
        seenNames.add(name.toLowerCase());
        products.push({
          name,
          price: prices[0].trim(),
          description: sanitizeExtractionText(blockHtml.replace(/<h[1-6][\s\S]*?<\/h[1-6]>/gi, ' '), 300) || undefined,
        });
        if (products.length >= 30) break;
      }
    }
  }

  if (products.length === 0) {
    const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    const bodyPrices = html.match(priceRegex);
    if (h1Match && h1Match[1] && bodyPrices && bodyPrices.length > 0) {
      const h1Text = sanitizeExtractionText(h1Match[1], 200);
      if (h1Text && !/home|reviews|contact|about|shop|cart|checkout/i.test(h1Text)) {
        products.push({
          name: h1Text,
          price: bodyPrices[0].trim(),
          description: extractSummary(html) || undefined,
        });
      }
    }
  }

  return products;
}

export function extractReviews(html, schemaBlocks = []) {
  const reviews = [];
  const seenTexts = new Set();

  for (const block of schemaBlocks) {
    const typeStr = Array.isArray(block?.['@type']) ? block['@type'].join(' ') : String(block?.['@type'] || '');
    if (/Review/i.test(typeStr) && (block.reviewBody || block.description)) {
      const text = sanitizeExtractionText(block.reviewBody || block.description, 600);
      if (text && !seenTexts.has(text.toLowerCase())) {
        seenTexts.add(text.toLowerCase());
        const author = typeof block.author === 'object' ? block.author.name : block.author;
        const rating = block.reviewRating?.ratingValue || block.ratingValue;
        reviews.push({
          author: author ? sanitizeExtractionText(String(author), 100) : 'Verified Customer',
          text,
          rating: rating ? String(rating) : undefined,
          date: block.datePublished ? String(block.datePublished) : undefined,
          headline: block.headline ? sanitizeExtractionText(block.headline, 150) : undefined,
        });
      }
    }
  }

  const reviewCardRegex = /<(?:div|article|blockquote|li)\b[^>]*class=["'][^"']*(?:review|testimonial|feedback|quote|customer-say|shopper)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|article|blockquote|li)>/gi;
  let rMatch;
  while ((rMatch = reviewCardRegex.exec(html)) !== null) {
    const cardHtml = rMatch[1];
    const textMatch = cardHtml.match(/<(?:p|blockquote|span)\b[^>]*>([\s\S]*?)<\/(?:p|blockquote|span)>/i);
    const candidateText = textMatch ? sanitizeExtractionText(textMatch[1], 600) : sanitizeExtractionText(cardHtml, 600);

    if (candidateText && candidateText.length > 25 && !seenTexts.has(candidateText.toLowerCase())) {
      const authorMatch = cardHtml.match(/<(?:h[3-6]|span|div|cite|p)\b[^>]*class=["'][^"']*(?:author|reviewer|name|customer|client|user)[^"']*["'][^>]*>([\s\S]*?)<\/(?:h[3-6]|span|div|cite|p)>/i)
        || cardHtml.match(/([A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:\s+[A-ZÇĞİÖŞÜ]\.?)?(?:,\s*|\s*[-–—]\s*)(?:Dubai|Abu Dhabi|Sharjah|Ajman|UAE|RAK|Fujairah|Istanbul|London|New York|[A-Za-z\s]+))/);

      const authorLocation = authorMatch ? sanitizeExtractionText(authorMatch[1], 100) : '';
      let author = 'Verified Customer';
      let location = '';

      if (authorLocation) {
        if (authorLocation.includes(',')) {
          const parts = authorLocation.split(',');
          author = parts[0].trim();
          location = parts.slice(1).join(',').trim();
        } else if (authorLocation.includes('-')) {
          const parts = authorLocation.split('-');
          author = parts[0].trim();
          location = parts.slice(1).join('-').trim();
        } else {
          author = authorLocation;
        }
      }

      const ratingMatch = cardHtml.match(/([1-5](?:\.[0-9])?)\s*\/\s*5|([1-5])\s*stars?|★{1,5}/i);
      let rating = undefined;
      if (ratingMatch) {
        rating = ratingMatch[1] || ratingMatch[2] || (ratingMatch[0].includes('★') ? String(ratingMatch[0].length) : '5');
      }

      seenTexts.add(candidateText.toLowerCase());
      reviews.push({
        author: author || 'Verified Shopper',
        location: location || undefined,
        text: candidateText,
        rating: rating || '5/5',
      });

      if (reviews.length >= 20) break;
    }
  }

  if (reviews.length === 0) {
    const quotePattern = /["“]([^"”]{20,400})["”]\s*[-–—]?\s*([A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:\s+[A-ZÇĞİÖŞÜ]\.?)?(?:,\s*[A-Za-z\s]+)?)/g;
    let qMatch;
    while ((qMatch = quotePattern.exec(html)) !== null) {
      const qText = sanitizeExtractionText(qMatch[1], 600);
      const qAuthor = sanitizeExtractionText(qMatch[2], 100);
      if (qText && !seenTexts.has(qText.toLowerCase())) {
        seenTexts.add(qText.toLowerCase());
        let author = qAuthor;
        let location = undefined;
        if (qAuthor.includes(',')) {
          const parts = qAuthor.split(',');
          author = parts[0].trim();
          location = parts[1].trim();
        }
        reviews.push({
          author: author || 'Verified Customer',
          location,
          text: qText,
          rating: '5/5',
        });
        if (reviews.length >= 10) break;
      }
    }
  }

  return reviews;
}

export function extractPolicies(html) {
  const policies = [];

  const cutoffMatch = html.match(/(?:same-day\s+delivery\s+cutoff|order\s+before\s+\d+\s*(?:am|pm)|order\s+cutoff)[^.<>\n]*/i);
  if (cutoffMatch) {
    policies.push({
      type: 'DISPATCH_CUTOFF',
      title: 'Same-Day Dispatch Cutoff',
      text: sanitizeExtractionText(cutoffMatch[0], 250),
    });
  }

  const returnMatch = html.match(/(?:0-hassle\s+local\s+returns|return\s+policy|process\s+local\s+returns|refund\s+policy)[^.<>\n]*(?:\.[^.<>\n]*)?/i);
  if (returnMatch) {
    policies.push({
      type: 'RETURN_POLICY',
      title: 'Return Policy',
      text: sanitizeExtractionText(returnMatch[0], 250),
    });
  }

  const warrantyMatch = html.match(/(?:100%\s+verified\s+authentic|authenticity\s+guaranteed|official\s+manufacturer\s+warranty|corporate\s+authenticity\s+promise)[^.<>\n]*(?:\.[^.<>\n]*)?/i);
  if (warrantyMatch) {
    policies.push({
      type: 'WARRANTY_AUTHENTICITY',
      title: 'Authenticity & Warranty Policy',
      text: sanitizeExtractionText(warrantyMatch[0], 250),
    });
  }

  return policies;
}

export function extractContactInfo(html) {
  const contact = {};

  const emailMatch = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch && !/example|domain|yourname|schema/i.test(emailMatch[0])) {
    contact.email = emailMatch[0].trim().toLowerCase();
  }

  const phoneMatch = html.match(/\+971[\d\s-]{8,14}|\+1[\d\s-]{10,14}|\+90[\d\s-]{10,14}/);
  if (phoneMatch) {
    contact.phone = phoneMatch[0].trim().replace(/\s+/g, ' ');
  }

  const hubMatch = html.match(/(?:Dubai\s+Fulfillment\s+Hub,\s*UAE|Dubai\s+Central\s+Hub|Fulfillment\s+Center[^,<>\n]*,\s*UAE|Sheikh\s+Zayed\s+Road[^,<>\n]*)/i);
  if (hubMatch) {
    contact.fulfillment_hub = sanitizeExtractionText(hubMatch[0], 150);
    contact.address = contact.fulfillment_hub;
  }

  const hoursMatch = html.match(/(?:daily\s+from\s+\d+:\d+\s*(?:am|pm)\s+to\s+\d+:\d+\s*(?:am|pm)\s*(?:gst|gmt|utc)?|\d+:\d+\s*(?:am|pm)\s*-\s*\d+:\d+\s*(?:am|pm))/i);
  if (hoursMatch) {
    contact.operating_hours = sanitizeExtractionText(hoursMatch[0], 100);
  }

  return contact;
}

export function extractFaqs(html, schemaBlocks = []) {
  const faqs = [];
  for (const block of schemaBlocks) {
    const typeStr = Array.isArray(block?.['@type']) ? block['@type'].join(' ') : String(block?.['@type'] || '');
    if (/FAQPage/i.test(typeStr) && Array.isArray(block.mainEntity)) {
      for (const item of block.mainEntity) {
        if (item.name && (item.acceptedAnswer?.text || item.acceptedAnswer)) {
          const q = sanitizeExtractionText(item.name, 250);
          const a = sanitizeExtractionText(typeof item.acceptedAnswer === 'object' ? item.acceptedAnswer.text : item.acceptedAnswer, 600);
          if (q && a) {
            faqs.push({ question: q, answer: a });
          }
        }
      }
    }
  }

  return faqs;
}


export function determinePageType({ url, title, headings = [], products = [], reviews = [], schemaBlocks = [] }) {
  const normUrl = String(url || '').toLowerCase();
  const normTitle = String(title || '').toLowerCase();
  const headingsStr = headings.join(' ').toLowerCase();

  if (
    normUrl.includes('/reviews') ||
    normUrl.includes('/testimonials') ||
    normUrl.includes('/feedback') ||
    normTitle.includes('reviews') ||
    normTitle.includes('testimonials') ||
    normTitle.includes('müşteri yorumları') ||
    normTitle.includes('değerlendirmeler') ||
    headingsStr.includes('what our shoppers say') ||
    headingsStr.includes('from our customers') ||
    headingsStr.includes('customer reviews') ||
    (reviews.length >= 2 && !products.length)
  ) {
    return 'REVIEWS';
  }

  if (
    normUrl.includes('/contact') ||
    normUrl.includes('/support') ||
    normUrl.includes('/helpdesk') ||
    normUrl.includes('/iletisim') ||
    normTitle.includes('contact') ||
    normTitle.includes('customer care') ||
    normTitle.includes('submit inquiry') ||
    headingsStr.includes('customer care desk') ||
    headingsStr.includes('support channels')
  ) {
    return 'CONTACT';
  }

  if (
    normUrl.includes('/policy') ||
    normUrl.includes('/returns') ||
    normUrl.includes('/refund') ||
    normUrl.includes('/shipping') ||
    normUrl.includes('/terms') ||
    normUrl.includes('/privacy') ||
    normTitle.includes('return policy') ||
    normTitle.includes('refund policy') ||
    normTitle.includes('shipping policy') ||
    normTitle.includes('warranty')
  ) {
    return 'POLICY';
  }

  if (normUrl.includes('/faq') || normTitle.includes('faq') || normTitle.includes('frequently asked') || normTitle.includes('sss')) {
    return 'FAQ';
  }

  if (products.length === 1 && !normUrl.includes('/shop') && !normUrl.includes('/collections') && !normUrl.includes('/catalog')) {
    return 'PRODUCT';
  }

  if (
    products.length > 1 ||
    normUrl.includes('/shop') ||
    normUrl.includes('/collections') ||
    normUrl.includes('/catalog') ||
    normUrl.includes('/products') ||
    normTitle.includes('shop') ||
    normTitle.includes('catalog')
  ) {
    return 'PRODUCT_LIST';
  }

  try {
    const path = new URL(url).pathname;
    if (path === '/' || path === '' || normTitle.includes('home') || normTitle.includes('ana sayfa')) {
      return 'HOME';
    }
  } catch {}

  for (const block of schemaBlocks) {
    const typeStr = Array.isArray(block?.['@type']) ? block['@type'].join(' ') : String(block?.['@type'] || '');
    if (/Service/i.test(typeStr)) return 'SERVICE';
    if (/RealEstate|Apartment|Residence|House/i.test(typeStr)) return 'PROPERTY';
    if (/Article|BlogPosting/i.test(typeStr)) return 'ARTICLE';
  }

  return 'GENERIC_PAGE';
}

export function extractVisibleTextExcerpt(html, maxCharacters = 4000) {
  if (typeof html !== 'string') return '';
  const clean = html
    .replace(SCRIPT_STYLE_BLOCKS, ' ')
    .replace(CONTROL_TOKEN_PATTERN, '')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(UNSAFE_HTML_TAGS, ' ')
    .replace(HTML_TAGS_STRIP, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return clean.slice(0, maxCharacters);
}

export function extractTenantPageIntelligence(html, pageUrl) {
  if (typeof html !== 'string' || !html.trim()) {
    throw new Error('PAGE_HTML_REQUIRED');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(pageUrl);
  } catch {
    throw new Error('INVALID_PAGE_URL');
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const canonicalTag = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
    || html.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  const canonicalUrl = canonicalTag && canonicalTag[1] ? canonicalTag[1].trim() : pageUrl;

  const schemaBlocks = parseJsonLdBlocks(html);
  const title = extractTitle(html, pageUrl);
  const summary = extractSummary(html);
  const headings = extractHeadings(html);
  const internalLinks = extractInternalLinks(html, pageUrl);
  const products = extractProducts(html, schemaBlocks, pageUrl);
  const reviews = extractReviews(html, schemaBlocks);
  const policies = extractPolicies(html);
  const contactInfo = extractContactInfo(html);
  const faqs = extractFaqs(html, schemaBlocks);

  const pageType = determinePageType({
    url: pageUrl,
    title,
    headings,
    products,
    reviews,
    schemaBlocks,
  });

  const entityType = pageType === 'PRODUCT'
    ? 'Product'
    : (pageType === 'PRODUCT_LIST' ? 'ProductList' : (pageType === 'REVIEWS' ? 'ReviewCollection' : pageType));

  const entityName = products.length === 1 && pageType === 'PRODUCT'
    ? products[0].name
    : title;

  const contentText = extractVisibleTextExcerpt(html, 4000);

  const hashPayload = JSON.stringify({
    title,
    summary,
    pageType,
    products,
    reviews,
    policies,
    faqs,
    contactInfo,
    headings,
  });
  const contentHash = crypto.createHash('sha256').update(hashPayload).digest('hex');

  return {
    url: pageUrl,
    canonical_url: canonicalUrl,
    hostname,
    title,
    summary,
    page_type: pageType,
    entity_type: entityType,
    entity_name: entityName,
    headings,
    products,
    reviews,
    policies,
    faqs,
    contact_info: contactInfo,
    attributes: {
      products_count: products.length,
      reviews_count: reviews.length,
      policies_count: policies.length,
      faqs_count: faqs.length,
    },
    structured_data: schemaBlocks,
    internal_links: internalLinks,
    content_text: contentText,
    content_hash: contentHash,
    extracted_at: new Date().toISOString(),
  };
}


