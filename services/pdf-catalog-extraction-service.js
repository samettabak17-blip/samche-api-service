import crypto from 'node:crypto';
import { createKnowledgeEntity, addEntityMedia } from './knowledge-entity-service.js';
import { buildKnowledgeStorageKey, hashKnowledgeSource } from './knowledge-source-ingestion-service.js';

export class PdfCatalogExtractionError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'PdfCatalogExtractionError';
    this.code = code;
  }
}
function detectImageMimeAndExtension(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  return null;
}


const BOILERPLATE_LINE_REGEX = /^(?:page\s*\d+(?:\s*(?:of|\/|-)\s*\d+)?$|\d{1,4}$|copyright\b|©|all\s*rights\s*reserved|printed\s*in\b|published\s*by\b|https?:\/\/|www\.)/i;

const SKU_REGEX = /(?:sku|code|ref|art(?:icle)?(?:\s*no)?|kod|model|item\s*no)[\s#:]+([A-Za-z0-9_.-]{2,32})/i;
const DOTTED_ARTICLE_REGEX = /\b([0-9]{3}\.[0-9]{3}\.[0-9]{2})\b/;
const NUMERIC_ARTICLE_REGEX = /\b([0-9]{8})\b/;
const HYPHENATED_CODE_REGEX = /\b([A-Z0-9]{2,6}-[A-Z0-9]{2,8})\b/;

const PRICE_REGEX = /(?:price|fiyat|fiyatı)[\s:]+([^\n]+)/i;
const CURRENCY_INLINE_REGEX = /(?:[$€£¥]|AED|TL|TRY|USD|EUR|GBP)\s*[\d,.]+|\b[\d,.]+\s*(?:TL|TRY|AED|USD|EUR|GBP|USD)\b/i;

const KEY_VALUE_ATTR_REGEX = /^([A-Za-zÇĞİÖŞÜçğıöşü\s_-]{2,32}):\s*(.+)$/i;

function isHeadingLine(line) {
  if (!line || line.length < 2 || line.length > 100) return false;
  if (BOILERPLATE_LINE_REGEX.test(line)) return false;
  if (KEY_VALUE_ATTR_REGEX.test(line)) return false;
  if (PRICE_REGEX.test(line) || CURRENCY_INLINE_REGEX.test(line)) return false;
  if (SKU_REGEX.test(line) || DOTTED_ARTICLE_REGEX.test(line) || NUMERIC_ARTICLE_REGEX.test(line) || HYPHENATED_CODE_REGEX.test(line)) return false;
  if (/^(?:for\s+more|visit|contact|email|phone|terms|conditions)/i.test(line)) return false;
  if (/^[A-Z0-9ÇĞİÖŞÜ\s&'.-]{2,60}$/.test(line) && /[A-ZÇĞİÖŞÜ]/.test(line)) return true;
  if (/^[A-ZÇĞİÖŞÜ][a-zçğıöşü0-9]+(?:\s+[A-ZÇĞİÖŞÜ0-9][a-zçğıöşü0-9&'.-]*)*$/.test(line) && line.split(/\s+/).length <= 8) return true;
  if (/^(?:item|product|ürün|ünite|concept|model|service|package|project|plan)[\s#:]+/i.test(line)) return true;
  return false;
}

/**
 * Parses raw text lines on a PDF page to detect candidate entities,
 * attributes, codes, and descriptions generically across open domains.
 */
export function extractPageEntityCandidates(pageText, pageNumber) {
  const normalized = String(pageText ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim();

  if (!normalized) return [];

  const rawSections = normalized.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  const blocks = [];

  for (const section of rawSections) {
    const sectionLines = section.split('\n').map((l) => l.trim()).filter(Boolean);
    let currentBlock = [];

    for (const line of sectionLines) {
      if (BOILERPLATE_LINE_REGEX.test(line)) continue;

      const isExplicitHeader = /^(?:item|product|ürün|ünite|concept|model|service|package)[\s#:]+/i.test(line);
      const isAnchorHeading = isHeadingLine(line);

      if ((isExplicitHeader || (isAnchorHeading && currentBlock.length >= 2)) && currentBlock.length > 0) {
        blocks.push(currentBlock);
        currentBlock = [line];
      } else {
        currentBlock.push(line);
      }
    }
    if (currentBlock.length > 0) blocks.push(currentBlock);
  }

  if (blocks.length === 1 && blocks[0].length > 4) {
    const singleBlock = blocks[0];
    const subBlocks = [];
    let curSub = [];

    for (const line of singleBlock) {
      if (isHeadingLine(line) && curSub.length >= 2) {
        subBlocks.push(curSub);
        curSub = [line];
      } else {
        curSub.push(line);
      }
    }
    if (curSub.length > 0) subBlocks.push(curSub);
    if (subBlocks.length > 1) {
      blocks.length = 0;
      blocks.push(...subBlocks);
    }
  }

  const candidates = [];

  for (const block of blocks) {
    if (!block.length) continue;

    const validLines = block.filter((l) => !BOILERPLATE_LINE_REGEX.test(l));
    if (!validLines.length) continue;

    let title = validLines[0];
    let sku = null;
    const attributes = {};
    const descriptionLines = [];

    for (let i = 0; i < validLines.length; i++) {
      const line = validLines[i];

      const skuMatch = SKU_REGEX.exec(line)
        || DOTTED_ARTICLE_REGEX.exec(line)
        || NUMERIC_ARTICLE_REGEX.exec(line)
        || HYPHENATED_CODE_REGEX.exec(line);

      if (skuMatch && !sku) {
        sku = (skuMatch[1] || skuMatch[0]).trim();
      }

      const priceMatch = PRICE_REGEX.exec(line) || CURRENCY_INLINE_REGEX.exec(line);
      if (priceMatch && !attributes.price) {
        attributes.price = (priceMatch[1] || priceMatch[0]).trim();
      }

      const attrMatch = KEY_VALUE_ATTR_REGEX.exec(line);
      if (attrMatch) {
        const key = attrMatch[1].trim().toLowerCase().replace(/\s+/g, '_');
        attributes[key] = attrMatch[2].trim();
      } else if (i > 0 && !skuMatch && (!priceMatch || priceMatch[0] !== line)) {
        descriptionLines.push(line);
      }
    }

    const cleanTitle = title
      .replace(/^(?:item|product|ürün|model|ünite|concept|package|service)[\s#:]+/i, '')
      .trim();

    if (cleanTitle && cleanTitle.length >= 2) {
      let confidence = 0.70;
      if (sku && attributes.price) confidence = 0.95;
      else if (sku || attributes.price) confidence = 0.90;
      else if (Object.keys(attributes).length > 0) confidence = 0.85;
      else if (isHeadingLine(title)) confidence = 0.80;

      candidates.push({
        name: cleanTitle.slice(0, 255),
        externalCode: sku ? sku.slice(0, 128) : null,
        description: descriptionLines.join(' ').slice(0, 4000) || null,
        attributes,
        textualEvidence: validLines.join('\n').slice(0, 4000),
        confidence,
        pageNumber,
      });

      if (candidates.length >= 50) break;
    }
  }

  return candidates;
}

async function withTimeout(promise, ms, label = 'TIMEOUT') {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`PDF_OPERATION_TIMEOUT:${label}`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

/**
 * Ingests a PDF catalog into page-aware text, candidate entities,
 * and extracted visual references.
 */
export async function processPdfCatalogIngestion({
  database,
  storage,
  tenantId,
  sourceId,
  bytes,
  contentHash,
  extractPdfText = null,
  extractPdfImages = null,
  logger = console,
}) {
  logger?.info?.('CATALOG_ENTITY_EXTRACTION_STARTED', JSON.stringify({
    tenant_id: tenantId,
    source_id: sourceId,
    bytes_length: bytes?.length ?? 0,
  }));

  let fullText = '';
  let pages = [];

  // 1. Extract text and page breakdown
  if (typeof extractPdfText === 'function') {
    const result = await extractPdfText(bytes);
    if (typeof result === 'string') {
      fullText = result;
      pages = [{ pageNumber: 1, text: result }];
    } else if (result && Array.isArray(result.pages)) {
      pages = result.pages;
      fullText = result.text || pages.map((p) => p.text).join('\n\n');
    }
  } else {
    try {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: Buffer.from(bytes) });
      try {
        const textResult = await withTimeout(parser.getText(), 25000, 'TEXT');
        fullText = textResult?.text || '';
        pages = Array.isArray(textResult?.pages)
          ? textResult.pages.map((p, idx) => ({ pageNumber: p.pageNumber || idx + 1, text: p.text }))
          : [{ pageNumber: 1, text: fullText }];
      } finally {
        await parser.destroy().catch(() => {});
      }
    } catch (textErr) {
      console.warn('PDF_TEXT_EXTRACTION_FALLBACK:', textErr?.message || textErr);
      fullText = Buffer.from(bytes).toString('utf8').replace(/[\u0000-\u001f]/g, ' ');
      pages = [{ pageNumber: 1, text: fullText }];
    }
  }

  // 2. Extract embedded or rendered images from PDF
  let extractedImages = [];
  let mediaCandidatesCount = 0;
  let mediaSkippedCount = 0;
  let pagesPartialCount = 0;

  try {
    if (typeof extractPdfImages === 'function') {
      extractedImages = await extractPdfImages(bytes);
    } else {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: Buffer.from(bytes) });
      try {
        if (typeof parser.getImage === 'function') {
          const imgResult = await withTimeout(
            parser.getImage({ imageBuffer: true, imageThreshold: 48 }),
            6000,
            'IMAGE'
          ).catch(() => null);

          if (imgResult && Array.isArray(imgResult.pages)) {
            for (const p of imgResult.pages) {
              const pageNum = p.pageNumber || 1;
              if (Array.isArray(p.images)) {
                for (const img of p.images) {
                  mediaCandidatesCount++;
                  const imgData = img.data ? Buffer.from(img.data) : null;
                  if (imgData && imgData.length > 500 && (img.width >= 48 || !img.width) && (img.height >= 48 || !img.height)) {
                    const format = detectImageMimeAndExtension(imgData);
                    if (format) {
                      extractedImages.push({
                        pageNumber: pageNum,
                        buffer: imgData,
                        mimeType: format.mimeType,
                        extension: format.extension,
                        width: img.width,
                        height: img.height,
                        originalFilename: img.name || `pdf_p${pageNum}_img_${extractedImages.length + 1}.${format.extension}`,
                        isEmbedded: true,
                      });
                    } else {
                      mediaSkippedCount++;
                    }
                  } else {
                    mediaSkippedCount++;
                  }
                }
              }
            }
          }
        }

        // If embedded images extraction returned 0 images, extract rendered page screenshots page-by-page
        if (extractedImages.length === 0 && typeof parser.getScreenshot === 'function') {
          const targetPages = pages.slice(0, 5);
          for (const p of targetPages) {
            const pageNum = p.pageNumber || 1;
            try {
              const screenshotResult = await withTimeout(
                parser.getScreenshot({ partial: [pageNum], imageBuffer: true, desiredWidth: 800 }),
                3000,
                `PAGE_${pageNum}_SCREENSHOT`
              ).catch(() => null);

              if (screenshotResult && Array.isArray(screenshotResult.pages) && screenshotResult.pages[0]?.data) {
                mediaCandidatesCount++;
                const pData = screenshotResult.pages[0];
                const rawData = Buffer.from(pData.data);
                const format = detectImageMimeAndExtension(rawData);
                if (format) {
                  extractedImages.push({
                    pageNumber: pageNum,
                    buffer: rawData,
                    mimeType: format.mimeType,
                    extension: format.extension,
                    width: pData.width,
                    height: pData.height,
                    originalFilename: `pdf_page_${pageNum}_visual.${format.extension}`,
                    isEmbedded: false,
                  });
                } else {
                  mediaSkippedCount++;
                }
              }
            } catch (pageShotErr) {
              pagesPartialCount++;
              console.warn(`PDF_PAGE_${pageNum}_SCREENSHOT_SKIPPED:`, pageShotErr?.message || pageShotErr);
            }
          }
        }
      } finally {
        await parser.destroy().catch(() => {});
      }
    }
  } catch (imgErr) {
    console.warn('PDF_IMAGE_EXTRACTION_SKIPPED:', imgErr?.message || imgErr);
  }

  // Group images by page
  const imagesByPage = new Map();
  for (const img of extractedImages) {
    const pageNum = img.pageNumber || 1;
    if (!imagesByPage.has(pageNum)) imagesByPage.set(pageNum, []);
    imagesByPage.get(pageNum).push(img);
  }

  let totalEntities = 0;
  let totalMedia = 0;
  let totalCandidatesCount = 0;

  if (database && typeof database.query === 'function' && sourceId && tenantId) {
    try {
      await database.query(
        `DELETE FROM knowledge_entities
          WHERE source_id = $1 AND tenant_id = $2 AND approval_status = 'PENDING'`,
        [sourceId, tenantId]
      );
    } catch {
      // Best-effort cleanup of previous unapproved candidates
    }
  }

  // 3. Process each page to generate candidates
  for (const page of pages) {
    const pageNum = page.pageNumber || 1;
    const candidates = extractPageEntityCandidates(page.text, pageNum);
    totalCandidatesCount += candidates.length;
    const pageImages = imagesByPage.get(pageNum) || [];

    if (!candidates.length && pageImages.length > 0) {
      try {
        const entity = await createKnowledgeEntity({
          database,
          tenantId,
          sourceId,
          entityType: 'VISUAL_SAMPLE',
          name: `Visual Reference (Page ${pageNum})`,
          description: page.text ? page.text.slice(0, 1000) : 'Visual reference extracted from document',
          textualEvidence: page.text ? page.text.slice(0, 2000) : null,
          confidence: 0.85,
          approvalStatus: 'PENDING',
          isRuntimeEligible: false,
          provenance: { pageNumber: pageNum, sourceId, method: 'PDF_VISUAL_EXTRACTION' },
        });
        totalEntities++;

        for (const img of pageImages) {
          try {
            await addEntityMedia({
              database,
              storage,
              tenantId,
              entityId: entity.id,
              sourceId,
              file: {
                buffer: img.buffer,
                mimetype: img.mimeType,
                originalname: img.originalFilename,
                size: img.buffer.length,
              },
              mediaRole: img.isEmbedded ? 'PRIMARY_REFERENCE' : 'CONTEXT_VIEW',
              pageNumber: pageNum,
              confidence: img.isEmbedded ? 0.90 : 0.60,
              approvalStatus: 'PENDING',
              isRuntimeEligible: false,
              provenance: { pageNumber: pageNum, sourceId, width: img.width, height: img.height, isEmbedded: Boolean(img.isEmbedded) },
            });
            totalMedia++;
          } catch (mediaErr) {
            mediaSkippedCount++;
            console.warn('PDF_MEDIA_PERSISTENCE_SKIPPED:', mediaErr?.message || mediaErr);
          }
        }
      } catch (entityErr) {
        console.warn('PDF_ENTITY_CREATION_SKIPPED:', entityErr?.message || entityErr);
      }
    } else {
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        try {
          const entity = await createKnowledgeEntity({
            database,
            tenantId,
            sourceId,
            entityType: 'GENERIC',
            name: candidate.name,
            externalCode: candidate.externalCode,
            description: candidate.description,
            attributes: candidate.attributes,
            textualEvidence: candidate.textualEvidence,
            confidence: candidate.confidence ?? 0.90,
            approvalStatus: 'PENDING',
            isRuntimeEligible: false,
            provenance: { pageNumber: pageNum, sourceId, method: 'PDF_CATALOG_EXTRACTION' },
          });
          totalEntities++;

          if (pageImages.length === 1 && candidates.length === 1) {
            try {
              const singleImg = pageImages[0];
              await addEntityMedia({
                database,
                storage,
                tenantId,
                entityId: entity.id,
                sourceId,
                file: {
                  buffer: singleImg.buffer,
                  mimetype: singleImg.mimeType,
                  originalname: singleImg.originalFilename,
                  size: singleImg.buffer.length,
                },
                mediaRole: singleImg.isEmbedded ? 'PRIMARY_REFERENCE' : 'CONTEXT_VIEW',
                pageNumber: pageNum,
                confidence: singleImg.isEmbedded ? 0.95 : 0.60,
                approvalStatus: 'PENDING',
                isRuntimeEligible: false,
                provenance: { pageNumber: pageNum, sourceId, width: singleImg.width, height: singleImg.height, isEmbedded: Boolean(singleImg.isEmbedded) },
              });
              totalMedia++;
            } catch (mediaErr) {
              mediaSkippedCount++;
              console.warn('PDF_MEDIA_PERSISTENCE_SKIPPED:', mediaErr?.message || mediaErr);
            }
          } else if (pageImages.length > 0) {
            for (const img of pageImages) {
              try {
                await addEntityMedia({
                  database,
                  storage,
                  tenantId,
                  entityId: entity.id,
                  sourceId,
                  file: {
                    buffer: img.buffer,
                    mimetype: img.mimeType,
                    originalname: img.originalFilename,
                    size: img.buffer.length,
                  },
                  mediaRole: img.isEmbedded ? (candidates.length === 1 ? 'PRIMARY_REFERENCE' : 'SECONDARY_REFERENCE') : 'UNCERTAIN_ASSOCIATION',
                  pageNumber: pageNum,
                  confidence: img.isEmbedded ? (candidates.length === 1 ? 0.90 : 0.70) : 0.55,
                  approvalStatus: 'PENDING',
                  isRuntimeEligible: false,
                  provenance: { pageNumber: pageNum, sourceId, uncertain: candidates.length > 1, isEmbedded: Boolean(img.isEmbedded) },
                });
                totalMedia++;
              } catch (mediaErr) {
                mediaSkippedCount++;
                console.warn('PDF_MEDIA_PERSISTENCE_SKIPPED:', mediaErr?.message || mediaErr);
              }
            }
          }
        } catch (entityErr) {
          console.warn('PDF_ENTITY_CREATION_SKIPPED:', entityErr?.message || entityErr);
        }
      }
    }
  }

  logger?.info?.('CATALOG_ENTITY_EXTRACTION_COMPLETED', JSON.stringify({
    tenant_id: tenantId,
    source_id: sourceId,
    entity_candidates: totalCandidatesCount,
    entities_persisted: totalEntities,
    media_candidates: mediaCandidatesCount,
    media_persisted: totalMedia,
    media_skipped: mediaSkippedCount,
    pages_processed: pages.length,
    pages_partial: pagesPartialCount,
  }));

  return {
    extractedText: fullText,
    entityCount: totalEntities,
    mediaCount: totalMedia,
    method: 'PDF_CATALOG_EXTRACTION',
    pageCount: pages.length,
  };
}
