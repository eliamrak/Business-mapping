import { useEffect, useRef } from "react";
import "../../pages/practice-tokens.css";
import "./tidal-material.css";

export function TidalMaterial({ section }: { section: string }) {
  const artwork = useRef<HTMLDivElement>(null);
  const transitions = useRef(new Set<Animation>());

  useEffect(() => {
    const art = artwork.current;
    if (!art) return;
    const previous = document.documentElement.getAttribute("data-practice-material");
    document.documentElement.setAttribute("data-practice-material", "tidal");
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const paint = () => {
      frame = 0;
      art.style.transform = preference.matches
        ? "none"
        : `translate3d(0,${-Math.min(window.scrollY * 0.16, 140)}px,0)`;
    };
    const scroll = () => { if (!frame) frame = window.requestAnimationFrame(paint); };
    const changed = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      if (preference.matches) for (const animation of transitions.current) animation.cancel();
      paint();
    };
    window.addEventListener("scroll", scroll, { passive: true });
    preference.addEventListener("change", changed);
    paint();
    return () => {
      window.removeEventListener("scroll", scroll);
      preference.removeEventListener("change", changed);
      if (frame) window.cancelAnimationFrame(frame);
      for (const animation of transitions.current) animation.cancel();
      transitions.current.clear();
      if (previous === null) document.documentElement.removeAttribute("data-practice-material");
      else document.documentElement.setAttribute("data-practice-material", previous);
    };
  }, []);

  useEffect(() => {
    const root = artwork.current?.closest(".pw-app");
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const active = Array.from(root.querySelectorAll<HTMLElement>(".pw-content:not([hidden])"))
      .filter(surface => typeof surface.animate === "function")
      .map(surface => surface.animate([
        { opacity: 0.2, transform: "translateY(10px)" },
        { opacity: 1, transform: "none" },
      ], { duration: 240, easing: "cubic-bezier(.2,.65,.3,1)" }));
    for (const animation of active) {
      transitions.current.add(animation);
      void animation.finished.then(
        () => transitions.current.delete(animation),
        () => transitions.current.delete(animation),
      );
    }
    return () => { for (const animation of active) animation.cancel(); };
  }, [section]);

  return <div ref={artwork} className="pw-tidal-art" aria-hidden="true" />;
}
