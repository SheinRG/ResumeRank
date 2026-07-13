"use client";

import { useState } from "react";

import { FAQ_ITEMS } from "./faq-data";

export function Faq() {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="bg-brand-cream px-6 pb-[110px] text-brand-ink">
      <div className="mx-auto max-w-[820px]">
        <div data-reveal className="mb-12 text-center">
          <span className="font-mono text-xs tracking-[0.08em] text-[#6b7280]">
            FAQ
          </span>
          <h2 className="mt-3.5 font-display text-[clamp(32px,3.4vw,48px)] leading-[1.1] font-bold tracking-[-0.02em]">
            Fair questions.
          </h2>
        </div>

        <div className="flex flex-col gap-3">
          {FAQ_ITEMS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div
                key={item.question}
                data-reveal
                className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white"
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  className="flex w-full cursor-pointer items-center justify-between gap-4 px-6 py-5 text-left"
                >
                  <span className="font-display text-[16.5px] font-semibold">
                    {item.question}
                  </span>
                  <span
                    aria-hidden
                    className={`font-display text-xl text-[#9ba1ac] transition-transform duration-300 ${
                      isOpen ? "rotate-45" : ""
                    }`}
                  >
                    +
                  </span>
                </button>
                <div
                  className="grid transition-[grid-template-rows] duration-300 ease-out"
                  style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                >
                  <div className="overflow-hidden">
                    <p className="px-6 pb-[22px] text-[14.5px] leading-relaxed text-[#59606c]">
                      {item.answer}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
