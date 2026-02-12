import { TFile } from 'obsidian';
import type NovalistPlugin from '../main';
import JSZip from 'jszip';
import { t } from '../i18n';

export interface ExportOptions {
  format: 'epub' | 'pdf' | 'docx';
  includeTitlePage: boolean;
  includeChapters: string[]; // file paths
  title: string;
  author: string;
}

export interface ChapterContent {
  title: string;
  content: string;
  order: number;
}

export async function compileChapters(
  plugin: NovalistPlugin,
  chapterFiles: TFile[]
): Promise<ChapterContent[]> {
  const chapters: ChapterContent[] = [];
  
  for (const file of chapterFiles) {
    const content = await plugin.app.vault.read(file);
    const cache = plugin.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter || {};
    const order = Number(frontmatter.order) || 999;
    
    // Get chapter title (H1 heading)
    const h1Match = content.match(/^#\s+(.+)$/m);
    const title = h1Match ? h1Match[1] : file.basename;
    
    // Strip frontmatter and extract just the chapter text
    let body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
    
    // Remove the H1 title (we'll use it separately)
    body = body.replace(/^#\s+.+\n?/m, '');
    
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

export async function exportToEPUB(
  plugin: NovalistPlugin,
  options: ExportOptions
): Promise<Blob> {
  const zip = new JSZip();
  
  // mimetype - must be first and uncompressed
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
  
  // Get chapter contents
  const files = options.includeChapters
    .map(path => plugin.app.vault.getAbstractFileByPath(path))
    .filter((f): f is TFile => f instanceof TFile);
  const chapters = await compileChapters(plugin, files);
  
  // Generate content.xhtml
  const contentHtml = generateEPUBContent(chapters, options);
  oebps.file('content.xhtml', contentHtml);
  
  // Generate toc.ncx
  const tocNcx = generateTOCNCX(chapters, options);
  oebps.file('toc.ncx', tocNcx);
  
  // Generate content.opf
  const contentOpf = generateContentOPF(chapters, options);
  oebps.file('content.opf', contentOpf);
  
  // Generate title page if requested
  if (options.includeTitlePage) {
    const titlePage = generateTitlePage(options);
    oebps.file('title.xhtml', titlePage);
  }
  
  return zip.generateAsync({ type: 'blob' });
}

function generateEPUBContent(chapters: ChapterContent[], options: ExportOptions): string {
  const chapterHtml = chapters.map((ch, i) => `
    <div class="chapter" id="chapter-${i + 1}">
      <h1>${escapeXml(ch.title)}</h1>
      ${markdownToHtml(ch.content)}
    </div>
  `).join('\n');
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(options.title)}</title>
  <style>
    body { font-family: serif; line-height: 1.6; margin: 2em; }
    h1 { font-size: 1.8em; text-align: center; margin-top: 0; margin-bottom: 2em; page-break-before: always; }
    h2 { font-size: 1.3em; text-align: center; margin-top: 2em; margin-bottom: 1em; }
    .chapter:first-of-type h1 { page-break-before: auto; }
    p { text-indent: 1.5em; margin: 0 0 0.5em 0; }
    p:first-of-type { text-indent: 0; }
    .chapter { margin-bottom: 3em; }
  </style>
</head>
<body>
${options.includeTitlePage ? '<div id="title-page" style="text-align: center; page-break-after: always;"><h1>' + escapeXml(options.title) + '</h1>' + (options.author ? '<p>by ' + escapeXml(options.author) + '</p>' : '') + '</div>' : ''}
${chapterHtml}
</body>
</html>`;
}

function generateTOCNCX(chapters: ChapterContent[], options: ExportOptions): string {
  const navPoints = chapters.map((ch, i) => `
    <navPoint id="chapter-${i + 1}" playOrder="${i + (options.includeTitlePage ? 2 : 1)}">
      <navLabel><text>${escapeXml(ch.title)}</text></navLabel>
      <content src="content.xhtml#chapter-${i + 1}"/>
    </navPoint>
  `).join('\n');
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <head>
    <meta name="dtb:uid" content="novalist-export"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(options.title)}</text></docTitle>
  <navMap>
    ${options.includeTitlePage ? '<navPoint id="title" playOrder="1"><navLabel><text>' + t('export.titlePage') + '</text></navLabel><content src="content.xhtml#title-page"/></navPoint>' : ''}
    ${navPoints}
  </navMap>
</ncx>`;
}

function generateContentOPF(chapters: ChapterContent[], options: ExportOptions): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${escapeXml(options.title)}</dc:title>
    ${options.author ? `<dc:creator opf:role="aut">${escapeXml(options.author)}</dc:creator>` : ''}
    <dc:language>en</dc:language>
    <dc:identifier id="BookId">novalist-export-${Date.now()}</dc:identifier>
  </metadata>
  <manifest>
    ${options.includeTitlePage ? '<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>' : ''}
    <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    ${options.includeTitlePage ? '<itemref idref="title"/>' : ''}
    <itemref idref="content"/>
  </spine>
</package>`;
}

function generateTitlePage(options: ExportOptions): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(options.title)}</title>
  <style>
    body { text-align: center; padding-top: 40%; }
    h1 { font-size: 2.5em; margin-bottom: 1em; }
    .author { font-size: 1.5em; color: #666; }
  </style>
</head>
<body>
  <h1>${escapeXml(options.title)}</h1>
  ${options.author ? `<p class="author">by ${escapeXml(options.author)}</p>` : ''}
</body>
</html>`;
}

export async function exportToDOCX(
  plugin: NovalistPlugin,
  options: ExportOptions
): Promise<Blob> {
  // For now, create a simple HTML-based DOCX
  // Full docx library integration would be better but this works for basic export
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
</Types>`);
  
  // _rels/.rels
  const rels = zip.folder('_rels');
  if (rels) {
    rels.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  }
  
  // word/document.xml
  const word = zip.folder('word');
  if (!word) throw new Error('Failed to create word folder');
  
  let bodyContent = '';
  
  if (options.includeTitlePage) {
    bodyContent += `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${escapeXml(options.title)}</w:t></w:r></w:p>`;
    if (options.author) {
      bodyContent += `<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr><w:r><w:t>by ${escapeXml(options.author)}</w:t></w:r></w:p>`;
    }
  }
  
  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    // Add page break before chapter (except first)
    if (i > 0 || options.includeTitlePage) {
      bodyContent += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
    }
    
    bodyContent += `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr><w:r><w:t>${escapeXml(chapter.title)}</w:t></w:r></w:p>`;
    
    const paragraphs = chapter.content.split('\n\n');
    let isFirstPara = true;
    for (const para of paragraphs) {
      if (!para.trim()) continue;
      // Handle H2 scene headings
      const h2Match = para.trim().match(/^##\s+(.+)$/m);
      if (h2Match) {
        bodyContent += `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${escapeXml(h2Match[1])}</w:t></w:r></w:p>`;
        isFirstPara = true;
        continue;
      }
      const cleanPara = escapeXml(para.trim());
      // First paragraph has no indent
      const indent = isFirstPara ? '<w:ind w:firstLine="0"/>' : '<w:ind w:firstLine="720"/>';
      bodyContent += `<w:p><w:pPr>${indent}</w:pPr><w:r><w:t>${cleanPara}</w:t></w:r></w:p>`;
      isFirstPara = false;
    }
  }
  
  word.file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyContent}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`);
  
  return await zip.generateAsync({ type: 'blob' });
}

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
      output += `by ${options.author}\n\n`;
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
    // First paragraph has no indent, subsequent paragraphs have indent
    const paragraphs = chapter.content.split('\n\n');
    let isFirstPara = true;
    for (const para of paragraphs) {
      if (!para.trim()) continue;
      if (isFirstPara) {
        output += `<p style="text-indent: 0;">${para.trim()}</p>\n\n`;
      } else {
        output += `<p style="text-indent: 1.5em;">${para.trim()}</p>\n\n`;
      }
      isFirstPara = false;
    }
  }
  
  return output;
}

function markdownToHtml(markdown: string): string {
  // Simple markdown to HTML conversion for EPUB
  let html = escapeXml(markdown);
  
  // H2 scene headings
  html = html.replace(/^##\s+(.+)$/gm, '</p><h2>$1</h2><p>');
  
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  
  // Line breaks to paragraphs
  const paragraphs = html.split('\n\n');
  html = paragraphs
    .filter(p => p.trim())
    .map(p => {
      const trimmed = p.trim();
      // Don't wrap headings in <p> tags
      if (trimmed.startsWith('<h2>') || trimmed.endsWith('</h2>')) return trimmed;
      return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`;
    })
    .join('\n');
  
  // Clean up any empty <p></p> tags created by the H2 substitution
  html = html.replace(/<p>\s*<\/p>/g, '');
  
  return html;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
