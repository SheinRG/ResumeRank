"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Shared behaviour for the jobs / candidates / applicants toolbars: a debounced
 * search box mirrored into `?q`, plus filter/sort setters that write a param
 * (or drop it when it equals its default) and always reset pagination. Every
 * change replaces the URL so it stays shareable and back-button safe.
 *
 * `currentQuery` is the `q` resolved from the URL on the server. We adopt URL
 * changes we didn't cause (back button, shared link) without clobbering text
 * the user is mid-typing — tracked via `lastPushed`.
 */
export function useListFilters(currentQuery: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(currentQuery);
  const lastPushed = useRef(currentQuery);

  useEffect(() => {
    if (currentQuery !== lastPushed.current) {
      lastPushed.current = currentQuery;
      setSearch(currentQuery);
    }
  }, [currentQuery]);

  function replaceParams(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    params.delete("page");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === currentQuery) return;
    const handle = setTimeout(() => {
      lastPushed.current = trimmed;
      replaceParams((params) => {
        if (trimmed) params.set("q", trimmed);
        else params.delete("q");
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // replaceParams is derived from these same inputs; listing them keeps the
    // debounce in step with router/searchParams changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, currentQuery, searchParams, pathname, router]);

  /** Set `key` to `value`, or drop it when `value` is the default (sentinel). */
  function setParam(key: string, value: string, defaultValue: string) {
    replaceParams((params) => {
      if (value === defaultValue) params.delete(key);
      else params.set(key, value);
    });
  }

  return { search, setSearch, setParam };
}
