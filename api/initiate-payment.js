// Vercel Serverless Function: Initiate M-Pesa STK Push via Daraja API
// Supports Customer Paybill (CustomerPayBillOnline) and Buy Goods (CustomerBuyGoodsOnline)
//
// Environment Variables Required:
//   DARAJA_CONSUMER_KEY       - Safaricom Daraja consumer key
//   DARAJA_CONSUMER_SECRET    - Safaricom Daraja consumer secret
//   DARAJA_SHORTCODE_PAYBILL  - Business Paybill shortcode (Party B for paybill)
//   DARAJA_PASSKEY_PAYBILL    - Lipa Na M-Pesa Online passkey (paybill)
//   DARAJA_SHORTCODE_BUYGOODS - Buy Goods till number (Party B for buy goods)
//   DARAJA_PASSKEY_BUYGOODS   - Lipa Na M-Pesa Online passkey (buy goods)
//   DARAJA_CALLBACK_URL       - Full callback URL (e.g., https://yourdomain.com/api/mpesa-callback)
//   DARAJA_ENV                - "sandbox" or "production" (default: sandbox)

const DARAJA_BASE_URLS = {
    sandbox: 'https://sandbox.safaricom.co.ke',
    production: 'https://api.safaricom.co.ke',
};

/**
 * Get a Daraja OAuth2 access token
 * Daraja OAuth: POST /oauth/v1/generate?grant_type=client_credentials
 * Auth: Basic (base64 encoded consumer_key:consumer_secret)
 */
async function getAccessToken(consumerKey, consumerSecret, baseUrl) {
    const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    const response = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${credentials}`,
        },
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OAuth failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return data.access_token;
}

/**
 * Generate the Daraja STK Push password
 * Password = Base64(BusinessShortCode + Passkey + Timestamp)
 */
function generatePassword(shortcode, passkey, timestamp) {
    const raw = `${shortcode}${passkey}${timestamp}`;
    return Buffer.from(raw).toString('base64');
}

/**
 * Get current timestamp in Daraja format: YYYYMMDDHHmmss
 */
function getTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return (
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
        `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    );
}

/**
 * Truncate string to max length and append truncated value
 */
function truncate(str, maxLen) {
    if (!str) return '';
    return str.substring(0, maxLen);
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { phone_number, amount, loan_amount, customer_name, payment_type } = req.body;

        if (!phone_number || !amount) {
            return res.status(400).json({ error: 'Phone number and amount are required' });
        }

        // Resolve Daraja credentials from environment
        const consumerKey = process.env.DARAJA_CONSUMER_KEY;
        const consumerSecret = process.env.DARAJA_CONSUMER_SECRET;
        const callbackUrl = process.env.DARAJA_CALLBACK_URL;
        const envKey = process.env.DARAJA_ENV || 'sandbox';

        if (!consumerKey || !consumerSecret) {
            console.error('Missing Daraja credentials in environment.');
            return res.status(500).json({ error: 'Payment service credentials not configured' });
        }

        if (!callbackUrl) {
            console.error('Missing DARAJA_CALLBACK_URL in environment.');
            return res.status(500).json({ error: 'Callback URL not configured' });
        }

        const baseUrl = DARAJA_BASE_URLS[envKey] || DARAJA_BASE_URLS.sandbox;

        // Determine payment type, shortcodes, passkeys, and TransactionType
        const type = (payment_type || 'paybill').toLowerCase();
        let businessShortCode, passkey, partyB, transactionType;

        if (type === 'buygoods' || type === 'buy_goods' || type === 'till') {
            businessShortCode = process.env.DARAJA_SHORTCODE_BUYGOODS;
            passkey = process.env.DARAJA_PASSKEY_BUYGOODS;
            partyB = process.env.DARAJA_SHORTCODE_BUYGOODS; // For Buy Goods, PartyB = till number
            transactionType = 'CustomerBuyGoodsOnline';
        } else {
            businessShortCode = process.env.DARAJA_SHORTCODE_PAYBILL;
            passkey = process.env.DARAJA_PASSKEY_PAYBILL;
            partyB = process.env.DARAJA_SHORTCODE_PAYBILL; // For Paybill, PartyB = business shortcode
            transactionType = 'CustomerPayBillOnline';
        }

        if (!businessShortCode || !passkey) {
            console.error(`Missing Daraja shortcode/passkey for type: ${type}`);
            return res.status(500).json({ error: `Payment credentials for ${type} not configured` });
        }

        // Format phone: ensure 254 prefix (Daraja requires 2547XXXXXXXX format)
        let msisdn = phone_number.replace(/[^0-9]/g, '');
        if (msisdn.startsWith('0')) {
            msisdn = '254' + msisdn.substring(1);
        }
        if (!msisdn.startsWith('254')) {
            msisdn = '254' + msisdn;
        }

        // Get OAuth2 access token
        const accessToken = await getAccessToken(consumerKey, consumerSecret, baseUrl);

        // Build STK Push request
        const timestamp = getTimestamp();
        const password = generatePassword(businessShortCode, passkey, timestamp);

        // AccountReference: max 12 characters per Daraja docs
        const accountRef = truncate(`LOAN${loan_amount || amount}`, 12);
        // TransactionDesc: max 13 characters per Daraja docs
        const transactionDesc = truncate('ProcessingFee', 13);

        const stkPayload = {
            BusinessShortCode: businessShortCode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: transactionType,
            Amount: Math.round(Number(amount)),
            PartyA: msisdn,
            PartyB: partyB,
            PhoneNumber: msisdn,
            CallBackURL: callbackUrl,
            AccountReference: accountRef,
            TransactionDesc: transactionDesc,
        };

        console.log('Daraja STK Push request:', JSON.stringify({ ...stkPayload, Password: '***' }));

        const response = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(stkPayload),
        });

        const result = await response.json();

        console.log('Daraja STK Push response:', JSON.stringify(result));

        // Daraja returns ResponseCode "0" on success, and CheckoutRequestID
        if (result.ResponseCode !== '0' && !result.CheckoutRequestID) {
            console.error('Daraja STK Push error:', result);
            return res.status(400).json({
                error: result.errorMessage || result.ResponseDescription || 'STK Push failed',
                response_code: result.ResponseCode,
            });
        }

        return res.status(200).json({
            success: true,
            reference: result.CheckoutRequestID,
            response_description: result.ResponseDescription,
            message: 'STK push sent successfully',
        });
    } catch (error) {
        console.error('Payment initiation error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message,
        });
    }
}
