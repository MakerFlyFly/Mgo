"use client";
import { useEffect, useRef } from "react";
import { Icon } from "./icon";
export function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="modal" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-inner"><button className="icon-button modal-close" onClick={onClose} aria-label="关闭"><Icon name="close" /></button>
      <span className="eyebrow">MGO · LITTLE COUNTER</span><h2>{title}</h2>{subtitle && <p className="modal-subtitle">{subtitle}</p>}{children}
    </div>
  </dialog>;
}
