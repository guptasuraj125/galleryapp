"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Download, Expand, Heart, MapPin, Minus, Plus, RotateCcw, RotateCw, Search, Share2, Trash2, X } from "lucide-react";
import { readJson } from "@/src/lib/api-response";
import { ThemeToggle } from "@/src/components/theme-toggle";
import { ProfileBannerVideo } from "@/src/components/profile-banner-video";

type Mode = "gallery" | "videos" | "timeline" | "places" | "favorites" | "on-this-day" | "search";
type DeleteConfirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
};
type GalleryFilter = "all" | "photos" | "videos";
type GallerySort = "newest" | "oldest" | "name-asc" | "name-desc";

interface MemoryMedia {
  id: string;
  provider: "imagekit" | "backblaze" | "cloudinary";
  resourceType: "image" | "video";
  format: string;
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
  originalFilename: string;
  folderPath: string;
  url: string;
  thumbnailUrl?: string;
  posterUrl?: string;
  createdAt?: string;
}

interface ProfileBanner {
  id: string;
  url: string;
  originalFilename: string;
}

interface MemoryItem {
  id: string;
  title: string;
  caption: string;
  note: string;
  occurredAt: string;
  isFavorite: boolean;
  location: { name: string; latitude?: number; longitude?: number } | null;
  tags: { name: string }[];
  media: MemoryMedia[];
}

interface MemoryResponse {
  items: MemoryItem[];
  profileBanner?: ProfileBanner | null;
  page: number;
  limit: number;
  total: number;
  totalPages?: number;
  hasMore: boolean;
}

const PAGE_SIZE = 36;

const titles: Record<Mode, string> = {
  gallery: "Our little archive",
  videos: "Moving memories",
  timeline: "A life, in little days",
  places: "Places we keep",
  favorites: "Liked photos & videos",
  "on-this-day": "On this day",
  search: "Find a little something",
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(date));
}

function formatUploadDate(date?: string) {
  if (!date) return "Upload time unavailable";
  const value = new Date(date);
  if (!Number.isFinite(value.getTime())) return "Upload time unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function getModeQuery(mode: Mode, query: string) {
  const params = new URLSearchParams({ limit: "36" });
  if (mode === "gallery") params.set("gallery", "true");
  if (mode === "videos") params.set("type", "video");
  if (mode === "favorites") params.set("favorite", "true");
  if (mode === "on-this-day") params.set("monthDay", "true");
  if (mode === "search" && query.trim()) params.set("q", query.trim());
  return params;
}

function MediaImage(props: { src: string; alt: string; className: string; width?: number; height?: number }) {
  return <MediaImageContent key={props.src} {...props} />;
}

function MediaImageContent({ src, alt, className, width = 1200, height = 900 }: { src: string; alt: string; className: string; width?: number; height?: number }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number>();

  return (
    <span className={`media-image-frame${loaded ? " is-loaded" : ""}`} style={{ aspectRatio: aspectRatio ?? `${width} / ${height}` }}>
      {!loaded && !failed && <span aria-hidden="true" className="media-image-skeleton" />}
      {failed
        ? <span aria-label={`${alt} preview unavailable`} className="media-load-error" role="img">Preview unavailable</span>
        : <Image
          alt={alt}
          className={className}
          height={height}
          loading="lazy"
          onError={() => setFailed(true)}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth && image.naturalHeight) {
              setAspectRatio(image.naturalWidth / image.naturalHeight);
            }
            setLoaded(true);
          }}
          src={src}
          style={aspectRatio ? { aspectRatio } : undefined}
          unoptimized
          width={width}
        />}
    </span>
  );
}

function VideoThumbnail({ src, alt, width, height }: { src: string; alt: string; width?: number; height?: number }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [nearViewport, setNearViewport] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: "240px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="video-thumbnail" ref={container} style={width && height ? { aspectRatio: `${width} / ${height}` } : undefined}>
      {!ready && <span aria-hidden="true" className="memory-video-placeholder">{failed ? "Video preview unavailable" : "Loading preview…"}</span>}
      {nearViewport && <video
        aria-label={`Video thumbnail for ${alt}`}
        className={ready ? "video-thumbnail-frame is-ready" : "video-thumbnail-frame"}
        muted
        onError={() => setFailed(true)}
        onLoadedData={() => setReady(true)}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (video.videoWidth && video.videoHeight) {
            if (video.parentElement) video.parentElement.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
          }
          if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(0.12, video.duration / 2);
        }}
        onSeeked={() => setReady(true)}
        playsInline
        preload="metadata"
        src={src}
      />}
    </div>
  );
}

export function MemoryBrowser({ mode, initialQuery = "", displayName = "Our memories", mediaCreatedAt = {} }: { mode: Mode; initialQuery?: string; displayName?: string; mediaCreatedAt?: Record<string, string> }) {
  const reducedMotion = useReducedMotion();
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [profileBanner, setProfileBanner] = useState<ProfileBanner | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<{ memory: MemoryItem; media?: MemoryMedia } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingMedia, setDeletingMedia] = useState(false);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [galleryFilter, setGalleryFilter] = useState<GalleryFilter>("all");
  const [gallerySort, setGallerySort] = useState<GallerySort>("newest");
  const [allMediaSelected, setAllMediaSelected] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [notice, setNotice] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null);
  const deleteCancelButton = useRef<HTMLButtonElement>(null);
  const deleteReturnFocus = useRef<HTMLElement | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imagePan, setImagePan] = useState({ x: 0, y: 0 });
  const [imageRotation, setImageRotation] = useState(0);
  const [videoRotation, setVideoRotation] = useState(0);
  const [viewerSize, setViewerSize] = useState({ width: 0, height: 0 });
  const [videoRatio, setVideoRatio] = useState(16 / 9);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);
  const viewerTouchStart = useRef<{ x: number; y: number } | null>(null);
  const lightboxMediaRef = useRef<HTMLDivElement>(null);
  const galleryTopRef = useRef<HTMLDivElement>(null);
  const scrollToPageAfterLoad = useRef(false);
  const sharedMediaOpened = useRef(false);

  function openDeleteConfirmation(confirmation: DeleteConfirmation) {
    deleteReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDeleteConfirmation(confirmation);
  }

  useEffect(() => {
    if (!deleteConfirmation) {
      deleteReturnFocus.current?.focus();
      deleteReturnFocus.current = null;
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    deleteCancelButton.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setDeleteConfirmation(null);
    }
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [deleteConfirmation]);

  const load = useCallback(async (nextPage = 0, replace = true, search = "") => {
    if (replace) setLoading(true);
    setError("");
    try {
      const params = getModeQuery(mode, search);
      if (mode === "gallery" && galleryFilter !== "all") {
        params.set("type", galleryFilter === "photos" ? "image" : "video");
      }
      params.set("page", String(nextPage));
      const result = await readJson<MemoryResponse>(await fetch(`/api/memories?${params}`, {
        cache: "no-store",
      }));
      setItems((current) => replace ? result.items : [...current, ...result.items]);
      setPage(nextPage);
      setHasMore(result.hasMore);
      setTotal(result.total);
      setTotalPages(result.totalPages ?? Math.ceil(result.total / PAGE_SIZE));
      if (replace && mode === "gallery") setProfileBanner(result.profileBanner ?? null);
      return result;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Your memories could not be loaded.");
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [mode, galleryFilter]);

  useEffect(() => {
    void Promise.resolve().then(() => load(0, true, initialQuery));
  }, [load, initialQuery]);

  const visibleItems = useMemo(
    () => mode === "videos"
      ? items.filter((memory) => memory.media.some((media) => media.resourceType === "video"))
      : items,
    [items, mode],
  );
  const galleryMedia = useMemo(() => visibleItems.flatMap((memory) => memory.media.map((media) => ({ memory, media }))), [visibleItems]);
  const filteredItems = useMemo(() => {
    if (mode !== "gallery") return visibleItems;
    const needle = query.trim().toLocaleLowerCase();
    const results: MemoryItem[] = [];
    for (const memory of visibleItems) {
      const sharedText = [memory.title, memory.caption, memory.note, memory.location?.name, ...memory.tags.map((tag) => tag.name), formatDate(memory.occurredAt)].filter(Boolean).join(" ").toLocaleLowerCase();
      const sharedMatch = !needle || sharedText.includes(needle);
      if (!memory.media.length) {
        if (galleryFilter === "all" && sharedMatch) results.push(memory);
        continue;
      }
      const media = memory.media.filter((asset) => {
        const filterMatch = galleryFilter === "all" || asset.resourceType === (galleryFilter === "photos" ? "image" : "video");
        const uploadedAt = mediaCreatedAt[asset.id] ?? asset.createdAt;
        const dateText = uploadedAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(uploadedAt)) : "";
        const assetText = [asset.originalFilename, asset.folderPath, asset.format, dateText].filter(Boolean).join(" ").toLocaleLowerCase();
        return filterMatch && (!needle || sharedMatch || assetText.includes(needle));
      });
      for (const asset of media) results.push({ ...memory, media: [asset] });
    }
    const sortName = (memory: MemoryItem) => memory.media[0]?.originalFilename ?? memory.title;
    const sortTime = (memory: MemoryItem) => {
      const asset = memory.media[0];
      return Date.parse((asset && (mediaCreatedAt[asset.id] ?? asset.createdAt)) || memory.occurredAt);
    };
    results.sort((a, b) => {
      if (gallerySort === "name-asc") return sortName(a).localeCompare(sortName(b), undefined, { sensitivity: "base" });
      if (gallerySort === "name-desc") return sortName(b).localeCompare(sortName(a), undefined, { sensitivity: "base" });
      const difference = sortTime(b) - sortTime(a);
      return gallerySort === "oldest" ? -difference : difference;
    });
    return results;
  }, [visibleItems, galleryFilter, gallerySort, query, mediaCreatedAt, mode]);
  const viewerItems = useMemo(() => mode === "gallery" ? filteredItems.flatMap((memory) => memory.media.map((media) => ({ memory, media }))) : galleryMedia, [filteredItems, galleryMedia, mode]);
  const viewerIndex = selected?.media ? viewerItems.findIndex(({ media }) => media.id === selected.media?.id) : -1;
  const visibleMediaIds = useMemo(
    () => mode === "gallery" ? filteredItems.flatMap((memory) => memory.media.map((media) => media.id)) : visibleItems.flatMap((memory) => memory.media.map((media) => media.id)),
    [filteredItems, visibleItems, mode],
  );
  const allVisibleSelected = visibleMediaIds.length > 0 && visibleMediaIds.every((id) => selectedMediaIds.includes(id));
  const profileImage = galleryMedia.find(({ media }) => media.resourceType === "image")?.media;
  const profileImageUrl = profileImage?.url;

  useEffect(() => {
    if (!scrollToPageAfterLoad.current || loading) return;
    scrollToPageAfterLoad.current = false;
    requestAnimationFrame(() => galleryTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [page, loading]);

  useEffect(() => {
    if (!selected?.media) return;
    const element = lightboxMediaRef.current;
    if (!element) return;
    const updateSize = () => setViewerSize({ width: element.clientWidth, height: element.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [selected]);

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedMediaIds([]);
    setAllMediaSelected(false);
  }

  const openMedia = useCallback((memory: MemoryItem, media: MemoryMedia) => {
    setImageZoom(1);
    setImagePan({ x: 0, y: 0 });
    setImageRotation(0);
    setVideoRotation(0);
    setVideoRatio(16 / 9);
    setSelected({ memory, media });
  }, []);
  const closeViewer = useCallback(() => {
    setSelected(null);
    setEditing(false);
  }, []);

  useEffect(() => {
    if (mode !== "gallery" || loading || sharedMediaOpened.current) return;
    const mediaId = new URLSearchParams(window.location.search).get("media");
    if (!mediaId) return;
    const match = visibleItems.flatMap((memory) => memory.media.map((media) => ({ memory, media }))).find(({ media }) => media.id === mediaId);
    if (match) {
      sharedMediaOpened.current = true;
      const frame = window.requestAnimationFrame(() => openMedia(match.memory, match.media));
      return () => window.cancelAnimationFrame(frame);
    }
  }, [mode, loading, visibleItems, openMedia]);

  const navigateViewer = useCallback((direction: -1 | 1) => {
    if (viewerIndex < 0) return;
    const atEdge = direction === 1 ? viewerIndex === viewerItems.length - 1 : viewerIndex === 0;
    const canLoadPage = direction === 1 ? hasMore : page > 0;
    if (atEdge && canLoadPage) {
      void load(page + direction, true, query).then((result) => {
        if (!result) return;
        const nextItems = result.items.flatMap((memory) => memory.media.map((media) => ({
          memory: { ...memory, media: [media] },
          media,
        })));
        if (mode === "gallery") {
          const sortName = ({ media, memory }: typeof nextItems[number]) => media.originalFilename || memory.title;
          const sortTime = ({ media, memory }: typeof nextItems[number]) =>
            Date.parse(mediaCreatedAt[media.id] ?? media.createdAt ?? memory.occurredAt);
          nextItems.sort((a, b) => {
            if (gallerySort === "name-asc") return sortName(a).localeCompare(sortName(b), undefined, { sensitivity: "base" });
            if (gallerySort === "name-desc") return sortName(b).localeCompare(sortName(a), undefined, { sensitivity: "base" });
            const difference = sortTime(b) - sortTime(a);
            return gallerySort === "oldest" ? -difference : difference;
          });
        }
        const target = direction === 1 ? nextItems[0] : nextItems[nextItems.length - 1];
        if (target) openMedia(target.memory, target.media);
      });
      return;
    }
    const nextIndex = viewerIndex + direction;
    const next = viewerItems[nextIndex];
    if (!next) return;
    openMedia(next.memory, next.media);
  }, [gallerySort, hasMore, load, mediaCreatedAt, mode, openMedia, page, query, viewerItems, viewerIndex]);

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [selected]);

  function zoomImage(amount: number) {
    setImageZoom((current) => {
      const next = Math.min(4, Math.max(1, Number((current + amount).toFixed(2))));
      if (next === 1) setImagePan({ x: 0, y: 0 });
      return next;
    });
  }

  function onImagePointerDown(event: React.PointerEvent<HTMLImageElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    lastPointer.current = { x: event.clientX, y: event.clientY };
    if (pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()];
      pinchStart.current = { distance: Math.hypot(first.x - second.x, first.y - second.y), zoom: imageZoom };
    }
  }

  function onImagePointerMove(event: React.PointerEvent<HTMLImageElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2 && pinchStart.current) {
      const [first, second] = [...pointers.current.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      setImageZoom(Math.min(4, Math.max(1, pinchStart.current.zoom * distance / Math.max(1, pinchStart.current.distance))));
      return;
    }
    if (imageZoom > 1 && lastPointer.current) {
      const deltaX = event.clientX - lastPointer.current.x;
      const deltaY = event.clientY - lastPointer.current.y;
      const maxX = viewerSize.width * Math.max(0, imageZoom - 1) / 2;
      const maxY = viewerSize.height * Math.max(0, imageZoom - 1) / 2;
      setImagePan((current) => ({
        x: Math.max(-maxX, Math.min(maxX, current.x + deltaX)),
        y: Math.max(-maxY, Math.min(maxY, current.y + deltaY)),
      }));
    }
    lastPointer.current = { x: event.clientX, y: event.clientY };
  }

  function onImagePointerUp(event: React.PointerEvent<HTMLImageElement>) {
    pointers.current.delete(event.pointerId);
    pinchStart.current = null;
    lastPointer.current = null;
  }

  function rotateImage() {
    setImageRotation((rotation) => (rotation + 90) % 360);
    setImagePan({ x: 0, y: 0 });
  }

  async function downloadMedia(media: MemoryMedia) {
    try {
      const response = await fetch(media.url);
      if (!response.ok) throw new Error("Download request failed.");
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = media.originalFilename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      window.open(media.url, "_blank", "noopener,noreferrer");
      setNotice("Your browser opened the media file directly. Use its download option to save it.");
    }
  }

  async function shareMedia(memory: MemoryItem, media: MemoryMedia) {
    const url = new URL("/gallery", window.location.origin);
    url.searchParams.set("media", media.id);
    const shareData = { title: memory.title, text: media.originalFilename, url: url.toString() };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(shareData.url);
      else {
        const input = document.createElement("textarea");
        input.value = shareData.url;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.append(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setNotice("Link copied");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice("This link could not be copied.");
    }
  }

  function deleteSelectedMedia() {
    const ids = selectedMediaIds;
    if (!allMediaSelected && !ids.length) return;
    const message = allMediaSelected
      ? "Delete every image and video you are allowed to manage in this space? This removes them from the archive and Cloudinary."
      : `Delete ${ids.length} selected ${ids.length === 1 ? "file" : "files"}? This removes them from the archive and Cloudinary.`;
    openDeleteConfirmation({
      title: allMediaSelected ? "Delete all images and videos?" : "Delete selected files?",
      description: message,
      confirmLabel: allMediaSelected ? "Delete all media" : `Delete ${ids.length} ${ids.length === 1 ? "file" : "files"}`,
      onConfirm: () => {
        setDeleteConfirmation(null);
        void deleteSelectedMediaConfirmed();
      },
    });
  }

  async function deleteSelectedMediaConfirmed() {
    const ids = selectedMediaIds;
    if (!allMediaSelected && !ids.length) return;
    setBulkDeleting(true);
    setNotice("");
    try {
      const deletedIds: string[] = [];
      const failureMessages: string[] = [];
      let failedCount = 0;
      let deletedCount = 0;
      const batches = allMediaSelected ? [null] : Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) => ids.slice(index * 100, index * 100 + 100));
      for (const batch of batches) {
        const result = await readJson<{ deletedIds: string[]; failedIds: string[]; failureMessages?: string[]; deletedCount?: number; failedCount?: number }>(await fetch("/api/media/bulk", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(batch ? { ids: batch } : { allMedia: true }),
        }));
        deletedIds.push(...result.deletedIds);
        deletedCount += result.deletedCount ?? result.deletedIds.length;
        failedCount += result.failedCount ?? result.failedIds.length;
        failureMessages.push(...(result.failureMessages ?? []));
      }
      setSelectedMediaIds((current) => current.filter((id) => !deletedIds.includes(id)));
      if (allMediaSelected) {
        setAllMediaSelected(false);
        await load(0, true, query);
      } else {
        await load(page, true, query);
      }
      setNotice(failedCount
        ? `${deletedCount} deleted; ${failedCount} could not be deleted.${failureMessages[0] ? ` ${failureMessages[0]}` : ""}`
        : `${deletedCount} ${deletedCount === 1 ? "file" : "files"} deleted.`);
    } catch (deleteError) {
      setNotice(deleteError instanceof Error ? deleteError.message : "The selected files could not be deleted.");
    } finally {
      setBulkDeleting(false);
    }
  }

  const byTimeline = useMemo(() => {
    const years = new Map<string, Map<string, MemoryItem[]>>();
    for (const memory of visibleItems) {
      const date = new Date(memory.occurredAt);
      const year = String(date.getFullYear());
      const month = new Intl.DateTimeFormat(undefined, { month: "long" }).format(date);
      const months = years.get(year) ?? new Map<string, MemoryItem[]>();
      months.set(month, [...(months.get(month) ?? []), memory]);
      years.set(year, months);
    }
    return years;
  }, [visibleItems]);

  const places = useMemo(() => {
    const groups = new Map<string, MemoryItem[]>();
    for (const memory of visibleItems) {
      const name = memory.location?.name ?? "Somewhere, together";
      groups.set(name, [...(groups.get(name) ?? []), memory]);
    }
    return groups;
  }, [visibleItems]);

  async function toggleFavorite(memory: MemoryItem) {
    try {
      await readJson(await fetch(`/api/memories/${memory.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFavorite: !memory.isFavorite }),
      }));
      await load(page, true, query);
      setSelected((current) => current?.memory.id === memory.id
        ? { ...current, memory: { ...current.memory, isFavorite: !memory.isFavorite } }
        : current);
    } catch (favoriteError) {
      setNotice(favoriteError instanceof Error ? favoriteError.message : "Favorite could not be updated.");
    }
  }

  async function saveMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      await readJson(await fetch(`/api/memories/${selected.memory.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(form.get("title") ?? ""),
          caption: String(form.get("caption") ?? ""),
          note: String(form.get("note") ?? ""),
          occurredAt: String(form.get("occurredAt") ?? ""),
          locationName: String(form.get("locationName") ?? "").trim() || null,
          tags: String(form.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
        }),
      }));
      setEditing(false);
      setNotice("A little update saved.");
      await load(page, true, query);
    } catch (saveError) {
      setNotice(saveError instanceof Error ? saveError.message : "Your changes could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function deleteMemory(memory: MemoryItem) {
    openDeleteConfirmation({
      title: "Remove this memory?",
      description: `“${memory.title}” will be removed from this space.`,
      confirmLabel: "Remove memory",
      onConfirm: () => {
        setDeleteConfirmation(null);
        void deleteMemoryConfirmed(memory);
      },
    });
  }

  async function deleteMemoryConfirmed(memory: MemoryItem) {
    try {
      await readJson(await fetch(`/api/memories/${memory.id}`, { method: "DELETE" }));
      closeViewer();
      await load(page, true, query);
    } catch (deleteError) {
      setNotice(deleteError instanceof Error ? deleteError.message : "This memory could not be deleted.");
    }
  }

  function deleteMedia() {
    if (!selected?.media) return;
    const { memory, media } = selected;
    openDeleteConfirmation({
      title: "Remove this file?",
      description: `${media.originalFilename} will be removed from this space and Cloudinary.`,
      confirmLabel: "Remove file",
      onConfirm: () => {
        setDeleteConfirmation(null);
        void deleteMediaConfirmed(memory, media);
      },
    });
  }

  async function deleteMediaConfirmed(memory: MemoryItem, media: MemoryMedia) {
    setDeletingMedia(true);
    setNotice("");
    try {
      await readJson(await fetch(`/api/media/${media.id}`, { method: "DELETE" }));
      const remainingMedia = memory.media.filter((item) => item.id !== media.id);
      setItems((current) => current.map((item) =>
        item.id === memory.id ? { ...item, media: remainingMedia } : item,
      ));
      if (remainingMedia.length > 0) {
        openMedia({ ...memory, media: remainingMedia }, remainingMedia[0]);
      } else {
        closeViewer();
      }
      await load(page, true, query);
      setNotice("The file was removed from this space.");
    } catch (deleteError) {
      setNotice(deleteError instanceof Error ? deleteError.message : "This file could not be removed.");
    } finally {
      setDeletingMedia(false);
    }
  }

  async function showSurprise() {
    setLoading(true);
    try {
      const params = getModeQuery("gallery", "");
      params.set("surprise", "true");
      const result = await readJson<MemoryResponse>(await fetch(`/api/memories?${params}`, { cache: "no-store" }));
      const memory = result.items.find((item) => item.media.length > 0);
      const media = memory?.media.find((entry) => entry.resourceType === "image") ?? memory?.media[0];
      if (memory && media) openMedia(memory, media);
      else setNotice("No memories to surprise you with just yet.");
    } catch (surpriseError) {
      setNotice(surpriseError instanceof Error ? surpriseError.message : "We couldn't find a memory right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!selected) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeViewer();
      } else if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']")) {
        return;
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigateViewer(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        navigateViewer(1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, navigateViewer, closeViewer]);

  function renderMemory(memory: MemoryItem) {
    const media = mode === "videos" ? memory.media.filter((item) => item.resourceType === "video") : memory.media;
    if (media.length === 0) {
      if (mode === "videos") return null;
      return (
        <article
        className={`memory-card memory-text-card${selectionMode ? " is-selecting" : ""}`}
          key={memory.id}
        >
          <button className="memory-text-preview" onClick={() => setSelected({ memory })} type="button">
            <span aria-hidden="true">♡</span>
            <p>{memory.caption || memory.note || "A little moment, kept in words."}</p>
          </button>
          <div className="memory-card-meta">
            <div><h2>{memory.title}</h2><p>{formatDate(memory.occurredAt)}</p></div>
            <button
              aria-label={memory.isFavorite ? "Remove favorite" : "Add favorite"}
              aria-pressed={memory.isFavorite}
              className={`favorite-button${memory.isFavorite ? " is-favorite" : ""}`}
              onClick={() => void toggleFavorite(memory)}
              type="button"
            ><Heart fill={memory.isFavorite ? "currentColor" : "none"} size={17} /></button>
          </div>
        </article>
      );
    }
    return media.map((asset) => (
      <article
          className={`memory-card${asset.resourceType === "video" ? " memory-video-card" : ""}${selectedMediaIds.includes(asset.id) ? " is-selected" : ""}`}
        key={asset.id}
      >
        {selectionMode && <label className="memory-select-control" onClick={(event) => event.stopPropagation()}>
          <input
            aria-label={`Select ${asset.originalFilename}`}
            checked={selectedMediaIds.includes(asset.id)}
            onChange={(event) => setSelectedMediaIds((current) => event.target.checked
              ? [...current, asset.id]
              : current.filter((id) => id !== asset.id))}
            type="checkbox"
          />
          <span>Select</span>
        </label>}
        <button
          aria-label={`Open ${memory.title}, ${asset.resourceType}`}
          className="memory-media-button"
          onClick={() => openMedia(memory, asset)}
          type="button"
        >
          {asset.resourceType === "video"
              ? asset.provider === "cloudinary" && asset.posterUrl
              ? <MediaImage alt="" className="memory-cover" height={asset.height} src={asset.posterUrl} width={asset.width} />
              : <VideoThumbnail alt={asset.originalFilename} height={asset.height} src={asset.url} width={asset.width} />
            : <MediaImage alt={asset.originalFilename} className="memory-cover" height={asset.height} src={asset.thumbnailUrl ?? asset.url} width={asset.width} />}
          {asset.resourceType === "video" && <span className="media-type-badge">VIDEO{asset.duration ? ` · ${Math.floor(asset.duration / 60)}:${String(Math.floor(asset.duration % 60)).padStart(2, "0")}` : ""}</span>}
          {asset.resourceType === "video" && <span className="video-play-mark" aria-hidden="true">▶</span>}
        </button>
        <div className="memory-card-meta">
          <div>
            <h2>{memory.title}</h2>
            <p className="memory-upload-date">
              {mediaCreatedAt[asset.id] || asset.createdAt
                ? <time dateTime={mediaCreatedAt[asset.id] ?? asset.createdAt}>{formatUploadDate(mediaCreatedAt[asset.id] ?? asset.createdAt)}</time>
                : formatDate(memory.occurredAt)}
              {memory.location ? ` · ${memory.location.name}` : ""}
              {asset.originalFilename !== memory.title && <span className="memory-filename">{asset.originalFilename}</span>}
            </p>
          </div>
          <button
            aria-label={memory.isFavorite ? "Remove favorite" : "Add favorite"}
            aria-pressed={memory.isFavorite}
            className={`favorite-button${memory.isFavorite ? " is-favorite" : ""}`}
            onClick={() => void toggleFavorite(memory)}
            type="button"
          >
            <Heart fill={memory.isFavorite ? "currentColor" : "none"} size={17} />
          </button>
        </div>
        <details className="media-card-menu">
          <summary aria-label={`More actions for ${asset.originalFilename}`} title="More actions">⋮</summary>
          <div className="media-card-menu-panel" role="menu">
            <button onClick={() => openMedia(memory, asset)} role="menuitem" type="button">Open</button>
            {asset.resourceType === "image"
              ? <>
                <button onClick={() => { openMedia(memory, asset); setImageZoom(1.5); }} role="menuitem" type="button">Zoom</button>
                <button onClick={() => { openMedia(memory, asset); setImageRotation(90); }} role="menuitem" type="button">Rotate</button>
              </>
              : <button onClick={() => { openMedia(memory, asset); setVideoRotation(90); }} role="menuitem" type="button">Rotate</button>}
            <button onClick={() => void downloadMedia(asset)} role="menuitem" type="button">Download</button>
            <button onClick={() => void shareMedia(memory, asset)} role="menuitem" type="button">Share</button>
          </div>
        </details>
      </article>
    ));
  }

  return (
    <main className={`library-page${selectionMode ? " is-selecting" : ""}`}>
      <header className="library-header">
        <Link className="library-back" href="/home"><ArrowLeft size={16} /> Our space</Link>
        <div className="library-header-actions">
          <nav aria-label="Memory sections" className="library-nav">
            <Link href="/gallery">Gallery</Link>
            <Link href="/videos">Videos</Link>
            <Link href="/timeline">Timeline</Link>
            <Link href="/places">Places</Link>
            <Link href="/favorites">Favorites</Link>
          </nav>
          <ThemeToggle />
        </div>
      </header>
      <section className="library-main">
        {mode === "gallery" && <section aria-label="Archive profile" className="archive-profile">
          <ProfileBannerVideo
            banner={profileBanner}
            displayName={displayName}
          />
          <div className="archive-profile-identity">
            {profileImageUrl
              ? <Image alt={`${displayName} profile`} className="profile-avatar" height={88} src={profileImageUrl} unoptimized width={88} />
              : <span aria-hidden="true" className="profile-avatar profile-avatar-fallback">{displayName.trim().charAt(0).toLocaleUpperCase() || "G"}</span>}
            <div className="profile-summary"><p className="eyebrow">Private personal archive</p><h2>{displayName}</h2><span>{total} {total === 1 ? "memory" : "memories"} kept close</span></div>
          </div>
        </section>}
        <div className="library-title-row">
          <div>
            <p className="eyebrow">Private · personal · just us</p>
            <h1>{titles[mode]}</h1>
          </div>
          <button className="outline-button surprise-button" onClick={() => void showSurprise()} type="button">
            Surprise me <ArrowRight size={14} />
          </button>
        </div>

        {mode === "gallery" && <>
        <form className="gallery-search" onSubmit={(event) => event.preventDefault()}>
          <Search aria-hidden="true" size={17} />
          <input aria-label="Search photos, videos, places, names" onChange={(event) => setQuery(event.target.value)} placeholder="Search photos, videos, places, names…" value={query} />
          {query && <button aria-label="Clear search" className="gallery-search-clear" onClick={() => setQuery("")} type="button"><X size={16} /></button>}
          <button className="outline-button" type="submit">Search</button>
        </form>
        <div className="gallery-toolbar" ref={galleryTopRef}>
          <div aria-label="Gallery filters" className="gallery-filter" role="group">
            {(["all", "photos", "videos"] as const).map((filter) => (
              <button aria-pressed={galleryFilter === filter} className={galleryFilter === filter ? "is-active" : ""} key={filter} onClick={() => { setGalleryFilter(filter); setSelectedMediaIds([]); setAllMediaSelected(false); }} type="button">
                {filter === "all" ? "All" : filter === "photos" ? "Photos" : "Videos"}
              </button>
            ))}
          </div>
          <label className="gallery-sort"><span>Sort</span><select aria-label="Sort media" onChange={(event) => setGallerySort(event.target.value as GallerySort)} value={gallerySort}>
            <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name-asc">Name A → Z</option><option value="name-desc">Name Z → A</option>
          </select></label>
          {!selectionMode && <button className="outline-button selection-toggle" onClick={() => setSelectionMode(true)} type="button">Select</button>}
          {selectionMode && <button className="outline-button selection-toggle" onClick={exitSelectionMode} type="button">Done</button>}
        </div>
        </>}

        {mode === "gallery" && selectionMode && (visibleMediaIds.length > 0 || total > 0) && (
          <div className="memory-bulk-actions">
            {mode === "gallery" && total > 0 && <label><input
              checked={allMediaSelected}
              onChange={(event) => {
                setAllMediaSelected(event.target.checked);
                if (event.target.checked) setSelectedMediaIds([]);
              }}
              type="checkbox"
            /> Select every image and video in this space</label>}
            <label><input
              disabled={allMediaSelected}
              checked={allVisibleSelected}
              onChange={(event) => setSelectedMediaIds((current) => event.target.checked
                ? [...new Set([...current, ...visibleMediaIds])]
                : current.filter((id) => !visibleMediaIds.includes(id)))}
              type="checkbox"
            /> Select all loaded ({visibleMediaIds.length})</label>
            <span>{allMediaSelected ? "All images and videos selected" : `${selectedMediaIds.length} selected`}</span>
            <button className="outline-button" disabled={bulkDeleting || (!allMediaSelected && selectedMediaIds.length === 0)} onClick={() => void deleteSelectedMedia()} type="button">
              <Trash2 size={14} /> {bulkDeleting ? "Deleting..." : "Delete selected"}
            </button>
            <button className="text-button selection-cancel" disabled={bulkDeleting} onClick={exitSelectionMode} type="button">Cancel</button>
          </div>
        )}

        {mode === "search" && (
          <form className="memory-search" onSubmit={(event) => {
            event.preventDefault();
            void load(0, true, query);
          }}>
            <Search aria-hidden="true" size={17} />
            <input
              aria-label="Search memories"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="A place, a date, a little detail..."
              value={query}
            />
            <button className="outline-button" type="submit">Search</button>
          </form>
        )}

        {mode === "places" && (
          <div className="places-list">
            {[...places.entries()].map(([place, memories]) => (
              <section className="place-group" key={place}>
                <h2><MapPin aria-hidden="true" size={17} /> {place}</h2>
                <p>{memories.length} {memories.length === 1 ? "little day" : "little days"} kept here</p>
                <div className="place-memory-links">
                  {memories.slice(0, 6).map((memory) => (
                    <button key={memory.id} onClick={() => {
                      const media = memory.media[0];
                      if (media) openMedia(memory, media);
                      else setSelected({ memory });
                    }} type="button">{memory.title} · {formatDate(memory.occurredAt)}</button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {mode === "timeline" && [...byTimeline.entries()].map(([year, months]) => (
          <section className="timeline-year" key={year}>
            <h2>{year}</h2>
            {[...months.entries()].map(([month, memories]) => (
              <div className="timeline-month" key={month}>
                <h3>{month}</h3>
                <div className="timeline-items">
                  {memories.map((memory) => (
                    <button className="timeline-memory" key={memory.id} onClick={() => {
                      const media = memory.media[0];
                      if (media) openMedia(memory, media);
                      else setSelected({ memory });
                    }} type="button">
                      <time dateTime={memory.occurredAt}>{new Date(memory.occurredAt).getDate()}</time>
                      <span><strong>{memory.title}</strong><small>{formatDate(memory.occurredAt)}{memory.location ? ` · ${memory.location.name}` : ""}</small></span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}

        {loading && <p className="library-message" role="status">Gathering your little moments…</p>}
        {error && <p className="library-error" role="alert">{error}</p>}
        {!loading && !error && filteredItems.length === 0 && (
          <section className="library-empty">
            <span aria-hidden="true">♡</span>
            <h2>{mode === "gallery" && query.trim() ? "No memories found" : mode === "on-this-day" ? "A quiet day in the archive." : "A little room for what comes next."}</h2>
            <p>{mode === "gallery" && query.trim() ? "Try another name, place, tag or keyword." : mode === "search" ? "Try another word or place." : "When memories find their way here, they will stay close."}</p>
          </section>
        )}
        {mode !== "timeline" && mode !== "places" && filteredItems.length > 0 && (
          <div className="memory-masonry">
            {filteredItems.flatMap((memory) => renderMemory(memory))}
          </div>
        )}
        {totalPages > 1 && !loading && (
          <nav aria-label="Gallery pages" className="gallery-pagination">
            <button className="outline-button" disabled={page === 0 || loading} onClick={() => { scrollToPageAfterLoad.current = true; void load(page - 1, true, query); }} type="button">Previous</button>
            <span>Page {page + 1} of {totalPages}</span>
            <button className="outline-button" disabled={!hasMore || loading} onClick={() => { scrollToPageAfterLoad.current = true; void load(page + 1, true, query); }} type="button">Next</button>
          </nav>
        )}
        {notice && <p className="library-notice" role="status">{notice}</p>}
      </section>

      <AnimatePresence>
        {selected && (
          <motion.div
            animate={{ opacity: 1 }}
            className="memory-lightbox"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeViewer();
              }
            }}
            role="presentation"
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
          >
            <motion.section
              aria-labelledby="memory-view-title"
              aria-modal="true"
              className="memory-lightbox-panel"
              initial={reducedMotion ? false : { y: 12, scale: 0.99 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 8, scale: 0.99 }}
              role="dialog"
              transition={{ duration: reducedMotion ? 0 : 0.2 }}
            >
              <button className="lightbox-close" aria-label="Close memory" onClick={closeViewer} type="button"><X size={20} /></button>
              {selected.media && <div className="viewer-toolbar" aria-label="Viewer controls">
                <button
                  aria-label="Previous photo or video"
                  className="viewer-nav-button"
                  disabled={viewerIndex <= 0 && page === 0}
                  onClick={() => navigateViewer(-1)}
                  type="button"
                >
                  <ArrowLeft aria-hidden="true" size={16} /><span>PREV</span>
                </button>
                <button
                  aria-label="Next photo or video"
                  className="viewer-nav-button"
                  disabled={viewerIndex < 0 || (viewerIndex === viewerItems.length - 1 && !hasMore)}
                  onClick={() => navigateViewer(1)}
                  type="button"
                >
                  <span>NEXT</span><ArrowRight aria-hidden="true" size={16} />
                </button>
                {selected.media.resourceType === "image" ? <>
                  <button aria-label="Zoom out" disabled={imageZoom <= 1} onClick={() => zoomImage(-0.25)} type="button"><Minus size={16} /></button>
                  <span>{Math.round(imageZoom * 100)}%</span>
                  <button aria-label="Zoom in" disabled={imageZoom >= 4} onClick={() => zoomImage(0.25)} type="button"><Plus size={16} /></button>
                  <button aria-label="Reset zoom" onClick={() => { setImageZoom(1); setImagePan({ x: 0, y: 0 }); setImageRotation(0); }} type="button"><RotateCcw size={16} /></button>
                  <button aria-label="Rotate image" onClick={rotateImage} type="button"><RotateCw size={16} /></button>
                </> : <button aria-label="Rotate video" onClick={() => setVideoRotation((rotation) => (rotation + 90) % 360)} type="button"><RotateCw size={16} /><span>{videoRotation}°</span></button>}
                <button aria-label={`Download ${selected.media.originalFilename}`} onClick={() => void downloadMedia(selected.media!)} type="button"><Download size={16} /></button>
                <button aria-label={`Share ${selected.media.originalFilename}`} onClick={() => void shareMedia(selected.memory, selected.media!)} type="button"><Share2 size={16} /></button>
                <button aria-label="Open fullscreen" onClick={() => void lightboxMediaRef.current?.requestFullscreen?.()} type="button"><Expand size={16} /></button>
              </div>}
              <div
                className="lightbox-media"
                onTouchStart={(event) => {
                  const touch = event.touches[0];
                  viewerTouchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
                }}
                onTouchEnd={(event) => {
                  const start = viewerTouchStart.current;
                  const touch = event.changedTouches[0];
                  viewerTouchStart.current = null;
                  if (!start || !touch || event.changedTouches.length !== 1 || (selected.media?.resourceType === "image" && imageZoom > 1)) return;
                  const deltaX = touch.clientX - start.x;
                  const deltaY = touch.clientY - start.y;
                  if (Math.abs(deltaX) > 56 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) navigateViewer(deltaX < 0 ? 1 : -1);
                }}
                ref={lightboxMediaRef}
              >
                {selected.media ? selected.media.resourceType === "video"
                  ? <>
                    <video controls muted={false} playsInline preload="metadata" poster={selected.media.posterUrl} ref={videoRef} src={selected.media.url} style={{ transform: `rotate(${videoRotation}deg)`, ...(videoRotation % 180 ? { width: `${Math.max(1, Math.min(viewerSize.width * videoRatio, viewerSize.height))}px`, maxWidth: "none", maxHeight: "none" } : {}) }} onLoadedMetadata={(event) => {
                      const video = event.currentTarget;
                      video.muted = false;
                      video.volume = 1;
                      if (video.videoWidth && video.videoHeight) setVideoRatio(video.videoWidth / video.videoHeight);
                    }} />
                    <button className="video-sound-button" onClick={() => {
                      const video = videoRef.current;
                      if (!video) return;
                      video.muted = false;
                      video.volume = 1;
                      void video.play().catch(() => {});
                    }} type="button">Play with sound</button>
                  </>
                  : <Image
                    alt={selected.media.originalFilename}
                    className="viewer-image"
                    draggable={false}
                    height={1200}
                    onDoubleClick={() => setImageZoom((zoom) => zoom === 1 ? 2 : 1)}
                    onPointerDown={onImagePointerDown}
                    onPointerMove={onImagePointerMove}
                    onPointerUp={onImagePointerUp}
                    onPointerCancel={onImagePointerUp}
                    onWheel={(event) => { event.preventDefault(); zoomImage(event.deltaY < 0 ? 0.15 : -0.15); }}
                    src={selected.media.url}
                    style={{ transform: `translate(${imagePan.x}px, ${imagePan.y}px) rotate(${imageRotation}deg) scale(${imageZoom})`, maxWidth: imageRotation % 180 ? "min(82svh, 100%)" : "100%" }}
                    unoptimized
                    width={1600}
                  />
                  : <div className="memory-text-full">
                    {selected.memory.caption && <p>{selected.memory.caption}</p>}
                    {selected.memory.note && <p>{selected.memory.note}</p>}
                  </div>}
              </div>
              <div className="lightbox-details">
                {editing ? (
                  <form className="memory-edit-form" onSubmit={saveMemory}>
                    <label>Title<input defaultValue={selected.memory.title} maxLength={160} name="title" required /></label>
                    <label>Date<input defaultValue={new Date(selected.memory.occurredAt).toISOString().slice(0, 10)} name="occurredAt" required type="date" /></label>
                    <label>Place<input defaultValue={selected.memory.location?.name ?? ""} maxLength={160} name="locationName" /></label>
                    <label>Tags<input defaultValue={selected.memory.tags.map((tag) => tag.name).join(", ")} name="tags" placeholder="sunset, us" /></label>
                    <label>Caption<textarea defaultValue={selected.memory.caption} maxLength={5000} name="caption" rows={3} /></label>
                    <label>A note<textarea defaultValue={selected.memory.note} maxLength={10000} name="note" rows={3} /></label>
                    <div className="memory-edit-actions">
                      <button className="primary-button" disabled={saving} type="submit">{saving ? "Saving…" : "Save memory"}</button>
                      <button className="outline-button" onClick={() => setEditing(false)} type="button">Cancel</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p className="eyebrow">{formatDate(selected.memory.occurredAt)}</p>
                    <h2 id="memory-view-title">{selected.memory.title}</h2>
                    {selected.memory.location && <p className="memory-location"><MapPin size={14} /> {selected.memory.location.name}</p>}
                    {selected.memory.caption && <p className="memory-caption">{selected.memory.caption}</p>}
                    {selected.memory.note && <p className="memory-note">{selected.memory.note}</p>}
                    {selected.memory.tags.length > 0 && <p className="memory-tags">{selected.memory.tags.map((tag) => `#${tag.name}`).join("  ")}</p>}
                    <div className="memory-edit-actions">
                      <button className="outline-button" onClick={() => setEditing(true)} type="button">Edit this memory</button>
                      <button className="favorite-button" onClick={() => void toggleFavorite(selected.memory)} type="button" aria-label="Toggle favorite">
                        <Heart fill={selected.memory.isFavorite ? "currentColor" : "none"} size={17} />
                      </button>
                      {selected.media && (
                        <button className="danger-button" disabled={deletingMedia} onClick={() => void deleteMedia()} type="button">
                          <Trash2 size={15} /> {deletingMedia ? "Removing…" : "Remove file"}
                        </button>
                      )}
                      <button className="danger-button" onClick={() => void deleteMemory(selected.memory)} type="button">
                        <Trash2 size={15} /> Remove memory
                      </button>
                    </div>
                  </>
                )}
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {deleteConfirmation && (
            <motion.div
              animate={{ opacity: 1 }}
              className="delete-confirm-backdrop"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              onClick={(event) => {
                if (event.target === event.currentTarget) setDeleteConfirmation(null);
              }}
              role="presentation"
            >
              <motion.section
                aria-labelledby="delete-confirm-title"
                aria-modal="true"
                className="delete-confirm-dialog"
                initial={reducedMotion ? false : { y: 10, scale: 0.98 }}
                animate={{ y: 0, scale: 1 }}
                exit={{ y: 6, scale: 0.98 }}
                role="alertdialog"
                transition={{ duration: reducedMotion ? 0 : 0.18 }}
              >
                <span className="delete-confirm-icon"><Trash2 aria-hidden="true" size={19} /></span>
                <h2 id="delete-confirm-title">{deleteConfirmation.title}</h2>
                <p>{deleteConfirmation.description}</p>
                <div className="delete-confirm-actions">
                  <button className="outline-button" onClick={() => setDeleteConfirmation(null)} ref={deleteCancelButton} type="button">Cancel</button>
                  <button className="danger-button" onClick={deleteConfirmation.onConfirm} type="button">{deleteConfirmation.confirmLabel}</button>
                </div>
              </motion.section>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </main>
  );
}
