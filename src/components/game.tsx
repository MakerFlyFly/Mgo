"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentReply, Preferences, Session, StreamEvent } from "@/lib/domain/types";
import { tasteOptions } from "@/lib/domain/preferences";
import { Icon, type IconName } from "./icon";
import { Modal } from "./modal";
import { OrderSheet } from "./order-sheet";
import { EntranceScene, useEntrance } from "./entrance";
import { useGameAudio } from "./use-game-audio";
import { characterArt } from "@/lib/character-art";
import { useDialogue } from "./use-dialogue";
import { stageParts } from "@/lib/dialogue/playback";
import { sseData } from "@/lib/streaming/sse";
import { useCharacter } from "./use-character";

type Config = { mode: "demo" | "live"; model: string; deepseekConfigured: boolean; mcdConfigured: boolean; requiresVisitorKey: boolean };
type Line = { who: "guest" | "whale"; text: string };
const greeting: AgentReply = { text: "欢迎光临云麦当劳～今天想吃点什么，客人？我刚好……咳，正在认真值班。点餐、挑优惠，或者先聊两句，都可以找我。", expression: "happy", choices: ["推荐30元以内的一人餐", "我想看看菜单", "你是不是在摸鱼？"] };
const initialPreferences: Preferences = { tastes: [] };

export function Game() {
  const audio = useGameAudio();
  const entrance = useEntrance(audio.unlock);
  const [config, setConfig] = useState<Config | null>(null), [session, setSession] = useState<Session | null>(null);
  const [reply, setReply] = useState<AgentReply>(greeting);
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [status, setStatus] = useState("");
  const [error, setError] = useState(""), [keyValue, setKeyValue] = useState(""), [keyDraft, setKeyDraft] = useState("");
  const [panel, setPanel] = useState<"settings" | "history" | "preferences" | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false), [handoff, setHandoff] = useState(false);
  const [turnId, setTurnId] = useState("");
  const [history, setHistory] = useState<Line[]>([{ who: "whale", text: greeting.text }]);
  const [preferences, setPreferences] = useState<Preferences>(initialPreferences), [prefDraft, setPrefDraft] = useState<Preferences>(initialPreferences);
  const [remember, setRemember] = useState(false), [tapped, setTapped] = useState(false);
  const sessionRef = useRef(session), busyRef = useRef(false), quoteRef = useRef<string | null>(null), replyRef = useRef(reply);
  const requestAbort = useRef<AbortController | null>(null), inputRef = useRef<HTMLTextAreaElement>(null);
  const dialogueRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null), followText = useRef(true);
  const dialogue = useDialogue(entrance.stage === "counter", audio);
  const hasShown = dialogue.lines.some(line => line.text);
  const character = useCharacter({ active: entrance.stage === "counter", busy, error: !!error, handoff, speaking: dialogue.speaking, finalStarted: dialogue.finalStarted, expression: dialogue.expression }, entrance.reducedMotion, turnId);
  useEffect(() => { sessionRef.current = session; }, [session]);
  const chime = audio.tap;
  const showLocal = useCallback((next: AgentReply) => { replyRef.current = next; setReply(next); dialogue.replace(next); }, [dialogue.replace]);
  useEffect(() => { audio.allowSpeech(entrance.stage === "counter" && !panel); }, [entrance.stage, panel, audio.allowSpeech]);
  useEffect(() => { if (entrance.stage === "counter") audio.tryResume(); }, [entrance.stage, audio.tryResume]);
  useEffect(() => {
    let alive = true;
    Promise.all([fetch("/api/config").then(r => r.json()), fetch("/api/session").then(r => r.json())]).then(([configuration, state]) => {
      if (!alive) return;
      if (configuration.error || state.error) throw new Error(configuration.error || state.error);
      setConfig(configuration); setSession(state.session);
      quoteRef.current = state.session?.quote?.id || null;
      if (state.session?.draft.items.length || state.session?.attempt) setSheetOpen(true);
      if (state.session?.attempt) showLocal({ text: "客人回来啦！上次的点单夹还保留着，可以先查看订单，再继续聊。", expression: "happy", choices: ["看看订单进度"] });
      else if (state.session?.draft.items.length) showLocal({ text: "客人回来啦！上次整理的点单夹还在，订单尚未提交。可以先看看，想调整什么再告诉我就好。", expression: "neutral", choices: ["看看现在点了什么", "我想调整点单"] });
    }).catch(e => { if (alive) setError(e.message || "暂时无法连接柜台，请刷新重试。"); });
    try {
      const saved = localStorage.getItem("mgo.preferences.v1");
      if (saved) { const parsed = JSON.parse(saved); const tastes = Array.isArray(parsed.tastes) ? parsed.tastes.filter((t: string) => (tasteOptions as readonly string[]).includes(t)) : []; const next = { tastes, ...(typeof parsed.budget === "number" && parsed.budget >= 1 && parsed.budget <= 1000 ? { budget: parsed.budget } : {}) }; setPreferences(next); setPrefDraft(next); setRemember(true); }
    } catch { /* storage is optional */ }
    return () => { alive = false; requestAbort.current?.abort(); };
  }, [showLocal]);
  useEffect(() => {
    if (entrance.stage === "counter" && dialogue.empty()) dialogue.replace(replyRef.current);
  }, [entrance.stage, dialogue.replace]);
  useEffect(() => { if (followText.current && contentRef.current) contentRef.current.scrollTop = contentRef.current.scrollHeight; }, [dialogue.lines]);
  useEffect(() => {
    if (entrance.stage === "counter") dialogueRef.current?.focus({ preventScroll: true });
  }, [entrance.stage]);
  const applyEvent = (event: StreamEvent) => {
    if (event.type === "status") setStatus(event.text);
    if (event.type === "state") {
      sessionRef.current = event.session; setSession(event.session);
      if (event.session.quote && event.session.quote.id !== quoteRef.current) { quoteRef.current = event.session.quote.id; setSheetOpen(true); setHandoff(true); setTimeout(() => setHandoff(false), 1500); }
      if (event.session.attempt) setSheetOpen(true);
    }
    const received = dialogue.receive(event);
    if (received.reply) { replyRef.current = received.reply; setReply(received.reply); }
    if (received.record) setHistory(lines => [...lines, { who: "whale", text: received.record! }]);
    if (event.type === "error") { dialogue.interrupt(); setReply(current => ({ ...current, choices: [] })); setError(event.message); if (event.code.startsWith("DEEPSEEK")) setPanel("settings"); }
  };
  const send = async (message: string, reset = false) => {
    if (entrance.stage !== "counter") return;
    if (busyRef.current || (!message.trim() && !reset)) return;
    if (!config) { setError("柜台还在连接，请稍等一下。"); return; }
    if (config.requiresVisitorKey && !keyValue && !reset) { setKeyDraft(""); setPanel("settings"); return; }
    const requestId = crypto.randomUUID(); setTurnId(requestId);
    dialogue.beginTurn(); followText.current = true;
    setReply(current => ({ ...current, choices: [] }));
    busyRef.current = true; setBusy(true); setError(""); setStatus("深度思考ing"); setText("");
    if (!reset) setHistory(lines => [...lines, { who: "guest", text: message }]);
    chime();
    const controller = new AbortController(); requestAbort.current = controller;
    try {
      const current = sessionRef.current;
      const response = await fetch("/api/chat", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, requestId, ...(current?.quote ? { quoteId: current.quote.id } : {}), ...(config.mode === "demo" ? { apiKey: keyValue, ...(current ? { demoState: current } : {}) } : {}), preferences, ...(reset ? { reset: true } : {}) }) });
      if (!response.ok) { const data = await response.json(); if (data.code?.startsWith("DEEPSEEK")) setPanel("settings"); throw new Error(data.error || "这次对话没有送达，请稍后再试。"); }
      if (!response.body) throw new Error("连接没有返回对话内容。");
      let completed = false;
      for await (const data of sseData(response.body)) {
        const event: StreamEvent = JSON.parse(data); applyEvent(event);
        if (event.type === "done") { completed = true; break; }
      }
      if (!completed) throw new Error("对话连接中断了，已整理的点单仍保留。请再告诉我下一步。");
      if (reset) { setSheetOpen(false); quoteRef.current = null; }
    } catch (e) { dialogue.interrupt(); setReply(current => ({ ...current, choices: [] })); if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : "对话连接中断了。真实订单请先查询状态，再继续操作。"); }
    finally {
      // Text is already visible; only controls wait for the server to release its lease.
      busyRef.current = false; setBusy(false); setStatus(""); requestAbort.current = null;
    }
  };
  const tapCharacter = () => {
    if (entrance.stage !== "counter" || busyRef.current) return;
    if (dialogue.buffered()) { dialogue.skipReceived(); return; }
    setTapped(true); setTimeout(() => setTapped(false), 600); chime();
    const lines = ["嗯？客人需要什么？我只是稍微摆了一下尾巴，可没有在摸鱼哦。", "点单夹、优惠券，还有……我的午饭。咳，前两样已经准备好啦。", "客人慢慢挑就好。今天也要好好吃饭，鲸鱼娘负责认真记单～"];
    const next: AgentReply = { text: lines[Math.floor(Math.random() * lines.length)], expression: "smug", choices: session?.draft.store ? ["看看现在点了什么", "帮我找找优惠"] : greeting.choices };
    showLocal(next); setHistory(old => [...old, { who: "whale", text: next.text }]);
  };
  const openPanel = (name: "settings" | "preferences" | "history") => { setKeyDraft(keyValue); setPrefDraft(preferences); setPanel(name); chime(); };
  const savePreferences = () => {
    setPreferences(prefDraft);
    try { if (remember) localStorage.setItem("mgo.preferences.v1", JSON.stringify(prefDraft)); else localStorage.removeItem("mgo.preferences.v1"); } catch { setError("浏览器未允许保存偏好，本次仍可使用。"); }
    setPanel(null);
  };
  const controls: { icon: IconName; label: string; action: () => void; active?: boolean; expanded?: boolean; badge?: number }[] = [
    { icon: audio.enabled ? "sound" : "muted", label: audio.enabled ? "关闭声音" : "开启声音", action: audio.toggle },
    { icon: "history", label: "对话记录", action: () => openPanel("history") },
    { icon: "heart", label: "口味偏好", action: () => openPanel("preferences") },
    { icon: "clipboard", label: sheetOpen ? "收起点单夹" : "查看点单夹", action: () => { setSheetOpen(value => !value); chime(); }, expanded: sheetOpen, badge: session?.draft.items.reduce((sum, item) => sum + item.quantity, 0) || 0 },
    { icon: "settings", label: "设置", action: () => openPanel("settings"), active: config?.requiresVisitorKey && !keyValue },
  ];
  return <main className={`game ${sheetOpen ? "sheet-visible" : ""}`} data-stage={entrance.stage} data-motion={entrance.reducedMotion ? "reduced" : "full"} onPointerDown={entrance.stage === "counter" ? audio.unlock : undefined} onKeyDownCapture={entrance.stage === "counter" ? audio.unlock : undefined}>
    <div className="counter-screen" aria-hidden={entrance.stage !== "counter"} inert={entrance.stage !== "counter"}>
    <div className="scene" aria-hidden="true"><div className="scene-image"/><div className="scene-warmth"/><div className="sun-dust dust-one"/><div className="sun-dust dust-two"/></div>
    <header className="topbar">
      <nav className="top-controls" aria-label="游戏设置">{controls.map(control => <button key={control.icon === "sound" || control.icon === "muted" ? "audio" : control.icon} className={`icon-button ${control.active ? "attention" : ""} ${control.expanded ? "is-selected" : ""}`} title={control.label} aria-label={control.label} aria-expanded={control.expanded} aria-controls={control.icon === "clipboard" ? "order-sheet" : undefined} aria-description={control.badge ? `已选 ${control.badge} 件餐品` : undefined} onClick={control.action}><Icon name={control.icon}/>{!!control.badge && <span className="control-count" aria-hidden="true">{control.badge > 99 ? "99+" : control.badge}</span>}</button>)}</nav>
    </header>
    <button className={`character ${tapped ? "tapped" : ""}`} onClick={tapCharacter} aria-label="和鲸鱼娘打个招呼" title="点击，和鲸鱼娘打个招呼"><img src={characterArt(character.visual)} data-expression={character.visual} onError={character.onError} alt="穿红黑白主题女仆制服的蓝发鲸鱼娘店员" draggable={false} fetchPriority="high"/></button>
    {sheetOpen && <OrderSheet session={session} onClose={() => setSheetOpen(false)}/>}
    <section className="dialogue" ref={dialogueRef} tabIndex={-1} aria-label="与鲸鱼娘对话"><div className="dialogue-name"><Icon name="whale" size={22}/><strong>鲸鱼娘</strong><span>当班店员</span></div>
      <div className="dialogue-content" ref={contentRef} aria-live="polite" onScroll={e => { const node = e.currentTarget; followText.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24; }} onClick={dialogue.skipReceived}>
        {busy && !hasShown ? <p><span className="working-text">{status}<span className="typing-dots">···</span></span></p> : dialogue.lines.filter(line => line.text || line.interrupted).map(line => <p className="dialogue-line" key={line.id}>{stageParts(line.text).map((part, index) => <span className={part.action ? "stage-direction" : undefined} key={index}>{part.text}</span>)}{line.interrupted && <span className="utterance-interrupted">（回应中断）</span>}</p>)}
        {!busy && hasShown && <span className="continue-mark" aria-hidden="true">◆</span>}
      </div>
      {error && <div className="error-notice" role="alert">{error}<button aria-label="关闭错误提示" onClick={() => setError("")}><Icon name="close" size={14}/></button></div>}
      {session?.attempt?.paymentUrl && <a className="payment-link" href={session.attempt.paymentUrl} target="_blank" rel="noopener noreferrer">前往麦当劳官方支付<Icon name="external" size={14}/></a>}
      <div className="dialogue-actions"><div className="quick-choices" aria-label="快捷回应">{!busy && reply.choices.map(choice => <button key={choice} onClick={() => void send(choice)}>{choice}<Icon name="chevron" size={12}/></button>)}</div>{session?.attempt?.status === "created" && <button className="new-order" disabled={busy} onClick={() => void send("", true)}><Icon name="reset" size={14}/>再来一单</button>}</div>
      <form className="chat-form" onSubmit={e => { e.preventDefault(); void send(text); }}><span className="input-decoration">✧</span><textarea ref={inputRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text); } }} placeholder={busy ? "鲸鱼娘正在处理上一句话…" : "告诉鲸鱼娘，今天想吃点什么…"} aria-label="对鲸鱼娘说的话" rows={1} maxLength={1500} disabled={busy}/><span className="enter-hint">ENTER</span><button type="submit" className="send-button" aria-label="发送消息" disabled={busy || !text.trim()}><Icon name="send" size={20}/></button></form>
    </section>
    {panel === "settings" && <Modal title="把对话接上，快乐就开张。" subtitle="关于这间小小的云端餐厅" onClose={() => setPanel(null)}>
      <div className="settings-mode"><Icon name="whale" size={28}/><div><strong>{config?.mode === "live" ? "你的个人点餐柜台" : "公开云端体验"}</strong><p>{config?.mode === "live" ? "连接你自己的麦当劳账户，确认后创建真实订单。" : "餐品、门店与订单均为模拟，不会扣款或配送。"}</p></div></div>
      {config?.requiresVisitorKey ? <><label className="field-label" htmlFor="deepseek-key">你的 DeepSeek API Key</label><div className="key-field"><Icon name="key" size={18}/><input id="deepseek-key" type="password" autoComplete="off" spellCheck={false} value={keyDraft} onChange={e => setKeyDraft(e.target.value)} placeholder="sk-…"/></div><p className="field-help">只在当前页面内存中使用。请求经本站服务端转发到 DeepSeek，不保存到浏览器或服务器；模型费用由你的账户承担。刷新页面后需重新填写。</p><div className="modal-buttons"><a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">获取 DeepSeek Key<Icon name="external" size={12}/></a><button className="primary-button" onClick={() => { setKeyValue(keyDraft.trim()); setKeyDraft(""); setPanel(null); setError(""); }} disabled={keyDraft.trim().length < 8}>连接对话<Icon name="chevron" size={16}/></button></div>{keyValue && <button className="text-button" onClick={() => { setKeyValue(""); setKeyDraft(""); }}>清除当前 Key</button>}</> : <><div className="config-check"><span>DeepSeek</span><b>{config?.deepseekConfigured ? "已配置" : "未配置"}</b></div><div className="config-check"><span>麦当劳 MCP</span><b>{config?.mcdConfigured ? "已配置" : "未配置"}</b></div><p className="field-help">请在项目根目录的 <code>.env.local</code>（Docker 使用 <code>.env</code>）中填写以下配置，保存后重启应用。设置页不会显示或修改凭据。</p><pre className="env-guide">APP_MODE=live{"\n"}DEEPSEEK_API_KEY=你的密钥{"\n"}DEEPSEEK_MODEL=deepseek-flash{"\n"}MCD_MCP_TOKEN=你的令牌</pre><a className="inline-link" href="https://open.mcd.cn/mcp" target="_blank" rel="noopener noreferrer">前往麦当劳 MCP 开放平台<Icon name="external" size={12}/></a></>}
      <p className="settings-footnote">Mgo 是非官方开源创作。真实餐品、价格和供应以麦当劳实时结果为准。</p>
    </Modal>}
    {panel === "preferences" && <Modal title="记住客人的小偏好。" subtitle="下次见面，少问一句，多懂一点。" onClose={() => setPanel(null)}>
      <label className="field-label" htmlFor="budget">一餐的参考预算（元）</label><input className="budget-input" id="budget" type="number" min="1" max="1000" placeholder="例如 30，可留空" value={prefDraft.budget ?? ""} onChange={e => setPrefDraft(p => ({ ...p, budget: e.target.value ? Number(e.target.value) : undefined }))}/>
      <span className="field-label taste-label">平时喜欢这样吃</span><div className="taste-chips">{tasteOptions.map(taste => <button className={prefDraft.tastes.includes(taste) ? "selected" : ""} aria-pressed={prefDraft.tastes.includes(taste)} key={taste} onClick={() => setPrefDraft(p => ({ ...p, tastes: p.tastes.includes(taste) ? p.tastes.filter(t => t !== taste) : [...p.tastes, taste] }))}>{taste}{prefDraft.tastes.includes(taste) && <Icon name="check" size={13}/>}</button>)}</div>
      <label className="remember-toggle"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}/><span>允许在这台浏览器记住这些偏好</span></label><p className="field-help">只保存这里的口味与预算（1–1000 元，可留空）。你在本轮对话里的要求会优先采用。</p><div className="modal-buttons"><button className="text-button" onClick={() => { try { localStorage.removeItem("mgo.preferences.v1"); } catch {} setPreferences(initialPreferences); setPrefDraft(initialPreferences); setRemember(false); }}>清除偏好</button><button className="primary-button" onClick={savePreferences} disabled={prefDraft.budget !== undefined && (!Number.isFinite(prefDraft.budget) || prefDraft.budget < 1 || prefDraft.budget > 1000)}>保存偏好<Icon name="check" size={16}/></button></div>
    </Modal>}
    {panel === "history" && <Modal title="柜台前的小小对话。" subtitle="当前页面的对话记录" onClose={() => setPanel(null)}><div className="history-list">{history.map((line, index) => <div key={index} className={`history-line ${line.who}`}><span>{line.who === "guest" ? "客人" : "鲸鱼娘"}</span><p>{line.text}</p></div>)}</div></Modal>}
    </div>
    {(entrance.stage === "exterior" || entrance.stage === "entering") && <EntranceScene stage={entrance.stage} ready={entrance.ready} loadError={entrance.loadError} onEnter={entrance.enter} onRetry={entrance.retry}/>}
    {entrance.stage === "entering" && <div className="entrance-light" aria-hidden="true"/>}
  </main>;
}
