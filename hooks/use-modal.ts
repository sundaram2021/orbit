"use client";

import { useState, useCallback } from "react";

export function useModal<T = null>() {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<T | null>(null);

  const open = useCallback((itemData?: T) => {
    if (itemData !== undefined) setData(itemData);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setData(null);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  return { isOpen, data, open, close, toggle };
}
