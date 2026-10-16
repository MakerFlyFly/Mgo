"use client";
import { money, type Session } from "@/lib/domain/types";
import { Icon } from "./icon";
export function OrderSheet({ session, onClose }: { session: Session | null; onClose: () => void }) {
  const draft = session?.draft, quote = session?.quote, attempt = session?.attempt;
  return <aside id="order-sheet" className="order-board" aria-label="你的点单夹">
    <div className="board-handle"><span /></div><div className="board-metal"><i/><i/></div>
    <button className="board-close" onClick={onClose} aria-label="收起点单夹"><Icon name="close" size={18}/></button>
    <div className="order-paper">
      <div className="paper-topline"><span>MGO / GUEST ORDER</span><span>NO. 018</span></div>
      <h2>客人的点单</h2><p className="paper-caption">每一份快乐，都有认真记下来。</p>
      <div className="sheet-location"><Icon name="clipboard" size={15}/><span>{draft?.store?.storeName || "还没选好餐厅"}</span></div>
      <div className="sheet-tags"><span>{draft?.fulfillment === "delivery" ? "麦乐送外送" : draft?.fulfillment === "pickup" ? "到店自取" : "就餐方式待选"}</span><span>{attempt ? "已递交" : quote ? "已核价" : "待核价"}</span></div>
      {draft?.address && draft.fulfillment === "delivery" && <p className="sheet-address">送到：{draft.address.fullAddress}<br/>{draft.address.contactName} {draft.address.phone}</p>}
      <div className="paper-rule"/>
      <div className="sheet-items">
        {!draft?.items.length ? <div className="empty-sheet"><Icon name="whale" size={52}/><p>点单夹还是空的</p><small>告诉我今天想吃什么吧～</small></div> : draft.items.map((item, index) => <div className="sheet-item" key={item.lineId}>
          <span className="item-number">{String(index + 1).padStart(2, "0")}</span><div className="item-info"><strong>{item.name}</strong>{item.options.length > 0 && <small>{item.options.join(" · ")}</small>}{item.couponId && <small className="coupon-note">已选择优惠券</small>}</div><span className="item-quantity">×{item.quantity}</span>
        </div>)}
      </div>
      {draft?.items.length ? <><div className="paper-rule"/><div className="sheet-costs">
        <p><span>餐品金额</span><span>{quote ? money(quote.productCents) : "待核价"}</span></p>
        {draft.fulfillment === "delivery" && <p><span>配送费</span><span>{quote ? money(quote.deliveryCents) : "待核价"}</span></p>}
        {draft.needTableware && <p><span>餐具费</span><span>{quote ? money(quote.tablewareCents) : "待核价"}</span></p>}
        <p className="discount-line"><span>优惠</span><span>{quote ? `−${money(quote.discountCents)}` : "待核价"}</span></p>
      </div><div className="sheet-total"><span>应付合计</span><strong>{quote ? money(quote.totalCents) : "— —"}</strong></div></> : null}
      {draft?.fulfillment === "pickup" && quote && <p className="take-way-note">取餐：{quote.takeWays.find(t => t.code === draft.takeWayCode)?.name || "请在对话里选择取餐方式"}</p>}
      {draft?.remark && <p className="sheet-address">备注：{draft.remark}</p>}
      {attempt && <div className={`order-result ${attempt.status}`}><Icon name={attempt.status === "created" ? "check" : "history"} size={18}/><div><strong>{attempt.orderStatus || (attempt.status === "unknown" ? "提交结果待核实" : "正在提交")}</strong>{attempt.orderId && <small>订单号：{attempt.orderId}</small>}{attempt.pickupCode && <small>取餐号：{attempt.pickupCode}</small>}</div></div>}
    </div>
  </aside>;
}
