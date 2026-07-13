"use client";

import { useEffect } from "react";
import gsap from "gsap";
import Lenis from "lenis";

/**
 * Progressive-enhancement layer for the landing page: every section renders
 * fully visible without JS, and this controller adds the scroll choreography
 * on top. It no-ops entirely under `prefers-reduced-motion`.
 *
 * Behaviours are wired by data-attribute so the markup stays declarative:
 * `data-split` (word-by-word headline reveal), `data-reveal` (fade/rise on
 * enter), `data-parallax` (speed-weighted drift), `data-marquee-track`,
 * `data-magnetic`, and the `data-demo-*` pinned walkthrough.
 */
export function LandingMotion() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) return;

    const observers: IntersectionObserver[] = [];
    const cleanups: Array<() => void> = [];
    let rafId = 0;
    let scrollRaf = 0;
    let lenis: Lenis | null = null;

    // Smooth scrolling on its own rAF loop so a failure can't stall gsap.
    try {
      lenis = new Lenis({ duration: 1.1 });
      const raf = (time: number) => {
        lenis?.raf(time);
        rafId = requestAnimationFrame(raf);
      };
      rafId = requestAnimationFrame(raf);
    } catch {
      lenis = null;
    }

    const onceVisible = (el: Element, cb: () => void) => {
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              io.disconnect();
              cb();
            }
          }
        },
        { rootMargin: "0px 0px -8% 0px" },
      );
      io.observe(el);
      observers.push(io);
    };

    // Word-split headline reveals: wrap each word in an overflow-clip mask so
    // the inner span can rise into place.
    document.querySelectorAll<HTMLElement>("[data-split]").forEach((el, idx) => {
      const walk = (node: Node) => {
        [...node.childNodes].forEach((child) => {
          if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
            const frag = document.createDocumentFragment();
            child.textContent.split(/(\s+)/).forEach((part) => {
              if (!part.trim()) {
                frag.appendChild(document.createTextNode(part));
                return;
              }
              const outer = document.createElement("span");
              outer.style.cssText =
                "display:inline-block;overflow:hidden;vertical-align:bottom";
              const inner = document.createElement("span");
              inner.style.display = "inline-block";
              inner.setAttribute("data-word", "");
              inner.textContent = part;
              outer.appendChild(inner);
              frag.appendChild(outer);
            });
            node.replaceChild(frag, child);
          } else if (
            child.nodeType === Node.ELEMENT_NODE &&
            (child as HTMLElement).tagName !== "BR"
          ) {
            walk(child);
          }
        });
      };
      walk(el);

      const words = el.querySelectorAll("[data-word]");
      if (idx === 0) {
        gsap.from(words, {
          yPercent: 115,
          duration: 0.9,
          ease: "power4.out",
          stagger: 0.055,
          delay: 0.15,
        });
      } else {
        onceVisible(el, () => {
          gsap.fromTo(
            words,
            { yPercent: 115 },
            { yPercent: 0, duration: 0.8, ease: "power4.out", stagger: 0.04 },
          );
        });
      }
    });

    // Rise-and-fade reveals; content stays visible until its reveal plays.
    document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => {
      onceVisible(el, () => {
        gsap.fromTo(
          el,
          { y: 26, autoAlpha: 0 },
          {
            y: 0,
            autoAlpha: 1,
            duration: 0.85,
            ease: "power3.out",
            clearProps: "opacity,visibility,transform",
          },
        );
      });
    });

    // Parallax + pinned-demo progress, driven by a scrollY poll (scroll events
    // are unreliable under smooth-scroll libraries).
    const parallax = [...document.querySelectorAll<HTMLElement>("[data-parallax]")].map(
      (el) => ({
        el,
        speed: parseFloat(el.getAttribute("data-parallax") ?? "0.2") || 0.2,
        set: gsap.quickSetter(el, "y", "px") as (value: number) => void,
      }),
    );

    const track = document.querySelector<HTMLElement>("[data-demo-track]");
    const panels = document.querySelectorAll<HTMLElement>("[data-demo-panel]");
    const steps = document.querySelectorAll<HTMLElement>("[data-demo-step]");
    const dot = document.querySelector<HTMLElement>("[data-demo-dot]");
    const line = document.querySelector<HTMLElement>("[data-demo-line]");

    const activate = (i: number) => {
      panels.forEach((p, j) =>
        gsap.to(p, {
          autoAlpha: j === i ? 1 : 0,
          y: j === i ? 0 : 28,
          scale: j === i ? 1 : 0.97,
          duration: 0.65,
          ease: "power3.out",
        }),
      );
      steps.forEach((s, j) =>
        gsap.to(s, {
          opacity: j === i ? 1 : 0.35,
          duration: 0.5,
          ease: "power3.out",
        }),
      );
      const step = steps[i];
      if (dot && step) {
        gsap.to(dot, { y: step.offsetTop, duration: 0.65, ease: "power3.inOut" });
        if (line) {
          gsap.to(line, {
            height: Math.max(0, step.offsetTop),
            duration: 0.65,
            ease: "power3.inOut",
          });
        }
      }
    };

    let demoIdx = 0;
    let lastY = -1;
    const update = () => {
      const vh = window.innerHeight;
      for (const item of parallax) {
        const parent = item.el.parentElement;
        if (!parent) continue;
        const r = parent.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) continue;
        const p = (vh - r.top) / (vh + r.height);
        item.set((p - 0.5) * item.speed * 700);
      }
      if (track && panels.length === 3) {
        const r = track.getBoundingClientRect();
        const total = r.height - vh;
        if (total > 0) {
          const prog = Math.min(1, Math.max(0, -r.top / total));
          const i = Math.min(2, Math.floor(prog * 3));
          if (i !== demoIdx) {
            demoIdx = i;
            activate(i);
          }
        }
      }
    };
    const loop = () => {
      const y = window.scrollY;
      if (y !== lastY) {
        lastY = y;
        update();
      }
      scrollRaf = requestAnimationFrame(loop);
    };
    scrollRaf = requestAnimationFrame(loop);

    // Marquee.
    const marquee = document.querySelector<HTMLElement>("[data-marquee-track]");
    if (marquee) {
      const tween = gsap.to(marquee, {
        xPercent: -50,
        duration: 26,
        ease: "none",
        repeat: -1,
      });
      cleanups.push(() => tween.kill());
    }

    // Magnetic buttons.
    document.querySelectorAll<HTMLElement>("[data-magnetic]").forEach((el) => {
      const move = (e: MouseEvent) => {
        const r = el.getBoundingClientRect();
        gsap.to(el, {
          x: (e.clientX - r.left - r.width / 2) * 0.25,
          y: (e.clientY - r.top - r.height / 2) * 0.35,
          duration: 0.4,
          ease: "power3.out",
        });
      };
      const leave = () =>
        gsap.to(el, { x: 0, y: 0, duration: 0.6, ease: "elastic.out(1,0.45)" });
      el.addEventListener("mousemove", move);
      el.addEventListener("mouseleave", leave);
      cleanups.push(() => {
        el.removeEventListener("mousemove", move);
        el.removeEventListener("mouseleave", leave);
      });
    });

    return () => {
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(scrollRaf);
      lenis?.destroy();
      observers.forEach((io) => io.disconnect());
      cleanups.forEach((fn) => fn());
      gsap.killTweensOf("*");
    };
  }, []);

  return null;
}
