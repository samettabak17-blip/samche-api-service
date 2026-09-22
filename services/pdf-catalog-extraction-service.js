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


/**
 * Parses raw text lines on a PDF page to detect candidate entities,
 * attributes, codes, and descriptions.
 */
export function extractPageEntityCandidates(pageText, pageNumber) {
  const normalized = String(pageText ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim();

  if (!normalized) return [];

  const sections = normalized.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  const blocks = [];

  for (const section of sections) {
    const sectionLines = section.split('\n').map((l) => l.trim()).filter(Boolean);
    let currentBlock = [];

    for (const line of sectionLines) {
      const isExplicitHeader = /^(?:item|product|ürün|ünite|concept)[\s#:]+/i.test(line);
      if (isExplicitHeader && currentBlock.length > 0) {
        blocks.push(currentBlock);
        currentBlock = [line];
      } else {
        currentBlock.push(line);
      }
    }
    if (currentBlock.length > 0) blocks.push(currentBlock);
  }

  const candidates = [];

  for (const block of blocks) {
    if (!block.length) continue;

    const validLines = block.filter((l) => !/^(?:page\s*\d+|\d+\s*\/\s*\d+|\d+|copyright|©|all\s*rights\s*reserved)/i.test(l));
    if (!validLines.length) continue;

    let title = validLines[0];
    let sku = null;
    const attributes = {};
    const descriptionLines = [];

    for (let i = 0; i < validLines.length; i++) {
      const line = validLines[i];

      const skuMatch = /(?:sku|code|ref|art(?:icle)?(?:\s*no)?|kod|model)[\s#:]+([A-Za-z0-9_.-]{2,32})/i.exec(line)
        || /\b([0-9]{3}\.[0-9]{3}\.[0-9]{2})\b/.exec(line);
      if (skuMatch && !sku) {
        sku = skuMatch[1].trim();
      }

      const priceMatch = /(?:price|fiyat)[\s:]+([^\n]+)/i.exec(line)
        || /(?:[$€£]|AED|TL|USD|EUR)\s*[\d,.]+|\b[\d,.]+\s*(?:TL|AED|USD|EUR)\b/i.exec(line);
      if (priceMatch && !attributes.price) {
        attributes.price = priceMatch[0].trim();
      }

      const attrMatch = /^([A-Za-zÇĞİÖŞÜçğıöşü\s_-]{2,30}):\s*(.+)$/i.exec(line);
      if (attrMatch) {
        const key = attrMatch[1].trim().toLowerCase().replace(/\s+/g, '_');
        attributes[key] = attrMatch[2].trim();
      } else if (i > 0 && !skuMatch) {
        descriptionLines.push(line);
      }
    }

    const cleanTitle = title.replace(/^(?:item|product|ürün|model|ünite)[\s#:]+/i, '').trim();

    if (cleanTitle && cleanTitle.length >= 2) {
      candidates.push({
        name: cleanTitle.slice(0, 255),
        externalCode: sku,
        description: descriptionLines.join(' ').slice(0, 4000) || null,
        attributes,
        textualEvidence: validLines.join('\n').slice(0, 4000),
        pageNumber,
      });
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
}) {
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
                      });
                    }
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
                  });
                }
              }
            } catch (pageShotErr) {
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
              mediaRole: 'PRIMARY_REFERENCE',
              pageNumber: pageNum,
              confidence: 0.90,
              approvalStatus: 'PENDING',
              isRuntimeEligible: false,
              provenance: { pageNumber: pageNum, sourceId, width: img.width, height: img.height },
            });
            totalMedia++;
          } catch (mediaErr) {
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
            confidence: 0.90,
            approvalStatus: 'PENDING',
            isRuntimeEligible: false,
            provenance: { pageNumber: pageNum, sourceId, method: 'PDF_CATALOG_EXTRACTION' },
          });
          totalEntities++;

          if (pageImages.length === 1 && candidates.length === 1) {
            try {
              await addEntityMedia({
                database,
                storage,
                tenantId,
                entityId: entity.id,
                sourceId,
                file: {
                  buffer: pageImages[0].buffer,
                  mimetype: pageImages[0].mimeType,
                  originalname: pageImages[0].originalFilename,
                  size: pageImages[0].buffer.length,
                },
                mediaRole: 'PRIMARY_REFERENCE',
                pageNumber: pageNum,
                confidence: 0.95,
                approvalStatus: 'PENDING',
                isRuntimeEligible: false,
                provenance: { pageNumber: pageNum, sourceId, width: pageImages[0].width, height: pageImages[0].height },
              });
              totalMedia++;
            } catch (mediaErr) {
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
                  mediaRole: candidates.length === 1 ? 'PRIMARY_REFERENCE' : 'UNCERTAIN_ASSOCIATION',
                  pageNumber: pageNum,
                  confidence: candidates.length === 1 ? 0.90 : 0.60,
                  approvalStatus: 'PENDING',
                  isRuntimeEligible: false,
                  provenance: { pageNumber: pageNum, sourceId, uncertain: candidates.length > 1 },
                });
                totalMedia++;
              } catch (mediaErr) {
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

  return {
    extractedText: fullText,
    entityCount: totalEntities,
    mediaCount: totalMedia,
    method: 'PDF_CATALOG_EXTRACTION',
  };

}
