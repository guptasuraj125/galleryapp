"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUpRight, Camera, MapPin, Sparkles } from "lucide-react";
import gsap from "gsap";
import { BrandMark } from "@/src/components/brand-mark";
import { ThemeToggle } from "@/src/components/theme-toggle";

export function LandingExperience() {
  const sceneRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const context = gsap.context(() => {
      gsap.from(".hero-reveal", {
        opacity: 0,
        y: 22,
        duration: 0.9,
        stagger: 0.12,
        ease: "power2.out",
      });
      gsap.to(".orbit-note", {
        y: -8,
        duration: 2.8,
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut",
        stagger: 0.3,
      });
    }, scene);

    return () => context.revert();
  }, []);

  return (
    <main className="landing" ref={sceneRef}>
      <div aria-hidden="true" className="landing-grain" />
      <header className="landing-header">
        <BrandMark />
        <div className="landing-header-actions">
          <ThemeToggle />
          <Link className="quiet-link" href="/login">
            Already have a key? <span>Come in</span>
          </Link>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow hero-reveal">
            <span className="eyebrow-dot" /> A little place, just for us
          </p>
          <h1 className="hero-title hero-reveal">
            ghumi<span className="title-period">.</span>
            <br />
            ghumi<span className="title-period">.</span>
          </h1>
          <div className="hero-bottom hero-reveal">
            <div>
              <p className="hero-tagline">our little corner of the internet.</p>
              <p className="hero-subline">for the moments we don&apos;t want to lose.</p>
            </div>
            <Link className="primary-button" href="/login">
              Enter our space <ArrowUpRight size={17} strokeWidth={1.8} />
            </Link>
          </div>
        </div>

        <div aria-hidden="true" className="memory-orbit">
          <div className="orbit-ring orbit-ring-outer" />
          <div className="orbit-ring orbit-ring-inner" />
          <div className="orbit-sun" />
          <div className="orbit-photo orbit-photo-main">
            <div className="photo-wash" />
            <span className="photo-caption">somewhere, together</span>
          </div>
          <div className="orbit-photo orbit-photo-small">
            <div className="photo-wash" />
            <span className="photo-caption">a sunday</span>
          </div>
          <div className="orbit-note note-place">
            <MapPin size={13} /> somewhere we love
          </div>
          <div className="orbit-note note-date">
            <Camera size={13} /> 14 feb · 2026
          </div>
          <div className="orbit-note note-star">
            <Sparkles size={15} />
          </div>
          <div className="orbit-counter">01 <span>/ a lifetime</span></div>
        </div>
      </section>

      <footer className="landing-footer">
        <span>private · personal · just us</span>
        <a href="#about">A softer way to remember <ArrowDown size={13} /></a>
        <span>made for two, kept close</span>
      </footer>

      <section aria-label="About ghumi.ghumi" className="about-strip" id="about">
        <p>
          Photos get lost in camera rolls. The good ones deserve a little more
          room to stay.
        </p>
        <span>One quiet archive for all your little big days.</span>
      </section>
    </main>
  );
}
