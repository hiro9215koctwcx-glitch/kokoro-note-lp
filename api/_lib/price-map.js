export const PRICE_IDS = {
  light_monthly: "price_1TTWqzDC3iFaV6mGmBTdG5jC",
  light_yearly: "price_1TTWsqDC3iFaV6mGe6ij1Akt",
  standard_monthly: "price_1TTWtgDC3iFaV6mGPCOV753D",
  standard_yearly: "price_1TTWuTDC3iFaV6mGKnbQgCEV",
};

const priceToPlan = {};

for (const [key, pid] of Object.entries(PRICE_IDS)) {
  const plan = key.startsWith("standard") ? "standard" : "light";
  priceToPlan[pid] = plan;
}

export function resolvePlan(priceId) {
  return priceToPlan[priceId] || null;
}

export function allowedPriceIds() {
  return new Set(Object.values(PRICE_IDS));
}
