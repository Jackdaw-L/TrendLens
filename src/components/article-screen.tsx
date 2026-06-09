"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bookmark,
  CheckCircle2,
  ExternalLink,
  Lightbulb,
  Share2,
  X,
} from "lucide-react";
import {
  AppShell,
  BookmarkButton,
  HeaderBar,
} from "@/components/app-chrome";
import { LazyImage } from "@/components/lazy-image";
import { useReadingState } from "@/components/use-reading-state";
import type { Annotation, Article, ArticleImage } from "@/lib/radar-data";

export function ArticleScreen({
  article,
  related,
}: {
  article: Article;
  related: Article[];
}) {
  const reading = useReadingState();
  const {
    isFavorite: getIsFavorite,
    markRead,
    rememberFavoriteArticle,
    toggleFavorite,
  } = reading;
  const [activeAnnotation, setActiveAnnotation] = useState<Annotation | null>(null);
  const [shareStatus, setShareStatus] = useState<"idle" | "done">("idle");
  const heroImage = getHeroImage(article);
  const isFavorite = getIsFavorite(article.id);

  useEffect(() => {
    markRead(article.id);
  }, [article.id, markRead]);

  useEffect(() => {
    if (isFavorite) {
      rememberFavoriteArticle(article);
    }
  }, [article, isFavorite, rememberFavoriteArticle]);

  const annotationMap = useMemo(
    () => new Map(article.annotations.map((annotation) => [annotation.term, annotation])),
    [article.annotations],
  );

  async function shareArticle() {
    const text = `${article.title}\n${article.oneSentence}\n${article.originalUrl}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: article.title,
          text: article.oneSentence,
          url: article.originalUrl,
        });
        setShareStatus("done");
      } else {
        await copyText(text);
        setShareStatus("done");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;

      try {
        await copyText(text);
        setShareStatus("done");
      } catch {
        setShareStatus("idle");
      }
    }

    window.setTimeout(() => setShareStatus("idle"), 1600);
  }

  return (
    <AppShell
      className={`article-shell ${activeAnnotation ? "sheet-open" : ""}`}
      footer={
        <div className="article-toolbar" aria-label="阅读工具">
          <button
            className={`toolbar-button ${isFavorite ? "is-active" : ""}`}
            onClick={() => toggleFavorite(article)}
            type="button"
          >
            <Bookmark
              aria-hidden
              fill={isFavorite ? "currentColor" : "none"}
              size={21}
            />
            <span>{isFavorite ? "已收藏" : "收藏"}</span>
          </button>
          <button className="toolbar-button" onClick={shareArticle} type="button">
            {shareStatus === "done" ? <CheckCircle2 aria-hidden size={21} /> : <Share2 aria-hidden size={21} />}
            <span>{shareStatus === "done" ? "已分享" : "分享"}</span>
          </button>
          <a className="toolbar-button" href={article.originalUrl} rel="noreferrer" target="_blank">
            <ExternalLink aria-hidden size={21} />
            <span>原文</span>
          </a>
        </div>
      }
    >
      <HeaderBar
        action={
          <BookmarkButton
            active={isFavorite}
            onClick={() => toggleFavorite(article)}
          />
        }
      />

      <article className="article-detail">
        <div className="article-hero-media" aria-hidden={!heroImage}>
          {heroImage && <LazyImage alt={heroImage.alt || article.title} priority src={heroImage.url} />}
        </div>

        <h1>{article.title}</h1>

        <section className="conclusion-panel">
          <Lightbulb aria-hidden size={21} />
          <strong>{article.oneSentence}</strong>
          <p>{article.whyNow}</p>
        </section>

        <section className="why-card">
          <h2>AI推荐语</h2>
          <p>{article.whyRecommended || article.pmAngle}</p>
        </section>

        <div className="article-body">
          {article.bodyBlocks.map((block, index) => {
            if (block.type === "quote") {
              return (
                <blockquote className="quote-block" key={`${block.type}-${index}`}>
                  {block.sourceText}
                </blockquote>
              );
            }

            if (block.type === "image") {
              return (
                <figure className="article-image-block" key={`${block.type}-${index}`}>
                  <div className="article-image-block__media">
                    <LazyImage alt={block.alt || block.caption || article.title} src={block.url} />
                  </div>
                  {block.caption && <figcaption>{block.caption}</figcaption>}
                </figure>
              );
            }

            return (
              <p key={`${block.type}-${index}`}>
                {renderAnnotatedText(block.content, block.annotations ?? [], annotationMap, setActiveAnnotation)}
              </p>
            );
          })}
        </div>

        <section className="takeaway-card">
          <h2>PM Takeaways</h2>
          <ul>
            {article.pmTakeaways.map((item, index) => (
              <li key={item}>
                <span>{index + 1}</span>
                <p>{item}</p>
              </li>
            ))}
          </ul>
        </section>

        {related.length > 0 && (
          <section className="related-section">
            <h2>延伸阅读</h2>
            <div className="related-list">
              {related.map((item) => (
                <Link className="related-link" href={`/articles/${item.id}`} key={item.id} prefetch>
                  <span>{item.source}</span>
                  <strong>{item.title}</strong>
                </Link>
              ))}
            </div>
          </section>
        )}
      </article>

      {activeAnnotation && (
        <>
          <button
            aria-label="关闭注释"
            className="sheet-scrim"
            onClick={() => setActiveAnnotation(null)}
            type="button"
          />
          <aside className="annotation-sheet" role="dialog" aria-modal="true">
            <div className="sheet-handle" />
            <div className="sheet-title-row">
              <h2>{activeAnnotation.term}</h2>
              <button
                aria-label="关闭"
                className="sheet-close"
                onClick={() => setActiveAnnotation(null)}
                type="button"
              >
                <X aria-hidden size={18} />
              </button>
            </div>
            <p>{activeAnnotation.explain}</p>
          </aside>
        </>
      )}
    </AppShell>
  );
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) throw new Error("copy failed");
}

function renderAnnotatedText(
  content: string,
  terms: string[],
  annotationMap: Map<string, Annotation>,
  onOpen: (annotation: Annotation) => void,
) {
  if (terms.length === 0) return content;

  const pieces: ReactNode[] = [content];

  for (const term of terms) {
    const annotation = annotationMap.get(term);
    if (!annotation) continue;

    const next: ReactNode[] = [];
    for (const piece of pieces) {
      if (typeof piece !== "string") {
        next.push(piece);
        continue;
      }

      const parts = piece.split(term);
      parts.forEach((part, index) => {
        if (part) next.push(part);
        if (index < parts.length - 1) {
          next.push(
            <button
              className="annotation-term"
              key={`${term}-${next.length}`}
              onClick={() => onOpen(annotation)}
              type="button"
            >
              {term}
            </button>,
          );
        }
      });
    }
    pieces.splice(0, pieces.length, ...next);
  }

  return pieces;
}

function getHeroImage(article: Article): ArticleImage | null {
  if (article.heroImage?.url) return article.heroImage;
  const bodyImage = article.bodyBlocks.find((block) => block.type === "image" && block.url);
  if (bodyImage?.type === "image") {
    return {
      id: bodyImage.imageId ?? bodyImage.url,
      url: bodyImage.url,
      alt: bodyImage.alt,
      caption: bodyImage.caption,
    };
  }
  return article.images?.find((image) => image.url) ?? null;
}
