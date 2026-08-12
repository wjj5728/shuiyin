"use client";

import { Rnd } from "react-rnd";
import type { ChangeEvent, DragEvent, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

type ImageItem = {
  id: string;
  file: File;
  url: string;
  width: number;
  height: number;
  selected: boolean;
};

type WatermarkImage = {
  file: File;
  url: string;
  width: number;
  height: number;
};

type Settings = {
  size: number;
  opacity: number;
  angle: number;
  x: number;
  y: number;
};

type RotationInteraction = {
  pointerId: number;
  centerX: number;
  centerY: number;
  startPointerAngle: number;
  startRotation: number;
};

const initialSettings: Settings = {
  size: 28,
  opacity: 62,
  angle: -18,
  x: 78,
  y: 80,
};

type WatermarkPreset = {
  name: string;
  src: string;
  fileName: string;
};

const watermarkPresets: WatermarkPreset[] = [
  {
    name: "红色印章",
    src: "/watermarks/stamp-red.png",
    fileName: "红色印章.png",
  },
];

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAngle(angle: number) {
  return `${angle > 0 ? "+" : ""}${angle}°`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function pointerAngle(clientX: number, clientY: number, centerX: number, centerY: number) {
  return (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI;
}

function shortestAngleDelta(current: number, start: number) {
  let delta = current - start;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function loadImageAsset(file: File): Promise<Omit<WatermarkImage, "file">> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () =>
      resolve({
        url,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image-load-failed"));
    };
    image.src = url;
  });
}

export default function Home() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [watermark, setWatermark] = useState<WatermarkImage | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [isDragging, setIsDragging] = useState(false);
  const [isWatermarkDragging, setIsWatermarkDragging] = useState(false);
  const [showWatermarkPresets, setShowWatermarkPresets] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [notice, setNotice] = useState("准备好了，拖入图片开始编辑");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const watermarkInputRef = useRef<HTMLInputElement>(null);
  const canvasFrameRef = useRef<HTMLDivElement>(null);
  const rotationInteractionRef = useRef<RotationInteraction | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });

  const activeItem = useMemo(
    () => items.find((item) => item.id === activeId) ?? items[0] ?? null,
    [activeId, items],
  );
  const selectedItems = useMemo(() => items.filter((item) => item.selected), [items]);

  useEffect(() => {
    const element = canvasFrameRef.current;
    if (!element) return;

    const updateFrameSize = () =>
      setFrameSize({ width: element.clientWidth, height: element.clientHeight });
    updateFrameSize();

    const observer = new ResizeObserver(updateFrameSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [activeItem?.id]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice("浏览器本地处理 · 不上传服务器"), 3200);
  };

  const addFiles = async (fileList: FileList | File[]) => {
    const imageFiles = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) {
      showNotice("请选择 JPG、PNG 或 WebP 图片");
      return;
    }

    const results = await Promise.allSettled(
      imageFiles.map(async (file) => ({
        ...(await loadImageAsset(file)),
        id: `${file.name}-${file.lastModified}-${Math.random()}`,
        file,
        selected: true,
      })),
    );
    const loaded = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );

    if (!loaded.length) {
      showNotice("图片读取失败，请重试或更换图片");
      return;
    }

    setItems((current) => [...current, ...loaded]);
    setActiveId((current) => current ?? loaded[0]?.id ?? null);
    const failedCount = results.length - loaded.length;
    showNotice(
      failedCount
        ? `${loaded.length} 张图片已加入，${failedCount} 张读取失败`
        : `${loaded.length} 张图片已加入编辑队列`,
    );
  };

  const applyWatermarkFile = async (file: File, message: string) => {
    try {
      const loaded = await loadImageAsset(file);
      setWatermark((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return { ...loaded, file };
      });
      showNotice(message);
    } catch {
      showNotice("水印图片读取失败，请重试");
    }
  };

  const addWatermark = async (fileList: FileList | File[]) => {
    const file = Array.from(fileList).find((candidate) => candidate.type.startsWith("image/"));
    if (!file) {
      showNotice("请选择 PNG、JPG 或 WebP 水印图片");
      return;
    }

    await applyWatermarkFile(file, `水印图片已上传：${file.name}`);
  };

  const selectWatermarkPreset = async (preset: WatermarkPreset) => {
    try {
      const response = await fetch(preset.src);
      if (!response.ok) throw new Error("preset-fetch-failed");
      const blob = await response.blob();
      const file = new File([blob], preset.fileName, {
        type: blob.type || "image/png",
      });
      await applyWatermarkFile(file, `已应用本地水印：${preset.name}`);
      setShowWatermarkPresets(false);
    } catch {
      showNotice("本地水印加载失败，请稍后重试");
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void addFiles(event.target.files);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void addFiles(event.dataTransfer.files);
  };

  const onWatermarkChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void addWatermark(event.target.files);
    event.target.value = "";
  };

  const onWatermarkDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsWatermarkDragging(false);
    void addWatermark(event.dataTransfer.files);
  };

  const clearWatermark = () => {
    setWatermark((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    showNotice("水印图片已移除");
  };

  const updateSettings = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const renderedWatermarkSize = useMemo(() => {
    if (!watermark || !frameSize.width || !frameSize.height) return null;
    const width = (frameSize.width * settings.size) / 100;
    return {
      width,
      height: width * (watermark.height / watermark.width),
    };
  }, [frameSize, settings.size, watermark]);

  const updateWatermarkPosition = (x: number, y: number, width = renderedWatermarkSize?.width, height = renderedWatermarkSize?.height) => {
    if (!frameSize.width || !frameSize.height || !width || !height) return;
    const halfWidth = (width / frameSize.width) * 50;
    const halfHeight = (height / frameSize.height) * 50;
    setSettings((current) => ({
      ...current,
      x: clamp((x + width / 2) / frameSize.width * 100, halfWidth, 100 - halfWidth),
      y: clamp((y + height / 2) / frameSize.height * 100, halfHeight, 100 - halfHeight),
    }));
  };

  const handleWatermarkDrag = (_event: unknown, data: { x: number; y: number }) => {
    updateWatermarkPosition(data.x, data.y);
  };

  const handleWatermarkResize = (
    _event: unknown,
    _direction: unknown,
    elementRef: HTMLElement,
    _delta: unknown,
    position: { x: number; y: number },
  ) => {
    if (!frameSize.width) return;
    const nextSize = (elementRef.offsetWidth / frameSize.width) * 100;
    setSettings((current) => ({ ...current, size: nextSize }));
    updateWatermarkPosition(position.x, position.y, elementRef.offsetWidth, elementRef.offsetHeight);
  };

  const beginWatermarkRotation = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const shell = event.currentTarget.closest(".preview-watermark-shell");
    if (!shell) return;

    event.preventDefault();
    event.stopPropagation();
    const rect = shell.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    rotationInteractionRef.current = {
      pointerId: event.pointerId,
      centerX,
      centerY,
      startPointerAngle: pointerAngle(event.clientX, event.clientY, centerX, centerY),
      startRotation: settings.angle,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveWatermarkRotation = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const interaction = rotationInteractionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;

    event.preventDefault();
    const currentPointerAngle = pointerAngle(
      event.clientX,
      event.clientY,
      interaction.centerX,
      interaction.centerY,
    );
    const nextRotation = interaction.startRotation + shortestAngleDelta(
      currentPointerAngle,
      interaction.startPointerAngle,
    );
    setSettings((current) => ({ ...current, angle: Math.round(nextRotation) }));
  };

  const endWatermarkRotation = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (rotationInteractionRef.current?.pointerId !== event.pointerId) return;
    rotationInteractionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const toggleItem = (id: string) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item)),
    );
  };

  const removeItem = (id: string) => {
    setItems((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      const remaining = current.filter((item) => item.id !== id);
      if (id === activeId) setActiveId(remaining[0]?.id ?? null);
      return remaining;
    });
    showNotice("图片已移出队列");
  };

  const clearAll = () => {
    items.forEach((item) => URL.revokeObjectURL(item.url));
    setItems([]);
    setActiveId(null);
    showNotice("编辑队列已清空");
  };

  const getExportBlob = async (item: ImageItem) => {
    if (!watermark) throw new Error("watermark-unavailable");

    const image = new Image();
    image.src = item.url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image-load-failed"));
    });

    const canvas = document.createElement("canvas");
    canvas.width = item.width;
    canvas.height = item.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas-unavailable");

    context.drawImage(image, 0, 0, item.width, item.height);
    const watermarkImage = new Image();
    watermarkImage.src = watermark.url;
    await new Promise<void>((resolve, reject) => {
      watermarkImage.onload = () => resolve();
      watermarkImage.onerror = () => reject(new Error("watermark-load-failed"));
    });

    const watermarkWidth = Math.max(1, Math.round(item.width * (settings.size / 100)));
    const watermarkHeight = Math.max(
      1,
      Math.round(watermarkWidth * (watermark.height / watermark.width)),
    );
    context.globalAlpha = settings.opacity / 100;

    const x = (item.width * settings.x) / 100;
    const y = (item.height * settings.y) / 100;
    context.save();
    context.translate(x, y);
    context.rotate((settings.angle * Math.PI) / 180);
    context.drawImage(
      watermarkImage,
      -watermarkWidth / 2,
      -watermarkHeight / 2,
      watermarkWidth,
      watermarkHeight,
    );
    context.restore();

    const mime = ["image/jpeg", "image/png", "image/webp"].includes(item.file.type)
      ? item.file.type
      : "image/png";
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("export-failed"))), mime, 1);
    });
  };

  const downloadBlob = (blob: Blob, item: ImageItem) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const extension = item.file.name.includes(".") ? item.file.name.split(".").pop() : "png";
    const baseName = item.file.name.replace(/\.[^/.]+$/, "");
    anchor.href = url;
    anchor.download = `${baseName}-watermarked.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadSelected = async () => {
    if (!selectedItems.length || !watermark || isDownloading) {
      if (!watermark && selectedItems.length) showNotice("请先上传水印图片");
      return;
    }
    setIsDownloading(true);
    showNotice("正在按原尺寸导出，请稍候…");
    try {
      for (const item of selectedItems) {
        const blob = await getExportBlob(item);
        downloadBlob(blob, item);
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
      showNotice(`${selectedItems.length} 张图片已开始下载`);
    } catch {
      showNotice("导出失败，请重试或换一张图片");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /></div>
          <div>
            <div className="brand-name">Picmark <span>Studio</span></div>
            <div className="brand-caption">BATCH IMAGE EDITOR</div>
          </div>
        </div>
        <div className="topbar-center"><span className="status-dot" />浏览器本地处理 · 不上传服务器</div>
        <button className="top-help" type="button" onClick={() => showNotice("文件只在当前浏览器内处理，不会离开你的设备")}>如何工作？ <span>↗</span></button>
      </header>

      <section className="hero-row">
        <div>
          <p className="eyebrow">WORKSPACE / 01</p>
          <h1>批量给图片<br /><em>加上你的标记</em></h1>
          <p className="hero-copy">拖入图片，调整一次水印设置，<br className="desktop-break" />所有成片都会保持原始清晰度。</p>
        </div>
        <div className="hero-note">
          <span className="note-number">01</span>
          <span>适合产品图、作品集<br />社媒内容与品牌素材</span>
        </div>
      </section>

      <section className="workspace">
        <aside className="control-panel">
          <div className="panel-heading">
            <div><span className="section-kicker">A</span><h2>水印设置</h2></div>
            <span className="live-pill"><span />实时</span>
          </div>

          <label className="field-label" htmlFor="watermark-image">水印图片</label>
          <div
            className={`watermark-upload${isWatermarkDragging ? " is-dragging" : ""}${watermark ? " has-image" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => watermarkInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                watermarkInputRef.current?.click();
              }
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsWatermarkDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsWatermarkDragging(false)}
            onDrop={onWatermarkDrop}
          >
            <input
              ref={watermarkInputRef}
              id="watermark-image"
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onClick={(event) => event.stopPropagation()}
              onChange={onWatermarkChange}
            />
            {watermark ? (
              <>
                <img className="watermark-thumb" src={watermark.url} alt="" />
                <div className="watermark-file-info">
                  <strong>{watermark.file.name}</strong>
                  <span>{watermark.width} × {watermark.height} · {formatBytes(watermark.file.size)}</span>
                </div>
                <button
                  type="button"
                  className="watermark-remove"
                  onClick={(event) => {
                    event.stopPropagation();
                    clearWatermark();
                  }}
                >
                  移除
                </button>
              </>
            ) : (
              <>
                <span className="watermark-upload-icon">＋</span>
                <div>
                  <strong>上传水印图片</strong>
                  <p>拖入透明 PNG，或点击选择</p>
                </div>
              </>
            )}
          </div>

          <div className="watermark-actions">
            <button
              type="button"
              className="preset-toggle"
              aria-expanded={showWatermarkPresets}
              onClick={() => setShowWatermarkPresets((current) => !current)}
            >
              <span>✦</span>
              {showWatermarkPresets ? "收起本地水印" : "选择本地水印"}
              <b>{watermarkPresets.length}</b>
            </button>
            <small>也可以上传自己的图片</small>
          </div>

          {showWatermarkPresets && (
            <div className="watermark-presets" aria-label="本地水印素材">
              {watermarkPresets.map((preset) => (
                <button
                  key={preset.src}
                  type="button"
                  className="watermark-preset-card"
                  onClick={() => void selectWatermarkPreset(preset)}
                >
                  <span className="watermark-preset-thumb">
                    <img src={preset.src} alt="" />
                  </span>
                  <span>{preset.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className="control-block">
            <div className="control-row"><label htmlFor="size">大小</label><output>{settings.size}%</output></div>
            <input id="size" className="range-input" type="range" min="8" max="90" value={settings.size} onChange={(event) => updateSettings("size", Number(event.target.value))} />
            <div className="range-hints"><span>小</span><span>大</span></div>
          </div>

          <div className="control-block">
            <div className="control-row"><label htmlFor="opacity">透明度</label><output>{settings.opacity}%</output></div>
            <input id="opacity" className="range-input" type="range" min="10" max="100" value={settings.opacity} onChange={(event) => updateSettings("opacity", Number(event.target.value))} />
            <div className="range-hints"><span>透明</span><span>实色</span></div>
          </div>

          <div className="control-block">
            <div className="control-row"><label htmlFor="angle">旋转</label><output>{formatAngle(settings.angle)}</output></div>
            <input id="angle" className="range-input" type="range" min="-180" max="180" value={settings.angle} onChange={(event) => updateSettings("angle", Number(event.target.value))} />
            <div className="range-hints"><span>−180°</span><span>0°</span><span>+180°</span></div>
          </div>

          <div className="control-block position-block">
            <div className="control-row"><span>位置</span><output>{Math.round(settings.x)}% · {Math.round(settings.y)}%</output></div>
            <p className="position-hint">拖动水印移动位置，拖右下角缩放，拖上方手柄旋转。</p>
          </div>

          <div className="privacy-card"><span className="privacy-icon">✦</span><div><strong>你的文件不会被上传</strong><p>所有图片处理都在当前设备完成。</p></div></div>
        </aside>

        <div className="editor-panel">
          <div className="editor-toolbar">
            <div className="toolbar-title"><span className="section-kicker">B</span><div><h2>图片预览</h2><p>{items.length ? `${selectedItems.length} / ${items.length} 张已选中` : "还没有图片"}</p></div></div>
            {items.length > 0 && <button type="button" className="clear-button" onClick={clearAll}>清空全部 <span>×</span></button>}
          </div>

          {items.length === 0 ? (
            <div className={isDragging ? "upload-zone is-dragging" : "upload-zone"} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setIsDragging(false)} onDrop={onDrop}>
              <input ref={fileInputRef} name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="选择需要加水印的图片，可多选" onChange={onFileChange} />
              <div className="upload-icon"><span>＋</span></div>
              <h3>把图片拖到这里</h3>
              <p>可一次选择多张图片，或</p>
              <button type="button" className="browse-button" onClick={() => fileInputRef.current?.click()}>从设备选择图片 <span>↗</span></button>
              <div className="upload-meta"><span>JPG</span><span>PNG</span><span>WEBP</span><i />支持多选 · 单张最大 25 MB</div>
            </div>
          ) : (
            <div className="preview-layout">
              <div className="preview-stage">
                {activeItem && <div ref={canvasFrameRef} className="canvas-frame" style={{ aspectRatio: `${activeItem.width} / ${activeItem.height}` }}><img className="source-image" src={activeItem.url} alt={activeItem.file.name} />{watermark && renderedWatermarkSize && <Rnd
                  className="preview-watermark-shell"
                  bounds="parent"
                  size={renderedWatermarkSize}
                  position={{
                    x: (frameSize.width * settings.x) / 100 - renderedWatermarkSize.width / 2,
                    y: (frameSize.height * settings.y) / 100 - renderedWatermarkSize.height / 2,
                  }}
                  minWidth={frameSize.width * 0.08}
                  maxWidth={frameSize.width * 0.9}
                  lockAspectRatio={watermark.width / watermark.height}
                  enableResizing={{ bottomRight: true }}
                  resizeHandleClasses={{ bottomRight: "watermark-resize-handle" }}
                  cancel=".watermark-resize-handle, .watermark-rotate-handle"
                  style={{ opacity: settings.opacity / 100, transform: `rotate(${settings.angle}deg)`, transformOrigin: "center", touchAction: "none" }}
                  onDragStop={handleWatermarkDrag}
                  onResizeStop={handleWatermarkResize}
                >
                  <img className="preview-watermark" src={watermark.url} alt="当前水印" draggable={false} />
                  <button type="button" className="watermark-rotate-handle" aria-label="拖动旋转水印" onPointerDown={beginWatermarkRotation} onPointerMove={moveWatermarkRotation} onPointerUp={endWatermarkRotation} onPointerCancel={endWatermarkRotation}>↻</button>
                </Rnd>}<div className="frame-badge">预览</div></div>}
                <div className="stage-footer"><span>{activeItem?.file.name}</span><span>{activeItem ? `${activeItem.width} × ${activeItem.height} · ${formatBytes(activeItem.file.size)}` : ""}</span></div>
              </div>
              <div className="thumb-strip">
                {items.map((item, index) => <div key={item.id} className={item.id === activeItem?.id ? "thumb-card is-active" : "thumb-card"}>
                  <button type="button" className="thumb-select" onClick={() => toggleItem(item.id)} aria-label={`${item.selected ? "取消选择" : "选择"} ${item.file.name}`} aria-pressed={item.selected}>{item.selected ? "✓" : ""}</button>
                  <button type="button" className="thumb-image-button" onClick={() => setActiveId(item.id)}><img src={item.url} alt={`第 ${index + 1} 张：${item.file.name}`} /></button>
                  <div className="thumb-meta"><span>{String(index + 1).padStart(2, "0")}</span><button type="button" onClick={() => removeItem(item.id)} aria-label={`移除 ${item.file.name}`}>×</button></div>
                </div>)}
                <button type="button" className="add-more-card" onClick={() => fileInputRef.current?.click()}><span>＋</span><small>继续添加 · 可多选</small></button>
                <input ref={fileInputRef} name="images" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="继续添加需要加水印的图片，可多选" onChange={onFileChange} />
              </div>
            </div>
          )}

          <div className="editor-footer">
            <div className="footer-status"><span className="status-icon">↗</span><div><strong>{notice}</strong><small>{items.length ? watermark ? "调整设置会同步应用到选中的图片" : "请先在左侧上传水印图片" : "支持批量上传 · 处理过程无需联网"}</small></div></div>
            <div className="footer-actions"><button type="button" className="secondary-button" onClick={() => { setItems((current) => current.map((item) => ({ ...item, selected: true }))); showNotice("已选中全部图片"); }} disabled={!items.length}>应用到全部</button><button type="button" className="download-button" onClick={() => void downloadSelected()} disabled={!selectedItems.length || !watermark || isDownloading}><span>{isDownloading ? "导出中…" : "下载全部"}</span><b>↓</b></button></div>
          </div>
        </div>
      </section>

      <footer className="page-footer"><span>© 2025 Picmark Studio</span><span>原图尺寸导出 · 无质量压缩</span><span>Made for your workflow <b>↗</b></span></footer>
    </main>
  );
}
