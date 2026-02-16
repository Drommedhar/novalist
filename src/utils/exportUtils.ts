import { TFile } from 'obsidian';
import type NovalistPlugin from '../main';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { t } from '../i18n';
import { stripComments } from './statisticsUtils';

/** Internal marker used to represent scene breaks in compiled content. */
const SCENE_BREAK_MARKER = '{{novalist-scene-break}}';

/** Visual separator rendered for scene breaks in all output formats. */
const SCENE_BREAK_TEXT = '* * *';

export interface ExportOptions {
  format: 'epub' | 'pdf' | 'docx';
  includeTitlePage: boolean;
  includeChapters: string[]; // file paths
  title: string;
  author: string;
  /** When true, apply Standard Manuscript Format (12 pt Courier, double-spaced, 1-inch margins, page headers). */
  smfPreset: boolean;
}

export interface ChapterContent {
  title: string;
  content: string;
  order: number;
}

// ─── Chapter Compilation ─────────────────────────────────────────────

export async function compileChapters(
  plugin: NovalistPlugin,
  chapterFiles: TFile[]
): Promise<ChapterContent[]> {
  const chapters: ChapterContent[] = [];
  
  for (const file of chapterFiles) {
    // Normalise line endings (Windows \r\n → \n) so that every regex
    // and every split('\n\n') in the export pipeline works reliably.
    const content = (await plugin.app.vault.read(file)).replace(/\r/g, '');
    const cache = plugin.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter || {};
    const order = Number(frontmatter.order) || 999;
    
    // Get chapter title (H1 heading)
    const h1Match = content.match(/^#\s+(.+)$/m);
    const title = h1Match ? h1Match[1] : file.basename;
    
    // Strip frontmatter and extract just the chapter text
    let body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
    
    // Remove comments (%%…%% and <!-- … -->)
    body = stripComments(body);
    
    // Remove the H1 title (we'll use it separately)
    body = body.replace(/^#\s+.+\n?/m, '');
    
    // Strip markdown code fences (``` lines) left behind after comment removal
    body = body.replace(/^```.*$/gm, '');
    
    // Replace scene headings (## …) with scene break markers.
    // Scene names are internal organisational labels and must not
    // appear in the exported book output.
    body = body.replace(/^##\s+.+$/gm, SCENE_BREAK_MARKER);
    
    // The very first scene in a chapter doesn't need a visible break
    // separator – strip a leading marker if present.
    body = body.trim();
    if (body.startsWith(SCENE_BREAK_MARKER)) {
      body = body.substring(SCENE_BREAK_MARKER.length).trim();
    }
    
    // Clean up markdown links - convert wiki links to plain text
    body = body.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_: string, link: string, display: string) => {
      return display || link;
    });
    
    // Convert image links to just alt text
    body = body.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
    
    chapters.push({
      title,
      content: body.trim(),
      order
    });
  }
  
  // Sort by order
  chapters.sort((a, b) => a.order - b.order);
  
  return chapters;
}

// ─── EPUB Export (EPUB 3 compliant) ──────────────────────────────────

export async function exportToEPUB(
  plugin: NovalistPlugin,
  options: ExportOptions
): Promise<Blob> {
  const zip = new JSZip();
  
  // mimetype – must be first entry and stored uncompressed
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  
  // META-INF/container.xml
  const metaInf = zip.folder('META-INF');
  if (metaInf) {
    metaInf.file('container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);
  }
  
  const oebps = zip.folder('OEBPS');
  if (!oebps) throw new Error('Failed to create OEBPS folder');
  
  // Compile chapter contents
  const files = options.includeChapters
    .map(path => plugin.app.vault.getAbstractFileByPath(path))
    .filter((f): f is TFile => f instanceof TFile);
  const chapters = await compileChapters(plugin, files);
  
  const bookId = `urn:uuid:${generateUUID()}`;
  const modifiedDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  
  // External stylesheet
  oebps.file('styles.css', generateEPUBStylesheet());
  
  // Title page (separate XHTML file)
  if (options.includeTitlePage) {
    oebps.file('title.xhtml', generateTitlePageXHTML(options));
  }
  
  // One XHTML file per chapter (best-practice for EPUB readers)
  for (let i = 0; i < chapters.length; i++) {
    oebps.file(`chapter-${i + 1}.xhtml`, generateChapterXHTML(chapters[i], options));
  }
  
  // EPUB 3 Navigation Document
  oebps.file('nav.xhtml', generateNavXHTML(chapters, options));
  
  // EPUB 2 NCX for backward compatibility
  oebps.file('toc.ncx', generateTOCNCX(chapters, options, bookId));
  
  // OPF package document
  oebps.file('content.opf', generateContentOPF(chapters, options, bookId, modifiedDate));
  
  return zip.generateAsync({ type: 'blob' });
}

// ── EPUB helpers ─────────────────────────────────────────────────────

function generateEPUBStylesheet(): string {
  return `/* Novalist – Book Export Stylesheet */

@page {
  margin: 1in;
}

body {
  font-family: Georgia, "Times New Roman", Times, serif;
  line-height: 1.5;
  margin: 1em;
  padding: 0;
}

/* Chapter heading */
h1.chapter-title {
  font-size: 1.5em;
  text-align: center;
  font-weight: bold;
  margin-top: 3em;
  margin-bottom: 2em;
}

/* Body paragraphs */
p {
  margin-top: 0;
  margin-bottom: 0.8em;
  text-align: justify;
  orphans: 2;
  widows: 2;
}

/* Scene break separator */
p.scene-break {
  text-align: center;
  margin-top: 1.5em;
  margin-bottom: 1.5em;
}

/* Title page */
div.title-page {
  text-align: center;
  padding-top: 30%;
}

div.title-page h1 {
  font-size: 2em;
  font-weight: bold;
  margin-bottom: 1em;
  text-indent: 0;
}

div.title-page p.author {
  font-size: 1.2em;
  font-style: italic;
  text-indent: 0;
}
`;
}

function generateChapterXHTML(chapter: ChapterContent, _options: ExportOptions): string {
  const bodyHtml = markdownToHtml(chapter.content);
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <section epub:type="chapter">
    <h1 class="chapter-title">${escapeXml(chapter.title)}</h1>
${bodyHtml}
  </section>
</body>
</html>`;
}

function generateTitlePageXHTML(options: ExportOptions): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(options.title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <div class="title-page" epub:type="titlepage">
    <h1>${escapeXml(options.title)}</h1>
    ${options.author ? `<p class="author">${escapeXml(options.author)}</p>` : ''}
  </div>
</body>
</html>`;
}

function generateNavXHTML(chapters: ChapterContent[], options: ExportOptions): string {
  const items: string[] = [];
  
  if (options.includeTitlePage) {
    items.push(`      <li><a href="title.xhtml">${escapeXml(t('export.titlePage'))}</a></li>`);
  }
  
  chapters.forEach((ch, i) => {
    items.push(`      <li><a href="chapter-${i + 1}.xhtml">${escapeXml(ch.title)}</a></li>`);
  });
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Table of Contents</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol>
${items.join('\n')}
    </ol>
  </nav>
</body>
</html>`;
}

function generateTOCNCX(chapters: ChapterContent[], options: ExportOptions, bookId: string): string {
  const navPoints: string[] = [];
  let playOrder = 1;
  
  if (options.includeTitlePage) {
    navPoints.push(`    <navPoint id="title" playOrder="${playOrder}">
      <navLabel><text>${escapeXml(t('export.titlePage'))}</text></navLabel>
      <content src="title.xhtml"/>
    </navPoint>`);
    playOrder++;
  }
  
  chapters.forEach((ch, i) => {
    navPoints.push(`    <navPoint id="chapter-${i + 1}" playOrder="${playOrder}">
      <navLabel><text>${escapeXml(ch.title)}</text></navLabel>
      <content src="chapter-${i + 1}.xhtml"/>
    </navPoint>`);
    playOrder++;
  });
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <head>
    <meta name="dtb:uid" content="${escapeXml(bookId)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(options.title)}</text></docTitle>
  <navMap>
${navPoints.join('\n')}
  </navMap>
</ncx>`;
}

function generateContentOPF(
  chapters: ChapterContent[],
  options: ExportOptions,
  bookId: string,
  modifiedDate: string
): string {
  const manifestItems: string[] = [];
  const spineItems: string[] = [];
  
  // Stylesheet
  manifestItems.push('    <item id="css" href="styles.css" media-type="text/css"/>');
  
  // Navigation document (EPUB 3 requirement)
  manifestItems.push('    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  
  // NCX (EPUB 2 backward compatibility)
  manifestItems.push('    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');
  
  // Title page
  if (options.includeTitlePage) {
    manifestItems.push('    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>');
    spineItems.push('    <itemref idref="title"/>');
  }
  
  // Chapter files
  chapters.forEach((_, i) => {
    const id = `chapter-${i + 1}`;
    manifestItems.push(`    <item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`);
    spineItems.push(`    <itemref idref="${id}"/>`);
  });
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${escapeXml(bookId)}</dc:identifier>
    <dc:title>${escapeXml(options.title)}</dc:title>
    ${options.author ? `<dc:creator>${escapeXml(options.author)}</dc:creator>` : ''}
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${modifiedDate}</meta>
  </metadata>
  <manifest>
${manifestItems.join('\n')}
  </manifest>
  <spine toc="ncx">
${spineItems.join('\n')}
  </spine>
</package>`;
}

// ─── DOCX Export ─────────────────────────────────────────────────────

export async function exportToDOCX(
  plugin: NovalistPlugin,
  options: ExportOptions
): Promise<Blob> {
  const files = options.includeChapters
    .map(path => plugin.app.vault.getAbstractFileByPath(path))
    .filter((f): f is TFile => f instanceof TFile);
  const chapters = await compileChapters(plugin, files);
  
  const zip = new JSZip();
  
  // [Content_Types].xml
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);
  
  // _rels/.rels
  const rels = zip.folder('_rels');
  if (rels) {
    rels.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  }
  
  const word = zip.folder('word');
  if (!word) throw new Error('Failed to create word folder');
  
  // word/_rels/document.xml.rels  (references styles.xml)
  const wordRels = word.folder('_rels');
  if (wordRels) {
    wordRels.file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  }
  
  // word/styles.xml  – proper style definitions for book formatting
  word.file('styles.xml', generateDOCXStyles(options));
  
  // ── Build document body ──
  let bodyContent = '';
  const smf = options.smfPreset;
  
  // Title page
  if (options.includeTitlePage) {
    bodyContent += `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${escapeXml(options.title)}</w:t></w:r></w:p>`;
    if (options.author) {
      bodyContent += `<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr><w:r><w:t>${escapeXml(options.author)}</w:t></w:r></w:p>`;
    }
  }
  
  // SMF page header (surname / TITLE / page) via default header
  if (smf) {
    const surname = options.author ? (options.author.split(/\s+/).pop() ?? options.author) : '';
    const shortTitle = options.title.length > 30 ? options.title.substring(0, 27) + '...' : options.title;
    const headerText = `${surname} / ${shortTitle.toUpperCase()}`;

    // We need a header part for SMF
    const wordRelsContent = wordRels
      ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
</Relationships>`
      : '';

    if (wordRels) {
      // Overwrite the rels file to include header reference
      wordRels.file('document.xml.rels', wordRelsContent);
    }

    // Add header part
    word.file('header1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr><w:jc w:val="right"/></w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${escapeXml(headerText)} / </w:t></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr><w:instrText> PAGE </w:instrText></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
</w:hdr>`);

    // Update Content_Types to include header
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>`);
  }
  
  // Chapters
  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const needsPageBreak = i > 0 || options.includeTitlePage;
    
    // Chapter heading (with page break when not the very first element)
    if (needsPageBreak) {
      bodyContent += `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:pageBreakBefore/></w:pPr><w:r><w:t>${escapeXml(chapter.title)}</w:t></w:r></w:p>`;
    } else {
      bodyContent += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escapeXml(chapter.title)}</w:t></w:r></w:p>`;
    }
    
    // Chapter body – each line is a paragraph (matches Obsidian editor view)
    const paragraphs = chapter.content.split('\n');
    let isFirstPara = true;
    
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      
      // Scene break
      if (trimmed === SCENE_BREAK_MARKER) {
        bodyContent += `<w:p><w:pPr><w:pStyle w:val="SceneBreak"/></w:pPr><w:r><w:t>${SCENE_BREAK_TEXT}</w:t></w:r></w:p>`;
        isFirstPara = true;
        continue;
      }
      
      // Regular paragraph — first paragraph after heading / scene break
      // uses no indent (standard book typesetting convention).
      const style = isFirstPara ? 'NoIndent' : 'BodyText';
      bodyContent += `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${markdownToDOCXRuns(trimmed)}</w:p>`;
      isFirstPara = false;
    }
  }
  
  // Section properties (page size, margins, header reference)
  const sectPrHeader = smf ? '<w:headerReference w:type="default" r:id="rId2" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>' : '';
  
  // word/document.xml
  word.file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyContent}
    <w:sectPr>
      ${sectPrHeader}
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`);
  
  return await zip.generateAsync({ type: 'blob' });
}

// ── DOCX helpers ─────────────────────────────────────────────────────

function generateDOCXStyles(options: ExportOptions): string {
  const smf = options.smfPreset;
  const fontFamily = smf ? 'Courier New' : 'Georgia';
  // SMF: 12pt (24 half-points), double-spaced (480 twips = 24pt × 20)
  const fontSize = smf ? '24' : '24';
  const lineSpacing = smf ? '480' : '360';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="${fontFamily}" w:hAnsi="${fontFamily}" w:eastAsia="${fontFamily}" w:cs="${fontFamily}"/>
        <w:sz w:val="${fontSize}"/>
        <w:szCs w:val="${fontSize}"/>
        <w:lang w:val="en-US"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:line="${lineSpacing}" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>

  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:before="4800" w:after="240"/>
    </w:pPr>
    <w:rPr>
      <w:sz w:val="52"/>
      <w:szCs w:val="52"/>
      <w:b/>
      <w:bCs/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:before="240"/>
    </w:pPr>
    <w:rPr>
      <w:sz w:val="32"/>
      <w:szCs w:val="32"/>
      <w:i/>
      <w:iCs/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:before="1440" w:after="720"/>
    </w:pPr>
    <w:rPr>
      <w:sz w:val="36"/>
      <w:szCs w:val="36"/>
      <w:b/>
      <w:bCs/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="BodyText">
    <w:name w:val="Body Text"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      ${smf ? '<w:ind w:firstLine="720"/>' : '<w:spacing w:after="160"/>'}
      <w:jc w:val="both"/>
    </w:pPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="NoIndent">
    <w:name w:val="No Indent"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:firstLine="0"/>
      ${smf ? '' : '<w:spacing w:after="160"/>'}
      <w:jc w:val="both"/>
    </w:pPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="SceneBreak">
    <w:name w:val="Scene Break"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:before="360" w:after="360"/>
    </w:pPr>
  </w:style>
</w:styles>`;
}

/**
 * Convert a paragraph of markdown text into OOXML `<w:r>` run elements,
 * handling **bold**, *italic* and ***bold-italic*** inline formatting.
 */
function markdownToDOCXRuns(text: string): string {
  const runs: string[] = [];
  // Match bold+italic, bold, or italic in order of specificity
  const regex = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  
  while ((match = regex.exec(text)) !== null) {
    // Plain text before this match
    if (match.index > lastIndex) {
      runs.push(docxRun(text.substring(lastIndex, match.index), false, false));
    }
    
    if (match[1] !== undefined) {
      // ***bold + italic***
      runs.push(docxRun(match[1], true, true));
    } else if (match[2] !== undefined) {
      // **bold**
      runs.push(docxRun(match[2], true, false));
    } else if (match[3] !== undefined) {
      // *italic*
      runs.push(docxRun(match[3], false, true));
    }
    
    lastIndex = regex.lastIndex;
  }
  
  // Remaining plain text
  if (lastIndex < text.length) {
    runs.push(docxRun(text.substring(lastIndex), false, false));
  }
  
  return runs.join('');
}

/** Build a single `<w:r>` element with optional bold / italic run properties. */
function docxRun(text: string, bold: boolean, italic: boolean): string {
  const rPr = (bold || italic)
    ? `<w:rPr>${bold ? '<w:b/><w:bCs/>' : ''}${italic ? '<w:i/><w:iCs/>' : ''}</w:rPr>`
    : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

// ─── PDF Export (via pdf-lib) ────────────────────────────────────────

/** Points-per-inch constant. */
const PPI = 72;

/**
 * Standard US-Letter page dimensions and margin constants used by the
 * PDF renderer.  All values are in PDF points (1 pt = 1/72 inch).
 */
const PDF_PAGE_WIDTH = 8.5 * PPI;  // 612
const PDF_PAGE_HEIGHT = 11 * PPI;  // 792
const PDF_MARGIN = 1 * PPI;        // 72  (1-inch margins)

/**
 * Strip markdown bold / italic markers and return plain text.
 * Used for PDF where inline formatting is handled separately.
 */
function stripMarkdownInline(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1');
}

/**
 * Parse a paragraph of markdown text into inline segments with bold /
 * italic metadata so the PDF renderer can switch fonts per-run.
 */
interface InlineSegment {
  text: string;
  bold: boolean;
  italic: boolean;
}

function parseMarkdownInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const regex = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.substring(lastIndex, match.index), bold: false, italic: false });
    }
    if (match[1] !== undefined) {
      segments.push({ text: match[1], bold: true, italic: true });
    } else if (match[2] !== undefined) {
      segments.push({ text: match[2], bold: false, italic: false }); // bold handled via font
      // re-push as bold
      segments.pop();
      segments.push({ text: match[2], bold: true, italic: false });
    } else if (match[3] !== undefined) {
      segments.push({ text: match[3], bold: false, italic: true });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.substring(lastIndex), bold: false, italic: false });
  }

  return segments;
}

/**
 * Word-wrap a string to fit within `maxWidth` points using the given
 * font and size.  Returns an array of lines.
 */
function wordWrap(
  text: string,
  font: { widthOfTextAtSize(text: string, size: number): number },
  fontSize: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

export async function exportToPDF(
  plugin: NovalistPlugin,
  options: ExportOptions
): Promise<Blob> {
  const files = options.includeChapters
    .map(path => plugin.app.vault.getAbstractFileByPath(path))
    .filter((f): f is TFile => f instanceof TFile);
  const chapters = await compileChapters(plugin, files);

  const useSMF = options.smfPreset;

  // Font selection
  const bodyFontName = useSMF ? StandardFonts.Courier : StandardFonts.TimesRoman;
  const boldFontName = useSMF ? StandardFonts.CourierBold : StandardFonts.TimesRomanBold;
  const italicFontName = useSMF ? StandardFonts.CourierOblique : StandardFonts.TimesRomanItalic;
  const boldItalicFontName = useSMF ? StandardFonts.CourierBoldOblique : StandardFonts.TimesRomanBoldItalic;
  const fontSize = useSMF ? 12 : 12;
  const lineSpacing = useSMF ? fontSize * 2 : fontSize * 1.5;
  const paragraphGap = useSMF ? 0 : fontSize * 0.8;
  const indent = useSMF ? PPI * 0.5 : PPI * 0.35;
  const chapterTopMargin = useSMF ? PPI * 3 : PPI * 2;

  const pdfDoc = await PDFDocument.create();
  const bodyFont = await pdfDoc.embedFont(bodyFontName);
  const boldFont = await pdfDoc.embedFont(boldFontName);
  const italicFont = await pdfDoc.embedFont(italicFontName);
  const boldItalicFont = await pdfDoc.embedFont(boldItalicFontName);

  const textWidth = PDF_PAGE_WIDTH - 2 * PDF_MARGIN;
  const headerY = PDF_PAGE_HEIGHT - PDF_MARGIN / 2;
  let pageNumber = 0;

  /**
   * Build the short surname slug used in SMF headers.
   * If the author field is empty, falls back to an empty string.
   */
  const surname = options.author
    ? options.author.split(/\s+/).pop() ?? options.author
    : '';

  /**
   * Short title used in SMF page headers (first significant word(s),
   * capped at ~30 characters to fit comfortably).
   */
  const shortTitle = options.title.length > 30
    ? options.title.substring(0, 27) + '...'
    : options.title;

  /** Add an SMF page header: Surname / SHORT TITLE / page# */
  function addPageHeader(
    page: ReturnType<typeof pdfDoc.addPage>,
    number: number
  ): void {
    if (!useSMF) return;
    const headerText = `${surname} / ${shortTitle.toUpperCase()} / ${number}`;
    const hw = bodyFont.widthOfTextAtSize(headerText, 10);
    page.drawText(headerText, {
      x: PDF_PAGE_WIDTH - PDF_MARGIN - hw,
      y: headerY,
      size: 10,
      font: bodyFont,
      color: rgb(0, 0, 0),
    });
  }

  /** Create a new page, optionally starting at a specific Y. */
  function newPage(): { page: ReturnType<typeof pdfDoc.addPage>; y: number } {
    const page = pdfDoc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
    pageNumber++;
    addPageHeader(page, pageNumber);
    return { page, y: PDF_PAGE_HEIGHT - PDF_MARGIN - lineSpacing };
  }

  // ── SMF Title Page ──
  if (options.includeTitlePage) {
    const tp = pdfDoc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
    pageNumber++;

    if (useSMF) {
      // SMF title page: contact info top-left, word count top-right,
      // title centered vertically.
      // Top-left: author name
      if (options.author) {
        tp.drawText(options.author, {
          x: PDF_MARGIN,
          y: PDF_PAGE_HEIGHT - PDF_MARGIN,
          size: 12,
          font: bodyFont,
          color: rgb(0, 0, 0),
        });
      }

      // Center block: title + "by" + author
      const titleFontSize = 12;
      const centerY = PDF_PAGE_HEIGHT / 2;
      const titleWidth = bodyFont.widthOfTextAtSize(options.title.toUpperCase(), titleFontSize);
      tp.drawText(options.title.toUpperCase(), {
        x: (PDF_PAGE_WIDTH - titleWidth) / 2,
        y: centerY + lineSpacing,
        size: titleFontSize,
        font: bodyFont,
        color: rgb(0, 0, 0),
      });

      if (options.author) {
        const byLine = `by ${options.author}`;
        const byWidth = bodyFont.widthOfTextAtSize(byLine, titleFontSize);
        tp.drawText(byLine, {
          x: (PDF_PAGE_WIDTH - byWidth) / 2,
          y: centerY - lineSpacing,
          size: titleFontSize,
          font: bodyFont,
          color: rgb(0, 0, 0),
        });
      }
    } else {
      // Standard decorative title page
      const titleFontSize = 24;
      const titleWidth = boldFont.widthOfTextAtSize(options.title, titleFontSize);
      tp.drawText(options.title, {
        x: (PDF_PAGE_WIDTH - titleWidth) / 2,
        y: PDF_PAGE_HEIGHT * 0.6,
        size: titleFontSize,
        font: boldFont,
        color: rgb(0, 0, 0),
      });

      if (options.author) {
        const authorFontSize = 16;
        const authorWidth = italicFont.widthOfTextAtSize(options.author, authorFontSize);
        tp.drawText(options.author, {
          x: (PDF_PAGE_WIDTH - authorWidth) / 2,
          y: PDF_PAGE_HEIGHT * 0.6 - 36,
          size: authorFontSize,
          font: italicFont,
          color: rgb(0, 0, 0),
        });
      }
    }
  }

  // ── Chapters ──
  for (const chapter of chapters) {
    let { page, y } = newPage();

    // Drop chapter heading down from the top for visual space
    y = PDF_PAGE_HEIGHT - PDF_MARGIN - chapterTopMargin;

    // Chapter title (centered)
    const chapterTitleClean = stripMarkdownInline(chapter.title);
    const chTitleFont = useSMF ? bodyFont : boldFont;
    const chTitleSize = useSMF ? 12 : 18;
    const chTitleText = useSMF ? chapterTitleClean.toUpperCase() : chapterTitleClean;
    const ctWidth = chTitleFont.widthOfTextAtSize(chTitleText, chTitleSize);
    page.drawText(chTitleText, {
      x: (PDF_PAGE_WIDTH - ctWidth) / 2,
      y,
      size: chTitleSize,
      font: chTitleFont,
      color: rgb(0, 0, 0),
    });
    y -= lineSpacing * 2;

    // Body paragraphs
    const paragraphs = chapter.content.split('\n');
    let isFirstPara = true;

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      // Scene break
      if (trimmed === SCENE_BREAK_MARKER) {
        y -= lineSpacing;
        if (y < PDF_MARGIN + lineSpacing) {
          ({ page, y } = newPage());
        }
        const sbWidth = bodyFont.widthOfTextAtSize(SCENE_BREAK_TEXT, fontSize);
        page.drawText(SCENE_BREAK_TEXT, {
          x: (PDF_PAGE_WIDTH - sbWidth) / 2,
          y,
          size: fontSize,
          font: bodyFont,
          color: rgb(0, 0, 0),
        });
        y -= lineSpacing;
        isFirstPara = true;
        continue;
      }

      // Parse inline formatting
      const segments = parseMarkdownInline(trimmed);

      // Build plain text for word-wrapping measurement
      const plainText = segments.map(s => s.text).join('');
      const paraIndent = useSMF && !isFirstPara ? indent : 0;
      const lines = wordWrap(plainText, bodyFont, fontSize, textWidth - paraIndent);

      for (let li = 0; li < lines.length; li++) {
        if (y < PDF_MARGIN + lineSpacing) {
          ({ page, y } = newPage());
        }
        const xStart = PDF_MARGIN + (li === 0 ? paraIndent : 0);

        // For the simple (and common) non-formatted case, draw directly
        if (segments.length === 1 && !segments[0].bold && !segments[0].italic) {
          page.drawText(lines[li], {
            x: xStart,
            y,
            size: fontSize,
            font: bodyFont,
            color: rgb(0, 0, 0),
          });
        } else {
          // Draw with inline formatting per-segment on this line.
          // We re-process to figure out which segments land on this line.
          page.drawText(stripMarkdownInline(lines[li]), {
            x: xStart,
            y,
            size: fontSize,
            font: bodyFont,
            color: rgb(0, 0, 0),
          });
          // For bold/italic lines, overlay the formatted segments.
          // A full per-segment layout is complex; for manuscript export
          // the monospace font makes it straightforward.
          if (useSMF) {
            // With Courier (monospace), re-draw with correct fonts
            // by splitting the line text into segment runs.
            let cx = xStart;
            // Since we already drew the plain text, overwriting with the same text
            // at the same position in the correct font is fine for 
            // monospace – every character is the same width.
            let segOffset = 0;
            // Determine how many chars of the full text have been consumed
            // by previous lines
            let prevChars = 0;
            for (let pi = 0; pi < li; pi++) {
              prevChars += lines[pi].length + 1; // +1 for the space removed by wrapping
            }

            for (const seg of segments) {
              const segEnd = segOffset + seg.text.length;
              // Find overlap between segment and current line's char range
              const lineStart = prevChars;
              const lineEnd = prevChars + lines[li].length;
              const overlapStart = Math.max(segOffset, lineStart);
              const overlapEnd = Math.min(segEnd, lineEnd);

              if (overlapStart < overlapEnd) {
                const overlapText = seg.text.substring(
                  overlapStart - segOffset,
                  overlapEnd - segOffset
                );
                let segFont = bodyFont;
                if (seg.bold && seg.italic) segFont = boldItalicFont;
                else if (seg.bold) segFont = boldFont;
                else if (seg.italic) segFont = italicFont;

                page.drawText(overlapText, {
                  x: cx,
                  y,
                  size: fontSize,
                  font: segFont,
                  color: rgb(0, 0, 0),
                });
                cx += segFont.widthOfTextAtSize(overlapText, fontSize);
              } else if (segOffset >= prevChars && segOffset < prevChars + lines[li].length) {
                // segment fully within this line but no overlap (shouldn't happen)
                cx += bodyFont.widthOfTextAtSize(seg.text, fontSize);
              }
              segOffset = segEnd;
            }
          }
        }
        y -= lineSpacing;
      }
      isFirstPara = false;

      // Add paragraph gap (non-SMF only)
      if (paragraphGap > 0) {
        y -= paragraphGap;
      }
    }
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: 'application/pdf' });
}

// ─── Markdown Export ─────────────────────────────────────────────────

export async function exportToMarkdown(
  plugin: NovalistPlugin,
  options: ExportOptions
): Promise<string> {
  const files = options.includeChapters
    .map(path => plugin.app.vault.getAbstractFileByPath(path))
    .filter((f): f is TFile => f instanceof TFile);
  const chapters = await compileChapters(plugin, files);
  
  let output = '';
  
  if (options.includeTitlePage) {
    output += `# ${options.title}\n\n`;
    if (options.author) {
      output += `*${options.author}*\n\n`;
    }
    output += `---\n\n`;
  }
  
  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    // Add page break before chapter (except first)
    if (i > 0 || options.includeTitlePage) {
      output += `\n<div style="page-break-after: always;"></div>\n\n`;
    }
    // Centered chapter title
    output += `<h1 style="text-align: center; margin-top: 0;">${chapter.title}</h1>\n\n`;
    // Each line is a paragraph (matches Obsidian editor view)
    const paragraphs = chapter.content.split('\n');
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      
      // Scene break
      if (trimmed === SCENE_BREAK_MARKER) {
        output += `<p style="text-align: center; margin: 1.5em 0;">${SCENE_BREAK_TEXT}</p>\n\n`;
        continue;
      }
      
      output += `<p>${trimmed}</p>\n\n`;
    }
  }
  
  return output;
}

// ─── Shared Utilities ────────────────────────────────────────────────

/**
 * Convert markdown content to XHTML paragraphs suitable for EPUB.
 * Handles scene break markers, bold, italic and first-paragraph rules.
 */
function markdownToHtml(markdown: string): string {
  // Each line is a paragraph (matches Obsidian editor view)
  const paragraphs = markdown.split('\n');
  let isFirst = true;
  
  const result = paragraphs
    .filter(p => p.trim())
    .map(p => {
      const trimmed = p.trim();
      
      // Scene break
      if (trimmed === SCENE_BREAK_MARKER) {
        isFirst = true; // next real paragraph gets no-indent
        return `    <p class="scene-break">${SCENE_BREAK_TEXT}</p>`;
      }
      
      // Process inline formatting (escape first, then apply markdown)
      let processed = escapeXml(trimmed);
      processed = processed.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
      processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      processed = processed.replace(/\*(.+?)\*/g, '<em>$1</em>');
      
      const cls = isFirst ? ' class="no-indent"' : '';
      isFirst = false;
      return `    <p${cls}>${processed}</p>`;
    })
    .join('\n');
  
  return result;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Generate a v4-style UUID (random). */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
