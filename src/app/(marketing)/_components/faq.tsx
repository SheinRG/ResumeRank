import { ChevronDown } from "lucide-react";

import { FAQ_ITEMS } from "./faq-data";

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
      <div className="text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-foreground">
          Frequently asked questions
        </h2>
      </div>

      <div className="mt-10 flex flex-col divide-y divide-border rounded-xl border border-border">
        {FAQ_ITEMS.map((item) => (
          <details key={item.question} className="group px-5 py-1 open:pb-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium text-foreground marker:content-none">
              {item.question}
              <ChevronDown
                className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {item.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
