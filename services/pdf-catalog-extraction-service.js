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

  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  // Group lines into entity blocks based on headings, SKUs, or blank lines
  const blocks = [];
  let currentBlock = [];

  for (const line of lines) {
    const isNewEntityHeader = /^(?:item|product|ünite|ürün|parça|concept)[\s#:]+/i.test(line) ||
      (currentBlock.length > 0 && /^(?:item|product|ünite|ürün)[\s#:]+/i.test(line));

    if (isNewEntityHeader && currentBlock.length > 0) {
      blocks.push(currentBlock);
      currentBlock = [line];
    } else {
      currentBlock.push(line);
    }
  }
  if (currentBlock.length > 0) blocks.push(currentBlock);

  const candidates = [];

  for (const block of blocks) {
    if (!block.length) continue;

    let title = block[0];
    let sku = null;
    const attributes = {};
    const descriptionLines = [];

    for (let i = 0; i < block.length; i++) {
      const line = block[i];
      const skuMatch = /(?:sku|code|ref|art|kod|model)[\s#:]+([A-Za-z0-9_-]{2,32})/i.exec(line);
      if (skuMatch && !sku) {
        sku = skuMatch[1].trim();
      }

      const attrMatch = /^([A-Za-zÇĞİÖŞÜçğıöşü\s_-]{2,30}):\s*(.+)$/i.exec(line);
      if (attrMatch) {
        const key = attrMatch[1].trim().toLowerCase().replace(/\s+/g, '_');
        attributes[key] = attrMatch[2].trim();
      } else if (i > 0 && !skuMatch) {
        descriptionLines.push(line);
      }
    }

    // Clean up title if it contains SKU or label prefixes
    const cleanTitle = title.replace(/^(?:item|product|ürün|model|ünite)[\s#:]+/i, '').trim() || `Entity Page ${pageNumber}`;

    candidates.push({
      name: cleanTitle.slice(0, 255),
      externalCode: sku,
      description: descriptionLines.join(' ').slice(0, 4000) || null,
      attributes,
      textualEvidence: block.join('\n').slice(0, 4000),
      pageNumber,
    });
  }

  return candidates;
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
        const textResult = await parser.getText();
        fullText = textResult.text;
        pages = Array.isArray(textResult.pages)
          ? textResult.pages.map((p, idx) => ({ pageNumber: p.pageNumber || idx + 1, text: p.text }))
          : [{ pageNumber: 1, text: fullText }];
      } finally {
        await parser.destroy();
      }
    } catch {
      fullText = Buffer.from(bytes).toString('utf8').replace(/[\u0000-\u001f]/g, ' ');
      pages = [{ pageNumber: 1, text: fullText }];
    }
  }

  // 2. Extract embedded or rendered images from PDF
  let extractedImages = [];
  if (typeof extractPdfImages === 'function') {
    extractedImages = await extractPdfImages(bytes);
  } else {
    try {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: Buffer.from(bytes) });
      try {
        if (typeof parser.getImage === 'function') {
          const imgResult = await parser.getImage({ imageBuffer: true, imageThreshold: 48 });
          if (imgResult && Array.isArray(imgResult.pages)) {
            for (const p of imgResult.pages) {
              const pageNum = p.pageNumber || 1;
              if (Array.isArray(p.images)) {
                for (const img of p.images) {
                  const imgData = img.data ? Buffer.from(img.data) : null;
                  if (imgData && imgData.length > 500 && (img.width >= 48 || !img.width) && (img.height >= 48 || !img.height)) {
                    extractedImages.push({
                      pageNumber: pageNum,
                      buffer: imgData,
                      mimeType: img.kind === 'jpeg' ? 'image/jpeg' : (img.kind === 'webp' ? 'image/webp' : 'image/png'),
                      width: img.width,
                      height: img.height,
                      originalFilename: img.name || `pdf_p${pageNum}_img.png`,
                    });
                  }
                }
              }
            }
          }
        }
      } finally {
        await parser.destroy();
      }
    } catch {
      // Image extraction failure should fail safely without crashing text ingestion
    }
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

  // 3. Process each page to generate candidates
  for (const page of pages) {
    const pageNum = page.pageNumber || 1;
    const candidates = extractPageEntityCandidates(page.text, pageNum);
    const pageImages = imagesByPage.get(pageNum) || [];

    if (!candidates.length && pageImages.length > 0) {
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
      }
    } else {
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
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
        } else if (pageImages.length > 0) {
          for (const img of pageImages) {
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
          }
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
