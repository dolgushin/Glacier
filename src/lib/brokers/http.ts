import { BrokerError } from "@/lib/brokers/types";

/**
 * HTTP for broker APIs.
 *
 * The value here is not the request — it is turning transport failures into
 * something the person running the service can act on. An integration that
 * reports "fetch failed" is not usable by whoever has to fix it.
 *
 * The case that motivated this: the T-Invest API presents a chain issued by the
 * Russian national CA (Минцифры), which is in neither Node's bundled CA list
 * nor most OS trust stores. Every request dies with SELF_SIGNED_CERT_IN_CHAIN,
 * which explains nothing. Node's own NODE_EXTRA_CA_CERTS is the fix; the error
 * below says exactly that.
 */

const TLS_CODES = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_UNTRUSTED",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

const CA_HINT =
  "Сервер брокера использует сертификат российского УЦ Минцифры, которого нет среди доверенных " +
  "у Node.js. Связка сертификатов входит в проект: убедитесь, что файл " +
  "certs/russian-trusted-ca-bundle.pem на месте, и перезапустите сервис командой npm start — " +
  "он подхватывает сертификат сам. Подробности в README, раздел «Сертификат для Т-Инвестиций».";

/** True when the running process was started with an extra CA bundle. */
export function hasExtraCa(): boolean {
  return Boolean(process.env.NODE_EXTRA_CA_CERTS);
}

export interface BrokerRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Broker name, used verbatim in error messages. */
  broker: string;
}

/**
 * Perform a broker request and return the parsed JSON body.
 * Non-2xx responses and transport failures both raise BrokerError.
 */
export async function brokerFetch<T>(request: BrokerRequest): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 30_000);

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method ?? "GET",
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    const code = cause?.code ?? (error as { code?: string }).code ?? "";

    if (TLS_CODES.has(code)) {
      throw new BrokerError(
        `Не удалось установить защищённое соединение с ${request.broker}: сертификат сервера не подтверждён (${code}).`,
        hasExtraCa()
          ? "Дополнительный корневой сертификат подключён, но этой цепочки в нём нет. " +
            "Проверьте, что скачан именно корневой сертификат Минцифры и что файл в формате PEM."
          : CA_HINT,
      );
    }
    if ((error as Error).name === "AbortError") {
      throw new BrokerError(`${request.broker} не ответил вовремя.`);
    }
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      throw new BrokerError(
        `Адрес API ${request.broker} не разрешается. Проверьте доступ в интернет или настройки DNS.`,
      );
    }
    if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "UND_ERR_SOCKET") {
      throw new BrokerError(
        `Соединение с ${request.broker} разорвано. Возможно, доступ к API закрыт из вашей сети.`,
      );
    }
    throw new BrokerError(`Не удалось связаться с ${request.broker}: ${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text().catch(() => "");

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new BrokerError(
        `${request.broker} отклонил ключ (HTTP ${response.status}).`,
        "Проверьте, что ключ действителен, не отозван и имеет право на чтение. " +
          "Если брокер ограничивает доступ по IP, добавьте адрес этого сервера в белый список.",
      );
    }
    if (response.status === 429) {
      throw new BrokerError(`${request.broker}: превышен лимит запросов.`, "Подождите минуту и повторите.");
    }
    throw new BrokerError(
      `${request.broker} вернул ошибку ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`,
    );
  }

  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new BrokerError(
      `${request.broker} вернул не-JSON ответ. Возможно, запрос уходит не на тот адрес или между вами и API стоит прокси.`,
    );
  }
}
