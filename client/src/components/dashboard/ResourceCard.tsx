import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { tokenizeCode, type CodeTokenKind } from './codeHighlighting';
import styles from './ResourceCard.module.css';

export interface Resource {
  id: string;
  pageId: string;
  type: 'link' | 'image' | 'text' | 'pdf' | 'file';
  content: string;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  x?: number;
  y?: number;
  zIndex?: number;
  rotation?: number;
  isOwner?: boolean;
  created_at: string;
}

interface ResourceCardProps {
  resource: Resource;
  onDelete?: (id: string) => void;
  onUpdateText?: (id: string, content: string) => Promise<void>;
  readOnly?: boolean;
}

const TOKEN_CLASS_NAMES: Record<CodeTokenKind, string | undefined> = {
  plain: undefined,
  comment: styles.tokenComment,
  string: styles.tokenString,
  keyword: styles.tokenKeyword,
  literal: styles.tokenLiteral,
  number: styles.tokenNumber,
  tag: styles.tokenTag,
  punctuation: styles.tokenPunctuation,
};

function getCodePresentation(value: string) {
  const fencedCode = value.match(/^\s*```([\w.+-]*)\s*\n([\s\S]*?)\n```\s*$/);

  if (fencedCode) {
    return { content: fencedCode[2], language: fencedCode[1] || 'code' };
  }

  const codeSignals = [
    /(^|\n)\s*(?:import|export|const|let|var|function|class|interface|type|def|from|package|public|private|fn)\b/,
    /(?:=>|===|!==|&&|\|\||<\/?[A-Za-z][^>]*>)/,
    /(^|\n)\s*(?:\/\/|\/\*|\*|#!|#include\b)/,
    /[{}\[\]();]\s*(?:\n|$)/,
    /(^|\n)\s*["'][^"'\n]+["']\s*:\s*[^\n]+/,
    /(^|\n)\s*(?:def|class)\s+\w+\s*\([^)]*\)\s*:/,
    /[A-Za-z-]+\s*:\s*[^;\n]+;/,
  ];

  if (codeSignals.filter((signal) => signal.test(value)).length < 2) return null;

  let language = 'code';

  if (/^\s*[\[{][\s\S]*[\]}]\s*$/.test(value)) {
    try {
      JSON.parse(value);
      language = 'json';
    } catch {
      // Keep the generic label for code-like objects that are not valid JSON.
    }
  } else if (/<\/?[A-Za-z][^>]*>/.test(value)) {
    language = 'html';
  } else if (/(^|\n)\s*(?:def|from\s+\w+\s+import)(?:\s|\()/m.test(value)) {
    language = 'python';
  } else if (/(^|\n)\s*(?:interface|type)\s+\w+|:\s*(?:string|number|boolean)\b/.test(value)) {
    language = 'typescript';
  } else if (/(^|\n)\s*(?:import|export|const|let|var|function|class)\b|=>/.test(value)) {
    language = 'javascript';
  }

  return { content: value, language };
}

function getSafeResourceUrl(value: string, type: Resource["type"]): string | null {
  const url = value.trim();
  if (!url) return null;

  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;,]+);base64,[A-Za-z0-9+/=\r\n]+$/i);
    if (!match) return null;
    const mimeType = match[1].toLowerCase();
    const safeImages = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
    if (type === "image") return safeImages.has(mimeType) ? url : null;
    if (type === "pdf") return mimeType === "application/pdf" ? url : null;
    if (type === "file") {
      return mimeType === "application/octet-stream" || mimeType === "application/pdf" || safeImages.has(mimeType)
        ? url
        : null;
    }
    return null;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function getSafeHttpUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export default function ResourceCard({ resource, onDelete, onUpdateText, readOnly = false }: ResourceCardProps) {
  const [copied, setCopied] = useState(false);
  const [textDraft, setTextDraft] = useState<{ baseContent: string; value: string } | null>(null);
  const [isSavingText, setIsSavingText] = useState(false);
  const [textEditError, setTextEditError] = useState<string | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const codeHighlightRef = useRef<HTMLPreElement>(null);
  const [showHighlight, setShowHighlight] = useState(
    () => Date.now() - new Date(resource.created_at).getTime() < 5000
  );
  const draftContent = textDraft?.baseContent === resource.content ? textDraft.value : resource.content;
  const safeResourceUrl = getSafeResourceUrl(resource.content, resource.type);
  const safeThumbnailUrl = getSafeHttpUrl(resource.thumbnailUrl);
  const safeLinkHostname = resource.type === "link" && safeResourceUrl
    ? new URL(safeResourceUrl).hostname
    : "Unavailable link";

  useEffect(() => {
    if (showHighlight) {
      const timer = setTimeout(() => setShowHighlight(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showHighlight]);

  useEffect(() => {
    if (!contextMenuPosition) return;

    const closeContextMenu = () => setContextMenuPosition(null);
    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      closeContextMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu();
    };

    document.addEventListener('pointerdown', handleDocumentPointerDown);
    document.addEventListener('keydown', handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => {
      contextMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    });
    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.cancelAnimationFrame(focusFrame);
    };
  }, [contextMenuPosition]);


  const canEditText = resource.type === 'text' && !readOnly && Boolean(onUpdateText);
  const canDelete = !readOnly && Boolean(onDelete);

  const stopInteractivePointerEvent = (event: React.PointerEvent<HTMLElement>) => {
    // Resource cards live inside a Framer Motion draggable. Stopping at pointer-down
    // prevents a click on a control from becoming a card or canvas drag.
    event.stopPropagation();
  };

  const stopInteractiveClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const getContextMenuPosition = (left: number, top: number) => {
    const menuWidth = 144;
    const menuHeight = 42;
    const viewportPadding = 8;

    return {
      left: Math.max(viewportPadding, Math.min(left, window.innerWidth - menuWidth - viewportPadding)),
      top: Math.max(viewportPadding, Math.min(top, window.innerHeight - menuHeight - viewportPadding)),
    };
  };

  const openContextMenu = (left: number, top: number) => {
    if (!canDelete) return;
    setContextMenuPosition(getContextMenuPosition(left, top));
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!canDelete) return;
    event.preventDefault();
    event.stopPropagation();
    openContextMenu(event.clientX, event.clientY);
  };

  const handleCardPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Right-click should only open the context menu; it must never initialise drag.
    if (event.button !== 0) event.stopPropagation();
  };

  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!canDelete || (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))) return;

    event.preventDefault();
    event.stopPropagation();
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    openContextMenu(rect.left + Math.min(20, rect.width / 2), rect.top + Math.min(20, rect.height / 2));
  };

  const saveTextContent = async () => {
    if (!canEditText || !onUpdateText) return;

    if (draftContent === resource.content) {
      setTextDraft(null);
      return;
    }

    if (draftContent.trim().length === 0) {
      setTextEditError('Text cannot be empty.');
      return;
    }

    setIsSavingText(true);
    setTextEditError(null);

    try {
      await onUpdateText(resource.id, draftContent);
      setTextDraft(null);
    } catch (error) {
      setTextEditError(error instanceof Error ? error.message : 'Unable to save this text.');
    } finally {
      setIsSavingText(false);
    }
  };

  const handleTextKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setTextDraft(null);
      setTextEditError(null);
      event.currentTarget.blur();
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDownloadFile = async (url: string, filename: string, type: Resource["type"]) => {
    const safeUrl = getSafeResourceUrl(url, type);
    if (!safeUrl) return;
    try {
      const res = await fetch(safeUrl);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    } catch (e) {
      console.error("Failed to download file", e);
      window.open(safeUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handlePreview = async (url: string, rtype: 'pdf' | 'file') => {
    const safeUrl = getSafeResourceUrl(url, rtype);
    if (!safeUrl) return;
    if (rtype === 'file') {
      window.open(safeUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">Loading PDF preview...</div>';
      try {
        const res = await fetch(safeUrl);
        const blob = await res.blob();
        const pdfBlob = new Blob([blob], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(pdfBlob);
        newWindow.location.href = blobUrl;
      } catch {
        newWindow.close();
        window.open(safeUrl, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const handleCopyImage = async (url: string) => {
    const safeUrl = getSafeResourceUrl(url, "image");
    if (!safeUrl) return;
    try {
      const response = await fetch(safeUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob
        })
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy image to clipboard", err);
      // Fallback to text
      handleCopy(safeUrl);
    }
  };

  const handleOpenResource = (url: string, type: Extract<Resource['type'], 'image' | 'link' | 'file'>) => {
    const safeUrl = getSafeResourceUrl(url, type);
    if (safeUrl) window.open(safeUrl, '_blank', 'noopener,noreferrer');
  };

  const baseCardStyle = styles.mediaCard;
  const cardFrameStyle = "relative overflow-hidden w-full h-full rounded-[12px] shadow-[0px_2px_4px_-1px_rgba(0,0,0,0.18)] border flex flex-col transition-all duration-300 cursor-pointer";

  const renderCardContent = () => {
    switch (resource.type) {
      case 'image':
        return (
          <div className={styles.imageCard} style={{ aspectRatio: '1/1.05' }}>
            {safeResourceUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={safeResourceUrl} alt="Pasted image" className={styles.imagePreview} draggable={false} />
            ) : (
              <span className={styles.emptyPreview}>Image unavailable</span>
            )}
            <div className={`${styles.imageActions} ${styles.actionBar}`}>
              <button type="button" disabled={!safeResourceUrl} onPointerDown={stopInteractivePointerEvent} onClick={(event) => { stopInteractiveClick(event); handleOpenResource(resource.content, 'image'); }} className={styles.actionButton} title="Open image" aria-label="Open image">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/icon-image.svg" alt="" className={styles.actionIcon} />
              </button>
              <button type="button" disabled={!safeResourceUrl} onPointerDown={stopInteractivePointerEvent} onClick={(event) => { stopInteractiveClick(event); void handleDownloadFile(resource.content, resource.title || 'image.png', 'image'); }} className={styles.actionButton} title="Download image" aria-label="Download image">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/icon-download.svg" alt="" className={styles.actionIcon} />
              </button>
              <button type="button" disabled={!safeResourceUrl} onPointerDown={stopInteractivePointerEvent} onClick={(event) => { stopInteractiveClick(event); void handleCopyImage(resource.content); }} className={styles.actionButton} title={copied ? "Image copied" : "Copy image"} aria-label={copied ? "Image copied" : "Copy image"}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={copied ? "/icons/icon-check.svg" : "/icons/icon-copy.svg"} alt="" className={styles.actionIcon} />
              </button>
            </div>
          </div>
        );

      case 'pdf':
        return (
          <div className={`${baseCardStyle} ${styles.documentCard}`} style={{ minHeight: 250 }}>
            <div className={styles.documentPreviewSurface}>
              <div className={`${styles.documentGlyph} ${styles.pdfGlyph}`} aria-hidden="true"><span>PDF</span></div>
            </div>
            <div className={styles.documentFooter}>
              <h3 className={styles.documentTitle}>{resource.title || 'Document.pdf'}</h3>
              <div className={styles.actionBar}>
                <button type="button" disabled={!safeResourceUrl} onPointerDown={stopInteractivePointerEvent} onClick={(event) => { stopInteractiveClick(event); void handlePreview(resource.content, 'pdf'); }} className={styles.actionButton} title="Preview PDF" aria-label="Preview PDF">
                  <img src="/icons/icon-document.svg" alt="" className={styles.actionIcon} />
                </button>
                <button type="button" disabled={!safeResourceUrl} onPointerDown={stopInteractivePointerEvent} onClick={(event) => { stopInteractiveClick(event); void handleDownloadFile(resource.content, resource.title || 'document.pdf', 'pdf'); }} className={styles.actionButton} title="Download PDF" aria-label="Download PDF">
                  <img src="/icons/icon-download.svg" alt="" className={styles.actionIcon} />
                </button>
                <button type="button" onPointerDown={stopInteractivePointerEvent} onClick={(event) => { stopInteractiveClick(event); void handleCopy(`${window.location.origin}/link/download/${resource.id}`); }} className={styles.actionButton} title={copied ? "Download link copied" : "Copy download link"} aria-label={copied ? "Download link copied" : "Copy download link"}>
                  <img src={copied ? "/icons/icon-check.svg" : "/icons/icon-copy.svg"} alt="" className={styles.actionIcon} />
                </button>
              </div>
            </div>
          </div>
        );

      case 'file': {
        let ext = 'FILE';
        if (resource.title) {
          const parts = resource.title.split('.');
          if (parts.length > 1) ext = parts.pop()!.toUpperCase().slice(0, 4);
        }
        return (
          <div className={`${baseCardStyle} ${styles.documentCard}`} style={{ minHeight: 250 }}>
            <div className={styles.documentPreviewSurface}>
              <div className={`${styles.documentGlyph} ${styles.fileGlyph}`} aria-hidden="true"><span>{ext}</span></div>
            </div>
            <div className={styles.documentFooter}>
              <h3 className={`${styles.documentTitle} ${styles.breakableTitle}`}>{resource.title || 'Document.file'}</h3>
              <div className={styles.actionBar}>
                <button type="button" disabled={!safeResourceUrl} onPointerDown={stopInteractivePointerEvent} onClick={(event) => { stopInteractiveClick(event); void handlePreview(resource.content, 'file'); }} className={styles.actionButton} title="Open file" aria-label="Open file">
                  <img src="/icons/icon-document.svg" alt="" className={styles.actionIcon} />
                </button>
                <button type="button" disabled={!safeResourceUrl} onPointerDown={stopInteractivePointerEvent} onClick={(event) => { stopInteractiveClick(event); void handleDownloadFile(resource.content, resource.title || 'file', 'file'); }} className={styles.actionButton} title="Download file" aria-label="Download file">
                  <img src="/icons/icon-download.svg" alt="" className={styles.actionIcon} />
                </button>
                <button type="button" onPointerDown={stopInteractivePointerEvent} onClick={(event) => { stopInteractiveClick(event); void handleCopy(`${window.location.origin}/link/download/${resource.id}`); }} className={styles.actionButton} title={copied ? "Download link copied" : "Copy download link"} aria-label={copied ? "Download link copied" : "Copy download link"}>
                  <img src={copied ? "/icons/icon-check.svg" : "/icons/icon-copy.svg"} alt="" className={styles.actionIcon} />
                </button>
              </div>
            </div>
          </div>
        );
      }

      case 'link':
        return (
          <div className={`${baseCardStyle} ${styles.linkCard}`} onClick={() => { if (safeResourceUrl) handleOpenResource(resource.content, 'link'); }} style={{ minHeight: 280 }}>
            <div className={styles.linkPreview}>
              {safeThumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={safeThumbnailUrl} alt="Link preview" className={styles.linkPreviewImage} draggable={false} />
              ) : (
                <span className={styles.linkHostname}>{safeLinkHostname}</span>
              )}
            </div>
            <div className={styles.linkFooter}>
              <h3 className={styles.linkTitle}>{resource.title || safeLinkHostname}</h3>
              {resource.description && <p className={styles.linkDescription}>{resource.description}</p>}
              <div className={`${styles.actionBar} ${styles.linkActions}`}>
                <button type="button" disabled={!safeResourceUrl} onPointerDown={stopInteractivePointerEvent} onClick={(event) => { stopInteractiveClick(event); handleOpenResource(resource.content, 'link'); }} className={styles.actionButton} title="Open link" aria-label="Open link">
                  <img src="/icons/icon-link.svg" alt="" className={styles.actionIcon} />
                </button>
                <button type="button" disabled={!safeResourceUrl} onPointerDown={stopInteractivePointerEvent} onClick={(event) => { stopInteractiveClick(event); if (safeResourceUrl) void handleCopy(safeResourceUrl); }} className={styles.actionButton} title={copied ? "Link copied" : "Copy link"} aria-label={copied ? "Link copied" : "Copy link"}>
                  <img src={copied ? "/icons/icon-check.svg" : "/icons/icon-copy.svg"} alt="" className={styles.actionIcon} />
                </button>
              </div>
            </div>
          </div>
        );

    case 'text':
    default: {
      const code = getCodePresentation(resource.content);

      if (code) {
        const highlightedCode = tokenizeCode(canEditText ? draftContent : code.content);

        return (
          <div className={`${cardFrameStyle} min-h-[180px] border-white/10 bg-[#17191f] hover:border-white/25`}>
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.08] bg-white/[0.035] px-3">
              <div className="flex items-center gap-1.5" aria-hidden="true">
                <span className="h-2 w-2 rounded-full bg-[#ff6b6b]/80" />
                <span className="h-2 w-2 rounded-full bg-[#ffd166]/80" />
                <span className="h-2 w-2 rounded-full bg-[#55d187]/80" />
              </div>
              <div className="flex items-center gap-2">
                {(isSavingText || textEditError) && (
                  <span className="text-[9px] font-medium text-white/45" role="status" aria-live="polite" title={textEditError || undefined}>
                    {isSavingText ? "Saving…" : "Not saved"}
                  </span>
                )}
                <button
                  type="button"
                  onPointerDown={stopInteractivePointerEvent}
                  onClick={(event) => { stopInteractiveClick(event); void handleCopy(draftContent); }}
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-none bg-transparent transition-colors hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
                  title={copied ? "Code copied" : "Copy code"}
                  aria-label={copied ? "Code copied" : "Copy code"}
                >
                  <img
                    src={copied ? "/icons/icon-check.svg" : "/icons/icon-copy.svg"}
                    alt=""
                    className="h-[16px] w-[16px] opacity-70"
                    style={{ filter: 'brightness(0) invert(1)' }}
                  />
                </button>
              </div>
            </div>
            {canEditText ? (
              <div className={styles.codeEditor}>
                <pre ref={codeHighlightRef} className={styles.codeHighlight} aria-hidden="true">
                  <code>
                    {highlightedCode.map((token, index) => (
                      <span className={TOKEN_CLASS_NAMES[token.kind]} key={`${index}-${token.kind}`}>{token.text}</span>
                    ))}
                  </code>
                </pre>
                <textarea
                  value={draftContent}
                  onChange={(event) => { setTextDraft({ baseContent: resource.content, value: event.target.value }); setTextEditError(null); }}
                  onBlur={() => { void saveTextContent(); }}
                  onKeyDown={handleTextKeyDown}
                  onPointerDown={stopInteractivePointerEvent}
                  onScroll={(event) => {
                    if (!codeHighlightRef.current) return;
                    codeHighlightRef.current.scrollTop = event.currentTarget.scrollTop;
                    codeHighlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
                  }}
                  className={styles.codeInput}
                  aria-label="Edit copied code"
                  aria-invalid={Boolean(textEditError)}
                  spellCheck={false}
                />
              </div>
            ) : (
              <pre className="scrollbar-hide m-0 flex-1 overflow-auto p-4 text-[12px] leading-[1.65] text-[#e7e9ee]" style={{ tabSize: 2 }}>
                <code className="font-mono whitespace-pre">
                  {highlightedCode.map((token, index) => (
                    <span className={TOKEN_CLASS_NAMES[token.kind]} key={`${index}-${token.kind}`}>{token.text}</span>
                  ))}
                </code>
              </pre>
            )}
          </div>
        );
      }

      return (
        <article
          className={`${cardFrameStyle} min-h-[180px] border-[#d8d1bd] bg-[#fffdf4] text-[#25241f] hover:border-[#b8ad91]`}
          style={{ backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 28px, rgba(85, 104, 126, 0.095) 29px)', backgroundPosition: '0 11px' }}
        >
          <div className="pointer-events-none absolute inset-y-0 left-[30px] w-px bg-[#df8d8d]/35" aria-hidden="true" />
          <div className="scrollbar-hide flex flex-1 flex-col overflow-auto py-[20px] pl-[43px] pr-[56px]">
            {resource.title && (
              <h3 className="relative top-px m-0 h-[29px] shrink-0 break-words text-[10px] font-semibold uppercase leading-[29px] tracking-[0.14em] text-[#6d685b]">{resource.title}</h3>
            )}
            {canEditText ? (
              <textarea
                value={draftContent}
                onChange={(event) => { setTextDraft({ baseContent: resource.content, value: event.target.value }); setTextEditError(null); }}
                onBlur={() => { void saveTextContent(); }}
                onKeyDown={handleTextKeyDown}
                onPointerDown={stopInteractivePointerEvent}
                className="scrollbar-hide min-h-0 w-full flex-1 resize-none overflow-auto border-none bg-transparent p-0 font-arimo text-[13px] leading-[29px] text-[#282720] caret-[#282720] outline-none"
                aria-label="Edit copied text"
                aria-invalid={Boolean(textEditError)}
                rows={1}
              />
            ) : (
              <p className="m-0 whitespace-pre-wrap break-words font-arimo text-[13px] leading-[29px] text-[#282720]">{resource.content}</p>
            )}
          </div>
          {(isSavingText || textEditError) && (
            <span className="absolute bottom-2 left-[43px] z-10 max-w-[185px] truncate rounded-full bg-[#fffdf4]/95 px-2 py-0.5 text-[9px] font-medium text-[#6d685b] shadow-sm" role="status" aria-live="polite" title={textEditError || undefined}>
              {isSavingText ? "Saving…" : textEditError}
            </span>
          )}
          <button
            type="button"
            onPointerDown={stopInteractivePointerEvent}
            onClick={(event) => { stopInteractiveClick(event); void handleCopy(draftContent); }}
            className="absolute right-3 top-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[#25241f]/10 bg-[#fffdf4]/90 shadow-[0_2px_8px_rgba(54,48,31,0.08)] backdrop-blur-sm transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#25241f]/55"
            title={copied ? "Text copied" : "Copy text"}
            aria-label={copied ? "Text copied" : "Copy text"}
          >
            <img src={copied ? "/icons/icon-check.svg" : "/icons/icon-copy.svg"} alt="" className="h-[16px] w-[16px] opacity-55" />
          </button>
        </article>
      );
    }
  }
  };

  return (
    <div
      ref={cardRef}
      className={`${styles.cardRoot} relative group w-full h-full`}
      tabIndex={canDelete ? 0 : undefined}
      role={canDelete ? 'group' : undefined}
      aria-label={canDelete ? `${resource.title || resource.type} resource. Press Shift+F10 for actions.` : undefined}
      onPointerDown={handleCardPointerDown}
      onContextMenu={handleContextMenu}
      onKeyDown={handleCardKeyDown}
    >
      {showHighlight && (
        <div className={styles.newResourceHighlight} aria-hidden="true" />
      )}
      {renderCardContent()}
      {contextMenuPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={contextMenuRef}
          className={styles.contextMenu}
          role="menu"
          aria-label="Resource actions"
          style={contextMenuPosition}
          onPointerDown={stopInteractivePointerEvent}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
        >
          <button
            type="button"
            role="menuitem"
            className={styles.contextMenuDelete}
            onPointerDown={stopInteractivePointerEvent}
            onClick={(event) => {
              stopInteractiveClick(event);
              setContextMenuPosition(null);
              onDelete?.(resource.id);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-trash.svg" alt="" aria-hidden="true" />
            Delete
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
