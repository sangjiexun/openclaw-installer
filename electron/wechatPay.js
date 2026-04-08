/**
 * WeChat Pay V3 Native Pay client for Electron main process.
 * Ported from pay-backup/server/utils/wechatPay.ts
 * Calls api.mch.weixin.qq.com directly — no external server needed.
 */

const { createSign, randomBytes } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const https = require("node:https");

// ─── Config ─────────────────────────────────────────────────────────────────
const WECHAT_PAY_CONFIG = {
  appId: "wxfc38f94e820dbebe",
  mchId: "1700930453",
  apiV3Key: "HunyuanHunyuanHunyuanHunyuan1234",
  serialNumber: "6013B69E3B5BB0A57397DAFD62320F7440F7BA6F",
  notifyUrl: "https://pay.hunyuandata.cn/api/payment/wechat/notify",
};

const BASE_URL = "https://api.mch.weixin.qq.com";

// ─── Load private key ───────────────────────────────────────────────────────
let _privateKey = null;

function getPrivateKey() {
  if (_privateKey) return _privateKey;
  // Try multiple cert paths (dev + packaged app)
  const candidates = [
    // Packaged app: extraResources path
    resolve(process.resourcesPath || "", "cert", "apiclient_key.pem"),
    // Dev: project root /cert
    resolve(__dirname, "..", "cert", "apiclient_key.pem"),
    resolve(__dirname, "..", "assets", "cert", "apiclient_key.pem"),
    resolve(process.env.USERPROFILE || process.env.HOME || "", "Desktop", "openclaw-win", "pay-backup", "mynotebook", "cert", "apiclient_key.pem"),
  ];
  for (const p of candidates) {
    try {
      _privateKey = readFileSync(p, "utf-8");
      console.log("[WechatPay] Loaded private key from", p);
      return _privateKey;
    } catch { /* try next */ }
  }
  throw new Error("找不到微信支付私钥文件 (apiclient_key.pem)");
}

// ─── Signature ──────────────────────────────────────────────────────────────
function generateSignature(method, url, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = randomBytes(16).toString("hex");
  const message = `${method}\n${url}\n${timestamp}\n${nonceStr}\n${body}\n`;

  const sign = createSign("RSA-SHA256");
  sign.update(message);
  const signature = sign.sign(getPrivateKey(), "base64");

  const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${WECHAT_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",timestamp="${timestamp}",serial_no="${WECHAT_PAY_CONFIG.serialNumber}",signature="${signature}"`;
  return authorization;
}

// ─── HTTP request to WeChat Pay API ─────────────────────────────────────────
function wechatRequest(method, path, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : "";
    const authorization = generateSignature(method, path, body);

    const url = new URL(`${BASE_URL}${path}`);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: authorization,
        "User-Agent": "OpenClaw-Installer/1.0",
      },
    };
    if (body && method !== "GET") {
      options.headers["Content-Length"] = Buffer.byteLength(body);
    }

    console.log(`[WechatPay] ${method} ${path}`);

    const req = https.request(options, (res) => {
      let chunks = "";
      res.on("data", (chunk) => { chunks += chunk; });
      res.on("end", () => {
        try {
          // 204 No Content (e.g. close order)
          if (res.statusCode === 204) { resolve({}); return; }
          const json = JSON.parse(chunks);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            console.error("[WechatPay] Error:", res.statusCode, json);
            reject(new Error(json.message || `微信支付错误 [${json.code}]`));
          }
        } catch (e) {
          reject(new Error(`解析响应失败: ${chunks.slice(0, 200)}`));
        }
      });
    });

    req.on("error", (err) => {
      console.error("[WechatPay] Network error:", err.message);
      reject(new Error(`网络请求失败: ${err.message}`));
    });

    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("请求超时"));
    });

    if (body && method !== "GET") {
      req.write(body);
    }
    req.end();
  });
}

// ─── Generate unique out_trade_no ───────────────────────────────────────────
function generateOutTradeNo(prefix = "OC") {
  const dateStr = new Date().toISOString().replace(/[-T:\.Z]/g, "").slice(0, 14);
  return `${prefix}${dateStr}${randomBytes(4).toString("hex").toUpperCase()}`;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a Native Pay order (returns QR code URL)
 * @param {number} amountYuan - amount in yuan (e.g. 59)
 * @param {string} description - order description
 * @returns {Promise<{code_url: string, out_trade_no: string}>}
 */
async function createNativeOrder(amountYuan, description) {
  const outTradeNo = generateOutTradeNo("OC");
  const amountFen = Math.round(amountYuan * 100);

  if (amountFen < 1 || amountFen > 1000000) {
    throw new Error("金额无效 (1分 - 10000元)");
  }

  const result = await wechatRequest("POST", "/v3/pay/transactions/native", {
    appid: WECHAT_PAY_CONFIG.appId,
    mchid: WECHAT_PAY_CONFIG.mchId,
    description,
    out_trade_no: outTradeNo,
    notify_url: WECHAT_PAY_CONFIG.notifyUrl,
    amount: { total: amountFen, currency: "CNY" },
    scene_info: { payer_client_ip: "127.0.0.1" },
  });

  return {
    code_url: result.code_url,
    out_trade_no: outTradeNo,
  };
}

/**
 * Query order status by out_trade_no
 * @param {string} outTradeNo
 * @returns {Promise<{status: string, statusDesc: string, amount: number|null, successTime: string|null}>}
 */
async function queryOrderStatus(outTradeNo) {
  try {
    const result = await wechatRequest(
      "GET",
      `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${WECHAT_PAY_CONFIG.mchId}`
    );
    return {
      status: result.trade_state,
      statusDesc: result.trade_state_desc || "",
      transactionId: result.transaction_id || null,
      amount: result.amount ? result.amount.total / 100 : null,
      successTime: result.success_time || null,
    };
  } catch (err) {
    // 404 or ORDER_NOT_EXIST means not paid yet
    if (err.message && (err.message.includes("ORDER_NOT_EXIST") || err.message.includes("404"))) {
      return { status: "NOTPAY", statusDesc: "未支付", amount: null, successTime: null };
    }
    throw err;
  }
}

module.exports = { createNativeOrder, queryOrderStatus, generateOutTradeNo };
