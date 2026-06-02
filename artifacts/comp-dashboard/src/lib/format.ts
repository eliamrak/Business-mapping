export const formatCurrency = (value: number | undefined | null) => {
  if (value === undefined || value === null) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

export const formatPercent = (value: number | undefined | null, decimals = 2) => {
  if (value === undefined || value === null) return "0%";
  return `${Number(value).toFixed(decimals)}%`;
};

export const parseCurrencyInput = (value: string) => {
  return Number(value.replace(/[^0-9.-]+/g, ""));
};
