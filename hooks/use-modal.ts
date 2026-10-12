"use client";

import { useState } from "react";

export function useModal<T = null>() {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<T | null>(null);

  const open = (itemData?: T) => {
    if (itemData !== undefined) setData(itemData);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setData(null);
  };

  const toggle = () => {
    setIsOpen((prev) => !prev);
  };

  return { isOpen, data, open, close, toggle };
}
