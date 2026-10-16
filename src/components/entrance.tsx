"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "./icon";

type SceneStage = "initializing" | "exterior" | "entering" | "counter";
const enteredKey = "mgo.entered.v1";
const sceneImages = ["/art/entrance.webp", "/art/counter.webp", "/art/character/happy.webp", "/art/character/neutral.webp"];
const ignoredEntryKeys = new Set(["Tab", "Escape", "Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "NumLock", "ScrollLock", "Fn", "FnLock", "ContextMenu", "Process", "Unidentified"]);
const glints = [[12, 26, 3], [80, 20, 5], [26, 62, 4], [72, 78, 6], [46, 38, 3], [91, 54, 4], [8, 83, 5], [62, 11, 3], [35, 86, 4], [86, 41, 3], [54, 68, 6], [18, 45, 4]];

function preloadImage(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = setTimeout(() => finish(new Error("Scene image timed out")), 15000);
    const finish = (error?: Error) => {
      clearTimeout(timeout); image.onload = null; image.onerror = null;
      if (error) reject(error); else resolve();
    };
    image.onload = () => { image.decode().then(() => finish(), () => finish(new Error("Scene image could not be decoded"))); };
    image.onerror = () => finish(new Error("Scene image could not be loaded"));
    image.src = source;
  });
}

export function useEntrance() {
  const [stage, setStage] = useState<SceneStage>("initializing");
  const [ready, setReady] = useState(false), [loadError, setLoadError] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0), [reducedMotion, setReducedMotion] = useState(false);
  const entering = useRef(false);

  useEffect(() => {
    let entered = false;
    try { entered = sessionStorage.getItem(enteredKey) === "1"; } catch { /* entrance still works without storage */ }
    setStage(entered ? "counter" : "exterior");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(motion.matches);
    updateMotion(); motion.addEventListener("change", updateMotion);
    return () => motion.removeEventListener("change", updateMotion);
  }, []);

  useEffect(() => {
    let alive = true;
    setReady(false); setLoadError(false);
    Promise.all(sceneImages.map(preloadImage)).then(() => {
      if (alive) setReady(true);
    }).catch(() => { if (alive) setLoadError(true); });
    return () => { alive = false; };
  }, [loadVersion]);

  useEffect(() => {
    if (stage !== "entering") return;
    const timer = setTimeout(() => {
      try { sessionStorage.setItem(enteredKey, "1"); } catch { /* keep the current visit usable */ }
      setStage("counter");
    }, reducedMotion ? 150 : 1500);
    return () => clearTimeout(timer);
  }, [stage, reducedMotion]);

  const enter = useCallback(() => {
    if (stage !== "exterior" || !ready || loadError || entering.current) return;
    entering.current = true; setStage("entering");
  }, [stage, ready, loadError]);
  useEffect(() => {
    if (stage !== "exterior" || !ready || loadError) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey || ignoredEntryKeys.has(event.key) || /^F\d{1,2}$/.test(event.key)) return;
      event.preventDefault(); enter();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stage, ready, loadError, enter]);
  const retry = useCallback(() => setLoadVersion(version => version + 1), []);
  return { stage, ready, loadError, reducedMotion, enter, retry };
}

export function EntranceScene({ stage, ready, loadError, onEnter, onRetry }: {
  stage: "exterior" | "entering"; ready: boolean; loadError: boolean; onEnter: () => void; onRetry: () => void;
}) {
  return <section className="entrance" aria-label="麦当劳门口" aria-hidden={stage === "entering"} inert={stage === "entering"} onClick={() => { if (!loadError) onEnter(); }}>
    <img className="entrance-image" src="/art/entrance.webp" alt="暖阳下的麦当劳门店，金色招牌下是通往餐厅的玻璃门" fetchPriority="high" draggable={false}/>
    <div className="entrance-shade" aria-hidden="true"/>
    <div className="entrance-glints" aria-hidden="true">{glints.map(([left, top, size], index) => <i key={index} style={{
      left: `${left}%`, top: `${top}%`, width: size, height: size,
      "--glint-duration": `${12 + index % 5 * 2}s`, "--glint-delay": `${-index * 1.7}s`, "--glint-x": `${index % 2 ? -18 : 22}px`, "--glint-y": `${-30 - index % 3 * 8}px`,
    } as CSSProperties}/>)}</div>
    <div className="entrance-actions">
      {loadError ? <><p className="entrance-error" role="alert">画面暂时没有加载好，请再试一次。</p><button className="entry-retry" onClick={event => { event.stopPropagation(); onRetry(); }}>重新加载画面<Icon name="chevron" size={19}/></button></>
        : !ready ? <p className="entrance-loading" role="status">门店准备中…</p>
        : <button className="entry-prompt" aria-label="进入麦当劳" onClick={event => { event.stopPropagation(); onEnter(); }} disabled={stage !== "exterior"}><span className="entry-keyboard-hint">按任意键进入</span><span className="entry-touch-hint">轻触屏幕进入</span></button>}
    </div>
  </section>;
}
