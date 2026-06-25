import React, { useState, useEffect } from 'react';

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
  created_at: string;
}

interface ResourceCardProps {
  resource: Resource;
  onDelete?: (id: string) => void;
  readOnly?: boolean;
}

export default function ResourceCard({ resource, onDelete, readOnly = false }: ResourceCardProps) {
  const [copied, setCopied] = useState(false);
  const [showHighlight, setShowHighlight] = useState(false);

  useEffect(() => {
    // If the resource was created within the last 5 seconds, it's newly pasted.
    const isNew = Date.now() - new Date(resource.created_at).getTime() < 5000;
    if (isNew) {
      setShowHighlight(true);
      const timer = setTimeout(() => setShowHighlight(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [resource.created_at]);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDownloadFile = async (url: string, filename: string) => {
    try {
      const res = await fetch(url);
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
      window.open(url, '_blank');
    }
  };

  const handlePreview = async (url: string, e: React.MouseEvent, rtype: 'pdf' | 'file') => {
    e.stopPropagation();
    if (rtype === 'file') {
      window.open(url, '_blank');
      return;
    }
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">Loading PDF preview...</div>';
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const pdfBlob = new Blob([blob], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(pdfBlob);
        newWindow.location.href = blobUrl;
      } catch (err) {
        newWindow.close();
        window.open(url, '_blank');
      }
    }
  };

  const handleCopyImage = async (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    try {
      const response = await fetch(url);
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
      handleCopy(url);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) onDelete(resource.id);
  };

  const baseCardStyle = "relative overflow-hidden w-full h-full rounded-[12px] bg-[#1D1D1D] shadow-[0px_2px_4px_-1px_rgba(0,0,0,0.18)] border border-[#242424]/80 flex flex-col hover:border-white/20 transition-all duration-300 cursor-pointer";

  const renderDeleteBtn = () => (
    <button 
      type="button"
      onClick={handleDeleteClick}
      className="absolute bg-red-500 hover:bg-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-[0_2px_8px_rgba(0,0,0,0.5)] flex items-center justify-center border-none cursor-pointer hover:scale-110 z-30"
      style={{ width: 24, height: 24, top: -10, right: -10 }}
      aria-label="Delete Resource"
      title="Delete Resource"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icons/icon-trash.svg"
        alt="Delete"
        width={12}
        height={12}
        style={{ filter: "brightness(0) invert(1)" }}
      />
    </button>
  );

  const renderCardContent = () => {
    switch (resource.type) {
      case 'image':
      return (
        <div className={baseCardStyle} style={{ aspectRatio: '1/1.05' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resource.content} alt="Pasted Image" className="w-full h-full object-cover absolute inset-0 rounded-[12px] pointer-events-none" draggable={false} />
          <div className="absolute left-3 bottom-3 bg-[#1D1D1D] rounded-[12px] flex items-center p-1.5 gap-1 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-20">
            <button onClick={(e) => { e.stopPropagation(); handleDownloadFile(resource.content, resource.title || 'image.png'); }} className="p-1.5 hover:bg-white/10 rounded-[8px] transition-colors border-none cursor-pointer flex items-center justify-center" title="Download Image">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/icon-download.svg" alt="Download" className="w-[18px] h-[18px]" style={{ filter: 'brightness(0) invert(1)' }} />
            </button>
            <button onClick={(e) => handleCopyImage(e, resource.content)} className="p-1.5 hover:bg-white/10 rounded-[8px] transition-colors border-none cursor-pointer flex items-center justify-center" title="Copy Image">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={copied ? "/icons/icon-check.svg" : "/icons/icon-copy.svg"} alt="Copy" className="w-[18px] h-[18px]" style={{ filter: 'brightness(0) invert(1)' }} />
            </button>
          </div>
        </div>
      );

    case 'pdf':
      return (
        <div className={`${baseCardStyle} p-3`} style={{ minHeight: 250 }}>
          <div className="flex-1 rounded-[15px] bg-white flex flex-col items-center justify-center overflow-hidden border border-white/10 mb-3 min-h-[160px]">
            {/* PDF icon made of pure CSS to match the large red icon in Figma */}
            <div className="w-[80px] h-[100px] border-[5px] border-red-500 rounded-xl flex flex-col items-center justify-center bg-white relative">
               <div className="absolute top-0 right-0 w-0 h-0 border-t-[20px] border-l-[20px] border-t-red-100 border-l-transparent"></div>
               <span className="text-red-500 font-extrabold text-2xl tracking-tight mt-2">PDF</span>
               <div className="w-10 h-[5px] bg-red-500 mt-2 rounded-full"></div>
            </div>
          </div>
          <div className="px-1 flex flex-col gap-1 z-10">
             <h3 className="text-white font-bold text-[12px] m-0 line-clamp-1">{resource.title || 'Document.pdf'}</h3>
              <div className="mt-2 bg-[#1D1D1D] rounded-[12px] flex items-center p-0.5 gap-1 w-fit z-20">
                <button onClick={(e) => handlePreview(resource.content, e, 'pdf')} className="p-1.5 hover:bg-white/10 rounded-[8px] transition-colors border-none cursor-pointer flex items-center justify-center">
                   <img src="/icons/icon-document.svg" alt="Preview" className="w-[18px] h-[18px]" style={{ filter: 'brightness(0) invert(1)' }} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleDownloadFile(resource.content, resource.title || 'document.pdf'); }} className="p-1.5 hover:bg-white/10 rounded-[8px] transition-colors border-none cursor-pointer flex items-center justify-center">
                   <img src="/icons/icon-download.svg" alt="Download" className="w-[18px] h-[18px]" style={{ filter: 'brightness(0) invert(1)' }} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleCopy(`${window.location.origin}/link/download/${resource.id}`); }} className="p-1.5 hover:bg-white/10 rounded-[8px] transition-colors border-none cursor-pointer flex items-center justify-center">
                   <img src={copied ? "/icons/icon-check.svg" : "/icons/icon-copy.svg"} alt="Copy" className="w-[18px] h-[18px]" style={{ filter: 'brightness(0) invert(1)' }} />
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
        <div className={`${baseCardStyle} p-3`} style={{ minHeight: 250 }}>
          <div className="flex-1 rounded-[15px] bg-white flex flex-col items-center justify-center overflow-hidden border border-white/10 mb-3 min-h-[160px]">
            {/* Generic File icon made of pure CSS */}
            <div className="w-[80px] h-[100px] border-[5px] border-blue-500 rounded-xl flex flex-col items-center justify-center bg-white relative">
               <div className="absolute top-0 right-0 w-0 h-0 border-t-[20px] border-l-[20px] border-t-blue-100 border-l-transparent"></div>
               <span className="text-blue-500 font-extrabold text-xl tracking-tight mt-2">{ext}</span>
               <div className="w-10 h-[5px] bg-blue-500 mt-2 rounded-full"></div>
            </div>
          </div>
          <div className="px-1 flex flex-col gap-1 z-10">
             <h3 className="text-white font-bold text-[12px] m-0 line-clamp-1 break-all">{resource.title || 'Document.file'}</h3>
              <div className="mt-2 bg-[#1D1D1D] rounded-[12px] flex items-center p-0.5 gap-1 w-fit z-20">
                <button onClick={(e) => handlePreview(resource.content, e, 'file')} className="p-1.5 hover:bg-white/10 rounded-[8px] transition-colors border-none cursor-pointer flex items-center justify-center">
                   <img src="/icons/icon-document.svg" alt="Preview" className="w-[18px] h-[18px]" style={{ filter: 'brightness(0) invert(1)' }} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleDownloadFile(resource.content, resource.title || 'file'); }} className="p-1.5 hover:bg-white/10 rounded-[8px] transition-colors border-none cursor-pointer flex items-center justify-center">
                   <img src="/icons/icon-download.svg" alt="Download" className="w-[18px] h-[18px]" style={{ filter: 'brightness(0) invert(1)' }} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleCopy(`${window.location.origin}/link/download/${resource.id}`); }} className="p-1.5 hover:bg-white/10 rounded-[8px] transition-colors border-none cursor-pointer flex items-center justify-center">
                   <img src={copied ? "/icons/icon-check.svg" : "/icons/icon-copy.svg"} alt="Copy" className="w-[18px] h-[18px]" style={{ filter: 'brightness(0) invert(1)' }} />
                </button>
             </div>
          </div>
        </div>
      );
    }

    case 'link':
      return (
        <div className={`${baseCardStyle} p-3`} onClick={() => window.open(resource.content, '_blank')} style={{ minHeight: 280 }}>
          <div className="h-[180px] w-full shrink-0 overflow-hidden rounded-[15px] bg-white mb-3 flex items-center justify-center">
            {resource.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resource.thumbnailUrl} alt="Preview" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 pointer-events-none" draggable={false} />
            ) : (
              <span className="text-[#1D1D1D]/50 font-bold text-xl">{new URL(resource.content).hostname}</span>
            )}
          </div>
          
          <div className="px-1 flex flex-col gap-1 z-10 flex-1">
             <h3 className="text-white font-bold text-[12px] m-0 line-clamp-1 leading-snug">{resource.title || new URL(resource.content).hostname}</h3>
             {resource.description && (
               <p className="text-white/70 text-[10px] m-0 line-clamp-2 leading-tight mt-1">{resource.description}</p>
             )}
             
             <div className="mt-auto pt-2 bg-[#1D1D1D] rounded-[12px] flex items-center p-0.5 gap-1 w-fit">
                <button className="p-1.5 hover:bg-white/10 rounded-[8px] transition-colors border-none cursor-pointer flex items-center justify-center">
                   <img src="/icons/icon-link.svg" alt="Link" className="w-[18px] h-[18px]" style={{ filter: 'brightness(0) invert(1)' }} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleCopy(resource.content); }} className="p-1.5 hover:bg-white/10 rounded-[8px] transition-colors border-none cursor-pointer flex items-center justify-center">
                   <img src={copied ? "/icons/icon-check.svg" : "/icons/icon-copy.svg"} alt="Copy" className="w-[18px] h-[18px]" style={{ filter: 'brightness(0) invert(1)' }} />
                </button>
             </div>
          </div>
        </div>
      );

    case 'text':
    default:
      return (
        <div className={`${baseCardStyle} p-4`} style={{ minHeight: 180 }}>
          <div className="flex-1 overflow-y-auto pr-2 scrollbar-hide">
            <p className="text-white/80 text-sm whitespace-pre-wrap leading-relaxed m-0 font-arimo">{resource.content}</p>
          </div>
          <div className="mt-4 bg-[#1D1D1D] rounded-[12px] flex items-center p-0.5 gap-1 w-fit">
            <button onClick={() => handleCopy(resource.content)} className="p-1.5 hover:bg-white/10 rounded-[8px] transition-colors border-none cursor-pointer flex items-center justify-center text-white text-xs gap-1 pr-3">
               <img src={copied ? "/icons/icon-check.svg" : "/icons/icon-copy.svg"} alt="Copy" className="w-[16px] h-[16px]" style={{ filter: 'brightness(0) invert(1)' }} />
               {copied ? "Copied!" : "Copy Text"}
            </button>
          </div>
        </div>
      );
  }
  };

  return (
    <div className="relative group w-full h-full">
      {showHighlight && (
        <div className="absolute -inset-[3px] rounded-[15px] overflow-hidden z-[-1] pointer-events-none transition-opacity duration-500">
          <div 
            className="absolute top-1/2 left-1/2 w-[200%] h-[200%] -translate-x-1/2 -translate-y-1/2 animate-[spin_2s_linear_infinite]" 
            style={{ background: 'conic-gradient(from 0deg, transparent 0 320deg, #FFD700 360deg)' }} 
          />
        </div>
      )}
      {renderCardContent()}
      {!readOnly && renderDeleteBtn()}
    </div>
  );
}
