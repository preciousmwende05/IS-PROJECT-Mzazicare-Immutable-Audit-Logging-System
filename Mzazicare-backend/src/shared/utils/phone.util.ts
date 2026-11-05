import { BadRequestError } from "@/shared/errors";

/**
 * Kenyan numbers arrive as 0712…, +254712…, 254712… and 712…. Everything is
 * stored as E.164 so auth-service login, notification-service SMS and
 * billing-service M-Pesa all key off the same string.
 */
export const normalizeKenyanPhone = (input: string): string => {
  const digits = input.replace(/\D/g, "");

  let national: string;
  if (digits.startsWith("254")) national = digits.slice(3);
  else if (digits.startsWith("0")) national = digits.slice(1);
  else national = digits;

  if (!/^[17]\d{8}$/.test(national)) {
    throw new BadRequestError(`"${input}" is not a valid Kenyan mobile number`);
  }

  return `+254${national}`;
};

export const isValidKenyanPhone = (input: string): boolean => {
  try {
    normalizeKenyanPhone(input);
    return true;
  } catch {
    return false;
  }
};
