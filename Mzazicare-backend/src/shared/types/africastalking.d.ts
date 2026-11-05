declare module "africastalking" {
  interface SmsRecipient {
    statusCode: number;
    number: string;
    status: string;
    cost: string;
    messageId: string;
  }

  interface SmsResponse {
    SMSMessageData: { Message: string; Recipients: SmsRecipient[] };
  }

  interface SmsSendOptions {
    to: string | string[];
    message: string;
    from?: string;
    enqueue?: boolean;
  }

  interface AfricasTalkingClient {
    SMS: { send(options: SmsSendOptions): Promise<SmsResponse> };
  }

  function AfricasTalking(options: {
    apiKey: string;
    username: string;
    format?: "json" | "xml";
  }): AfricasTalkingClient;

  export = AfricasTalking;
}
