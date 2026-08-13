"use client";

import { Rnd } from "react-rnd";
import type { CSSProperties, ChangeEvent, DragEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createZipBlob, getZipFileName } from "@/lib/export-zip";
import { constrainSettingsToImage, rotatedBoundingBox } from "@/lib/watermark-geometry";

type ImageItem = {
  id: string;
  file: File;
  url: string;
  width: number;
  height: number;
  selected: boolean;
  settings: Settings;
  settingsCustomized: boolean;
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

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const initialSettings: Settings = {
  size: 28,
  opacity: 62,
  angle: -18,
  x: 78,
  y: 80,
};

const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxImageFileSize = 25 * 1024 * 1024;
const maxImagePixelCount = 32_000_000;
const maxZipOutputSize = 250 * 1024 * 1024;
const installDismissedAtKey = "picmark-install-dismissed-at";
const installReminderDelay = 7 * 24 * 60 * 60 * 1000;

function getInitialSettings(imageWidth: number, imageHeight: number, watermarkWidth?: number, watermarkHeight?: number) {
  const settings = { ...initialSettings };
  if (typeof window !== "undefined" && window.innerWidth <= 600 && watermarkWidth && watermarkHeight) {
    const frameAspect = imageWidth / imageHeight;
    const watermarkAspect = watermarkHeight / watermarkWidth;
    const mobileMaxSize = 16;
    const heightLimitedSize = (mobileMaxSize * frameAspect) / watermarkAspect;
    settings.size = Math.max(8, Math.min(initialSettings.size, mobileMaxSize, heightLimitedSize));
  }

  return watermarkWidth && watermarkHeight
    ? constrainSettingsToImage(imageWidth, imageHeight, watermarkWidth, watermarkHeight, settings)
    : settings;
}

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
  {
    name: "红色圆章｜已售",
    src: "/watermarks/sold-red.png",
    fileName: "红色圆章-已售.png",
  },
  {
    name: "蓝色标签｜已售",
    src: "/watermarks/sold-blue.png",
    fileName: "蓝色标签-已售.png",
  },
  {
    name: "金色手绘｜已售",
    src: "/watermarks/sold-gold.png",
    fileName: "金色手绘-已售.png",
  },
  {
    name: "黑色撕纸｜已售",
    src: "/watermarks/sold-black-sticker.png",
    fileName: "黑色撕纸-已售.png",
  },
  {
    name: "蓝色气泡｜已售",
    src: "/watermarks/sold-blue-bubble.png",
    fileName: "蓝色气泡-已售.png",
  },
  {
    name: "紫金菱形｜已售",
    src: "/watermarks/sold-purple-diamond.png",
    fileName: "紫金菱形-已售.png",
  },
  {
    name: "橙色票券｜已售",
    src: "/watermarks/sold-orange-banner.png",
    fileName: "橙色票券-已售.png",
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

function rangeStyle(value: number, min: number, max: number) {
  const progress = ((clamp(value, min, max) - min) / (max - min)) * 100;
  return { "--range-progress": `${progress}%` } as CSSProperties;
}

function getExportFileName(item: ImageItem) {
  const extension = item.file.name.includes(".") ? item.file.name.split(".").pop() : "png";
  const baseName = item.file.name.replace(/\.[^/.]+$/, "");
  return `${baseName}-watermarked.${extension}`;
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
    image.onload = () => {
      if (image.naturalWidth * image.naturalHeight > maxImagePixelCount) {
        URL.revokeObjectURL(url);
        reject(new Error("image-too-large"));
        return;
      }
      resolve({
        url,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
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
  const [isDragging, setIsDragging] = useState(false);
  const [isWatermarkDragging, setIsWatermarkDragging] = useState(false);
  const [showWatermarkPresets, setShowWatermarkPresets] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [exportAsZip, setExportAsZip] = useState(true);
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [notice, setNotice] = useState("准备好了，拖入图片开始编辑");
  const [showInstallCard, setShowInstallCard] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const watermarkInputRef = useRef<HTMLInputElement>(null);
  const canvasFrameRef = useRef<HTMLDivElement>(null);
  const rotationInteractionRef = useRef<RotationInteraction | null>(null);
  const watermarkLoadIdRef = useRef(0);
  const activeIdRef = useRef<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const exportCancelledRef = useRef(false);
  const itemsRef = useRef<ImageItem[]>([]);
  const watermarkRef = useRef<WatermarkImage | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });

  const activeItem = useMemo(
    () => items.find((item) => item.id === activeId) ?? items[0] ?? null,
    [activeId, items],
  );
  const selectedItems = useMemo(() => items.filter((item) => item.selected), [items]);
  const allItemsSelected = items.length > 0 && selectedItems.length === items.length;
  const settings = activeItem?.settings ?? initialSettings;

  useEffect(() => {
    activeIdRef.current = activeItem?.id ?? null;
  }, [activeItem?.id]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    watermarkRef.current = watermark;
  }, [watermark]);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const mobile = window.matchMedia("(max-width: 600px)").matches
      || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const iosTimer = window.setTimeout(() => setIsIos(ios), 0);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }

    const installWasRecentlyDismissed = () => {
      try {
        const dismissedAt = Number(window.localStorage.getItem(installDismissedAtKey));
        return dismissedAt > 0 && Date.now() - dismissedAt < installReminderDelay;
      } catch {
        return false;
      }
    };
    const revealInstallCard = () => {
      if (!installWasRecentlyDismissed()) setShowInstallCard(true);
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setInstallPromptEvent(null);
      setShowInstallCard(false);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    const timer = mobile && !standalone
      ? window.setTimeout(revealInstallCard, 6000)
      : undefined;

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      if (timer) window.clearTimeout(timer);
      window.clearTimeout(iosTimer);
    };
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    if (watermarkRef.current) URL.revokeObjectURL(watermarkRef.current.url);
  }, []);

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

  const showNotice = (message: string, persistent = false) => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    if (persistent) {
      noticeTimerRef.current = null;
      return;
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice("浏览器本地处理 · 不上传服务器");
      noticeTimerRef.current = null;
    }, 3200);
  };

  const dismissInstallCard = () => {
    setShowInstallCard(false);
    setInstallHelpOpen(false);
    try {
      window.localStorage.setItem(installDismissedAtKey, String(Date.now()));
    } catch {
      // Storage can be unavailable in strict privacy modes; hiding still works for this visit.
    }
  };

  const installApp = async () => {
    if (installHelpOpen) {
      dismissInstallCard();
      return;
    }

    if (!installPromptEvent) {
      setInstallHelpOpen(true);
      return;
    }

    await installPromptEvent.prompt();
    const choice = await installPromptEvent.userChoice;
    setInstallPromptEvent(null);
    setShowInstallCard(false);
    setInstallHelpOpen(false);
    if (choice.outcome === "dismissed") dismissInstallCard();
  };

  const addFiles = async (fileList: FileList | File[]) => {
    const candidates = Array.from(fileList);
    const imageFiles = candidates.filter(
      (file) => acceptedImageTypes.has(file.type) && file.size <= maxImageFileSize,
    );
    if (!imageFiles.length) {
      const hasOversizedFile = candidates.some((file) => file.size > maxImageFileSize);
      showNotice(hasOversizedFile ? "单张图片不能超过 25 MB" : "请选择 JPG、PNG 或 WebP 图片");
      return;
    }

    const results = await Promise.allSettled(
      imageFiles.map(async (file) => {
        const loaded = await loadImageAsset(file);
        return {
          ...loaded,
          id: `${file.name}-${file.lastModified}-${Math.random()}`,
          file,
          selected: true,
          settingsCustomized: false,
          settings: getInitialSettings(
            loaded.width,
            loaded.height,
            watermark?.width,
            watermark?.height,
          ),
        };
      }),
    );
    const loaded = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );

    if (!loaded.length) {
      const hasTooLargeImage = results.some(
        (result) => result.status === "rejected" && result.reason instanceof Error && result.reason.message === "image-too-large",
      );
      showNotice(hasTooLargeImage ? "图片像素过大，请选择不超过 3200 万像素的图片" : "图片读取失败，请重试或更换图片");
      return;
    }

    setItems((current) => [...current, ...loaded]);
    setActiveId((current) => current ?? loaded[0]?.id ?? null);
    const failedCount = results.length - loaded.length;
    const skippedCount = candidates.length - imageFiles.length;
    showNotice(
      failedCount
        ? `${loaded.length} 张图片已加入，${failedCount} 张读取失败`
        : skippedCount
          ? `${loaded.length} 张图片已加入，${skippedCount} 张格式或大小不符合要求`
          : `${loaded.length} 张图片已加入编辑队列`,
    );
  };

  const applyWatermarkFile = async (file: File, message: string) => {
    const loadId = watermarkLoadIdRef.current + 1;
    watermarkLoadIdRef.current = loadId;
    try {
      const loaded = await loadImageAsset(file);
      if (loadId !== watermarkLoadIdRef.current) {
        URL.revokeObjectURL(loaded.url);
        return;
      }
      setWatermark((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return { ...loaded, file };
      });
      setItems((current) =>
        current.map((item) =>
          !item.settingsCustomized
            ? {
                ...item,
                settings: getInitialSettings(item.width, item.height, loaded.width, loaded.height),
              }
            : item,
        ),
      );
      if (activeIdRef.current && window.matchMedia("(max-width: 600px)").matches) {
        setMobileControlsOpen(true);
      }
      showNotice(message);
    } catch {
      showNotice("水印图片读取失败；请确认格式正确且不超过 3200 万像素");
    }
  };

  const addWatermark = async (fileList: FileList | File[]) => {
    const candidates = Array.from(fileList);
    const file = candidates.find(
      (candidate) => acceptedImageTypes.has(candidate.type) && candidate.size <= maxImageFileSize,
    );
    if (!file) {
      const hasOversizedFile = candidates.some((candidate) => candidate.size > maxImageFileSize);
      showNotice(hasOversizedFile ? "水印图片不能超过 25 MB" : "请选择 PNG、JPG 或 WebP 水印图片");
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
    watermarkLoadIdRef.current += 1;
    setWatermark((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    setMobileControlsOpen(false);
    showNotice("水印图片已移除");
  };

  const updateSettings = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const itemId = activeIdRef.current;
    if (!itemId) return;
    const currentWatermark = watermarkRef.current;
    setItems((current) =>
      current.map((item) =>
        item.id === itemId ? {
          ...item,
          settings: currentWatermark
            ? constrainSettingsToImage(
                item.width,
                item.height,
                currentWatermark.width,
                currentWatermark.height,
                { ...item.settings, [key]: value },
              )
            : { ...item.settings, [key]: value },
          settingsCustomized: true,
        } : item,
      ),
    );
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
    const rotatedBounds = rotatedBoundingBox(width, height, settings.angle);
    const halfWidth = Math.min(50, (rotatedBounds.width / frameSize.width) * 50);
    const halfHeight = Math.min(50, (rotatedBounds.height / frameSize.height) * 50);
    const itemId = activeIdRef.current;
    if (!itemId) return;
    setItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              settings: {
                ...item.settings,
                x: clamp((x + width / 2) / frameSize.width * 100, halfWidth, 100 - halfWidth),
                y: clamp((y + height / 2) / frameSize.height * 100, halfHeight, 100 - halfHeight),
              },
              settingsCustomized: true,
            }
          : item,
      ),
    );
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
    updateWatermarkPosition(position.x, position.y, elementRef.offsetWidth, elementRef.offsetHeight);
    updateSettings("size", nextSize);
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
  };

  const updateWatermarkRotation = useCallback((event: ReactPointerEvent<HTMLButtonElement> | PointerEvent) => {
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
    updateSettings("angle", Math.round(nextRotation));
  }, []);

  const endWatermarkRotation = useCallback((event: ReactPointerEvent<HTMLButtonElement> | PointerEvent) => {
    if (rotationInteractionRef.current?.pointerId !== event.pointerId) return;
    rotationInteractionRef.current = null;
  }, []);

  useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent) => {
      updateWatermarkRotation(event);
    };

    const handleWindowPointerEnd = (event: PointerEvent) => {
      endWatermarkRotation(event);
    };

    window.addEventListener("pointermove", handleWindowPointerMove, { passive: false });
    window.addEventListener("pointerup", handleWindowPointerEnd);
    window.addEventListener("pointercancel", handleWindowPointerEnd);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerEnd);
      window.removeEventListener("pointercancel", handleWindowPointerEnd);
    };
  }, [endWatermarkRotation, updateWatermarkRotation]);

  const toggleItem = (id: string) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item)),
    );
  };

  const activateItem = (id: string) => {
    setActiveId(id);
    setItems((current) => current.map((item) =>
      item.id === id && !item.selected ? { ...item, selected: true } : item,
    ));
  };

  const toggleAllItems = () => {
    const nextSelected = !allItemsSelected;
    setItems((current) => current.map((item) => ({ ...item, selected: nextSelected })));
    showNotice(nextSelected ? "已选中全部图片" : "已取消选择全部图片");
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
    setMobileControlsOpen(false);
    showNotice("编辑队列已清空");
  };

  const applyActiveSettingsToAll = () => {
    if (!activeItem || items.length < 2) return;
    const sharedSettings = { ...activeItem.settings };
    const currentWatermark = watermarkRef.current;
    setItems((current) => current.map((item) => ({
      ...item,
      settings: currentWatermark
        ? constrainSettingsToImage(
            item.width,
            item.height,
            currentWatermark.width,
            currentWatermark.height,
            { ...sharedSettings },
          )
        : { ...sharedSettings },
      settingsCustomized: true,
    })));
    showNotice(`已将当前设置应用到 ${items.length} 张图片`);
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

    const watermarkWidth = Math.max(1, Math.round(item.width * (item.settings.size / 100)));
    const watermarkHeight = Math.max(
      1,
      Math.round(watermarkWidth * (watermark.height / watermark.width)),
    );
    context.globalAlpha = item.settings.opacity / 100;

    const x = (item.width * item.settings.x) / 100;
    const y = (item.height * item.settings.y) / 100;
    context.save();
    context.translate(x, y);
    context.rotate((item.settings.angle * Math.PI) / 180);
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
      canvas.toBlob((blob) => {
        canvas.width = 1;
        canvas.height = 1;
        if (blob) resolve(blob);
        else reject(new Error("export-failed"));
      }, mime, 1);
    });
  };

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
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
    exportCancelledRef.current = false;
    setIsDownloading(true);
    showNotice("正在按原尺寸导出，请稍候…", true);
    try {
      const exportedFiles: Array<{ name: string; blob: Blob }> = [];
      let zipOutputSize = 0;
      for (const [index, item] of selectedItems.entries()) {
        if (exportCancelledRef.current) throw new Error("export-cancelled");
        showNotice(`正在导出 ${index + 1} / ${selectedItems.length}：${item.file.name}`, true);
        const blob = await getExportBlob(item);
        if (exportCancelledRef.current) throw new Error("export-cancelled");
        const fileName = getExportFileName(item);
        if (exportAsZip && selectedItems.length > 1) {
          zipOutputSize += blob.size;
          if (zipOutputSize > maxZipOutputSize) throw new Error("zip-too-large");
          exportedFiles.push({ name: fileName, blob });
        } else {
          downloadBlob(blob, fileName);
          await new Promise((resolve) => window.setTimeout(resolve, 180));
        }
      }

      if (exportAsZip && selectedItems.length > 1) {
        showNotice("正在打包 ZIP…", true);
        const archive = await createZipBlob(exportedFiles);
        if (exportCancelledRef.current) throw new Error("export-cancelled");
        downloadBlob(archive, getZipFileName());
        showNotice(`${selectedItems.length} 张图片已打包为 ZIP`);
      } else {
        showNotice(`${selectedItems.length} 张图片已开始下载`);
      }
    } catch (error) {
      showNotice(error instanceof Error && error.message === "export-cancelled"
        ? "已停止导出"
        : error instanceof Error && error.message === "zip-too-large"
          ? "ZIP 超过 250 MB，请减少图片或关闭 ZIP 后逐张下载"
          : "导出失败，请重试或换一张图片");
    } finally {
      setIsDownloading(false);
    }
  };

  const cancelExport = () => {
    exportCancelledRef.current = true;
    showNotice("正在停止导出…", true);
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

      {showInstallCard && (
        <aside className="install-card" role="region" aria-label="安装 Picmark Studio">
          <div className="install-card-icon" aria-hidden="true">＋</div>
          <div className="install-card-copy">
            <strong>安装到桌面</strong>
            <p>
              {installHelpOpen
                ? isIos
                  ? "点击浏览器的分享按钮，再选择“添加到主屏幕”。"
                  : "打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。"
                : "下次打开更快，离线也能继续使用。"}
            </p>
          </div>
          <div className="install-card-actions">
            <button type="button" className="install-button" onClick={() => void installApp()}>
              {installHelpOpen ? "知道了" : installPromptEvent ? "立即安装" : "查看方法"}
            </button>
            <button type="button" className="install-dismiss" onClick={dismissInstallCard}>稍后</button>
          </div>
        </aside>
      )}

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

      <section className={`workspace ${items.length ? "has-items" : "is-empty"}${watermark ? " has-watermark" : ""}`}>
        <aside className="control-panel">
          <div className="panel-heading">
            <div><span className="section-kicker">A</span><h2>水印设置</h2></div>
            <span className="live-pill"><span />实时</span>
          </div>

          <label className="field-label" htmlFor="watermark-image">水印图片</label>
          <div className="watermark-upload-wrap">
            <input
              ref={watermarkInputRef}
              id="watermark-image"
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onClick={(event) => event.stopPropagation()}
              onChange={onWatermarkChange}
            />
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
              {watermark ? (
                <>
                  <img className="watermark-thumb" src={watermark.url} alt="" />
                  <div className="watermark-file-info">
                    <strong>{watermark.file.name}</strong>
                    <span>{watermark.width} × {watermark.height} · {formatBytes(watermark.file.size)}</span>
                  </div>
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
            {watermark && <button type="button" className="watermark-remove" onClick={clearWatermark}>移除</button>}
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
            <small>{watermark ? "点击素材会替换当前水印" : "选择后会直接显示在图片上"}</small>
          </div>

          {showWatermarkPresets && (
            <div className="watermark-presets" aria-label="本地水印素材">
              {watermarkPresets.map((preset) => (
                <button
                  key={preset.src}
                  type="button"
                  className={`watermark-preset-card${watermark?.file.name === preset.fileName ? " is-selected" : ""}`}
                  aria-pressed={watermark?.file.name === preset.fileName}
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
            <input id="size" className="range-input" type="range" min="8" max="90" value={settings.size} style={rangeStyle(settings.size, 8, 90)} disabled={!activeItem || !watermark} onChange={(event) => updateSettings("size", Number(event.target.value))} />
            <div className="range-hints"><span>小</span><span>大</span></div>
          </div>

          <div className="control-block">
            <div className="control-row"><label htmlFor="opacity">透明度</label><output>{settings.opacity}%</output></div>
            <input id="opacity" className="range-input" type="range" min="10" max="100" value={settings.opacity} style={rangeStyle(settings.opacity, 10, 100)} disabled={!activeItem || !watermark} onChange={(event) => updateSettings("opacity", Number(event.target.value))} />
            <div className="range-hints"><span>透明</span><span>实色</span></div>
          </div>

          <div className="control-block">
            <div className="control-row"><label htmlFor="angle">旋转</label><output>{formatAngle(settings.angle)}</output></div>
            <input id="angle" className="range-input" type="range" min="-180" max="180" value={settings.angle} style={rangeStyle(settings.angle, -180, 180)} disabled={!activeItem || !watermark} onChange={(event) => updateSettings("angle", Number(event.target.value))} />
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
            {items.length > 0 && <div className="toolbar-actions"><button type="button" className="select-all-button" onClick={toggleAllItems}>{allItemsSelected ? "取消全选" : "全选"}</button><button type="button" className="clear-button" onClick={clearAll}>清空全部 <span>×</span></button></div>}
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
                  key={watermark.url}
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
                  style={{ opacity: settings.opacity / 100, touchAction: "none" }}
                  onDragStop={handleWatermarkDrag}
                  onResizeStop={handleWatermarkResize}
                >
                  <div
                    className="preview-watermark-content"
                    style={{ transform: `rotate(${settings.angle}deg)`, transformOrigin: "center" }}
                  >
                    <img className="preview-watermark" src={watermark.url} alt="当前水印" draggable={false} />
                  </div>
                  <button type="button" className="watermark-rotate-handle" aria-label="拖动旋转水印" onPointerDown={beginWatermarkRotation} onPointerMove={updateWatermarkRotation} onPointerUp={endWatermarkRotation} onPointerCancel={endWatermarkRotation}>↻</button>
                </Rnd>}<div className="frame-badge">预览</div></div>}
                <div className="stage-footer"><span>{activeItem?.file.name}</span><span>{activeItem ? `${activeItem.width} × ${activeItem.height} · ${formatBytes(activeItem.file.size)}` : ""}</span></div>
              </div>
              <div className="thumb-strip">
                {items.map((item, index) => <div key={item.id} className={item.id === activeItem?.id ? "thumb-card is-active" : "thumb-card"}>
                  <button type="button" className="thumb-select" onClick={() => toggleItem(item.id)} aria-label={`${item.selected ? "取消选择" : "选择"} ${item.file.name}`} aria-pressed={item.selected}>{item.selected ? "✓" : ""}</button>
                  <button type="button" className="thumb-image-button" aria-pressed={item.id === activeItem?.id} onClick={() => activateItem(item.id)}><img src={item.url} alt={`第 ${index + 1} 张：${item.file.name}`} /></button>
                  <div className="thumb-meta"><span>{String(index + 1).padStart(2, "0")}</span><button type="button" onClick={() => removeItem(item.id)} aria-label={`移除 ${item.file.name}`}>×</button></div>
                </div>)}
                <button type="button" className="add-more-card" onClick={() => fileInputRef.current?.click()}><span>＋</span><small>继续添加 · 可多选</small></button>
                <input ref={fileInputRef} name="images" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="继续添加需要加水印的图片，可多选" onChange={onFileChange} />
              </div>
            </div>
          )}

          <div className="editor-footer">
            {items.length > 0 && watermark && <div className={`mobile-adjust-panel${mobileControlsOpen ? " is-open" : ""}`}>
              <button type="button" className="mobile-adjust-toggle" aria-expanded={mobileControlsOpen} aria-controls="mobile-watermark-controls" onClick={() => setMobileControlsOpen((current) => !current)}>
                <span>调整水印</span><output>{Math.round(settings.size)}% · {settings.opacity}% · {formatAngle(settings.angle)}</output><b aria-hidden="true">⌃</b>
              </button>
              <div id="mobile-watermark-controls" className="mobile-adjust-controls" hidden={!mobileControlsOpen}>
                <label htmlFor="mobile-size"><span>大小</span><output>{Math.round(settings.size)}%</output></label>
                <input id="mobile-size" className="range-input" type="range" min="8" max="90" value={settings.size} style={rangeStyle(settings.size, 8, 90)} onChange={(event) => updateSettings("size", Number(event.target.value))} />
                <label htmlFor="mobile-opacity"><span>透明度</span><output>{settings.opacity}%</output></label>
                <input id="mobile-opacity" className="range-input" type="range" min="10" max="100" value={settings.opacity} style={rangeStyle(settings.opacity, 10, 100)} onChange={(event) => updateSettings("opacity", Number(event.target.value))} />
                <label htmlFor="mobile-angle"><span>旋转</span><output>{formatAngle(settings.angle)}</output></label>
                <input id="mobile-angle" className="range-input" type="range" min="-180" max="180" value={settings.angle} style={rangeStyle(settings.angle, -180, 180)} onChange={(event) => updateSettings("angle", Number(event.target.value))} />
              </div>
            </div>}
            <div className="footer-status" role="status" aria-live="polite" aria-atomic="true"><span className="status-icon">↗</span><div><strong>{notice}</strong><small>{items.length ? watermark ? "每张图片可独立调整；也可将当前设置应用到全部图片" : "请先上传或选择水印图片" : "支持批量上传 · 处理过程无需联网"}</small></div></div>
            <div className="footer-export">
              <label className="zip-option"><input id="export-as-zip" type="checkbox" aria-label="批量导出为 ZIP" checked={exportAsZip} disabled={isDownloading} onChange={(event) => setExportAsZip(event.target.checked)} /><span><strong>批量导出为 ZIP</strong><small>{exportAsZip ? "多张图片合并下载，移动端更稳定" : "关闭后将逐张下载"}</small></span></label>
              <div className="footer-actions"><button type="button" className="secondary-button" onClick={applyActiveSettingsToAll} disabled={isDownloading || !activeItem || items.length < 2}>应用到全部</button><button type="button" className={`download-button${isDownloading ? " is-cancel" : ""}`} onClick={isDownloading ? cancelExport : () => void downloadSelected()} disabled={!isDownloading && (!selectedItems.length || !watermark)}><span>{isDownloading ? "停止导出" : exportAsZip && selectedItems.length > 1 ? `下载 ZIP (${selectedItems.length})` : `下载已选${selectedItems.length ? ` (${selectedItems.length})` : ""}`}</span><b>{isDownloading ? "×" : "↓"}</b></button></div>
            </div>
          </div>
        </div>
      </section>

      <footer className="page-footer"><span>© 2025 Picmark Studio</span><span>原图尺寸导出 · 无质量压缩</span><span>Made for your workflow <b>↗</b></span></footer>
    </main>
  );
}
