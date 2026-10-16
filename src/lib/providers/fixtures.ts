import type { JsonObject } from "../domain/types";

export const DEMO_MEALS: Record<string, { name: string; cents: number; category: string; description: string }> = {
  "1001": { name: "麦辣鸡腿堡", cents: 2050, category: "汉堡", description: "酥脆鸡腿，微辣口味" },
  "1002": { name: "板烧鸡腿堡", cents: 2300, category: "汉堡", description: "嫩滑鸡腿，非辣口味" },
  "1003": { name: "吉士汉堡", cents: 1500, category: "汉堡", description: "牛肉与吉士的经典组合" },
  "2001": { name: "板烧鸡腿堡套餐", cents: 3200, category: "套餐", description: "板烧鸡腿堡＋一份小食＋一杯饮料" },
  "2002": { name: "麦辣鸡腿堡套餐", cents: 2990, category: "套餐", description: "麦辣鸡腿堡＋一份小食＋一杯饮料" },
  "3001": { name: "中份薯条", cents: 1200, category: "小食", description: "金黄酥脆" },
  "3002": { name: "玉米杯", cents: 1100, category: "小食", description: "清甜玉米粒" },
  "3003": { name: "麦乐鸡（5块）", cents: 1400, category: "小食", description: "分享一点快乐" },
  "4001": { name: "中杯可乐", cents: 900, category: "饮料", description: "冰爽气泡" },
  "4002": { name: "中杯无糖可乐", cents: 900, category: "饮料", description: "无糖气泡饮料" },
  "4003": { name: "美式咖啡", cents: 1200, category: "饮料", description: "现磨咖啡" },
};
export const DEMO_COUPONS = [
  { title: "板烧套餐体验券", couponId: "DEMO-LUNCH", couponCode: "DEMO-LUNCH-CODE", productCode: "2001", discountCents: 210, description: "板烧套餐减 ¥2.10；每单限一份" },
  { title: "麦乐鸡体验券", couponId: "DEMO-NUGGET", couponCode: "DEMO-NUGGET-CODE", productCode: "3003", discountCents: 410, description: "5块麦乐鸡 ¥9.90；每单限一份" },
];
export function demoDetail(code: string): JsonObject {
  const meal = DEMO_MEALS[code];
  const combo = code.startsWith("2");
  return {
    code, name: meal.name, currentPrice: (meal.cents / 100).toFixed(2), supportModify: code.startsWith("1"),
    ...(combo ? { roundList: [
      { round: "side", name: "套餐小食", minQuantity: 1, maxQuantity: 1, comboItemList: [
        { code: "3001", name: "中份薯条", price: 0, default: true },
        { code: "3002", name: "玉米杯", price: 0 },
      ] },
      { round: "drink", name: "套餐饮料", minQuantity: 1, maxQuantity: 1, comboItemList: [
        { code: "4001", name: "中杯可乐", price: 0, default: true },
        { code: "4002", name: "中杯无糖可乐", price: 0 },
        { code: "4003", name: "美式咖啡", price: 300 },
      ] },
    ] } : {}),
    ...(code.startsWith("1") ? { modification: { values: [
      { code: "sauce", name: "酱料", minQuantity: 0, maxQuantity: 1, selectedQuantity: 1, selectedKey: "0-1", unselectedKey: "0-0" },
    ] } } : {}),
  };
}
