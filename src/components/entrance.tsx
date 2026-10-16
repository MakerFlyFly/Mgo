"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icon";

type SceneStage = "initializing" | "exterior" | "entering" | "counter";
const enteredKey = "mgo.entered.v1";
const sceneImages = ["/art/entrance.webp", "/art/counter.webp", "/art/character/happy.webp", "/art/character/neutral.webp"];

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
    if (stage !== "exterior" || !ready || entering.current) return;
    entering.current = true; setStage("entering");
  }, [stage, ready]);
  const retry = useCallback(() => setLoadVersion(version => version + 1), []);
  return { stage, ready, loadError, reducedMotion, enter, retry };
}

export function EntranceScene({ stage, ready, loadError, onEnter, onRetry }: {
  stage: "exterior" | "entering"; ready: boolean; loadError: boolean; onEnter: () => void; onRetry: () => void;
}) {
  return <section className="entrance" aria-label="麦当劳门口" aria-hidden={stage === "entering"} inert={stage === "entering"}>
    <img className="entrance-image" src="/art/entrance.webp" alt="暖阳下的麦当劳门店，金色招牌下是通往餐厅的玻璃门" fetchPriority="high" draggable={false}/>
    <div className="entrance-shade" aria-hidden="true"/>
    <div className="entrance-actions">
      {loadError && <p className="entrance-error" role="alert">画面暂时没有加载好，请再试一次。</p>}
      <button className="enter-button" onClick={loadError ? onRetry : onEnter} disabled={stage !== "exterior" || (!ready && !loadError)} aria-busy={!ready && !loadError}>
        <span>{loadError ? "重新加载画面" : "推门进入"}</span><Icon name="chevron" size={19}/>
      </button>
    </div>
  </section>;
}
