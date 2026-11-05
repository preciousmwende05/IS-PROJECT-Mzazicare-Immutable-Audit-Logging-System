import { env } from "@/shared/config/env";
import logger from "@/shared/config/logger";

export interface StkPushRequest {
  phone: string; // E.164
  amountCents: number;
  accountReference: string; // invoice id
  description: string;
}

export interface StkPushResponse {
  checkoutRequestId: string;
  merchantRequestId: string;
}

export interface MpesaService {
  stkPush(request: StkPushRequest): Promise<StkPushResponse>;
  /** Proves a callback really came from Safaricom before it is trusted. */
  verifyCallback(body: unknown, headers: Record<string, unknown>): boolean;
}

const sandboxMpesa: MpesaService = {
  stkPush: async (request) => {
    logger.info(`[mpesa:dev] stkPush ${request.amountCents}c -> ${request.phone}`);
    return { checkoutRequestId: `ws_CO_dev_${Date.now()}`, merchantRequestId: "dev" };
  },
  verifyCallback: () => true,
};

const darajaMpesa: MpesaService = {
  stkPush: async () => {
    // TODO(billing-service, U-CS 75): OAuth token, then STK push via Daraja.
    throw new Error("darajaMpesa.stkPush not implemented");
  },
  verifyCallback: () => {
    // TODO(billing-service, U-CS 75): validate source IP / signature.
    // Returning true unconditionally would let anyone mark an invoice paid.
    throw new Error("darajaMpesa.verifyCallback not implemented");
  },
};

export const mpesaService: MpesaService = env.MPESA_CONSUMER_KEY ? darajaMpesa : sandboxMpesa;
