/**
 * Money is an integer count of cents. Never store a float — billing totals
 * must reconcile exactly against the audit trail.
 */
export interface Money {
  amount: number;
  currency: "KES";
}

export const kes = (shillings: number): Money => ({
  amount: Math.round(shillings * 100),
  currency: "KES",
});

const assertSameCurrency = (a: Money, b: Money) => {
  if (a.currency !== b.currency)
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
};

export const addMoney = (a: Money, b: Money): Money => {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
};

export const subtractMoney = (a: Money, b: Money): Money => {
  assertSameCurrency(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
};

export const multiplyMoney = (a: Money, factor: number): Money => ({
  amount: Math.round(a.amount * factor),
  currency: a.currency,
});

export const formatMoney = ({ amount, currency }: Money): string =>
  `${currency} ${(amount / 100).toFixed(2)}`;
